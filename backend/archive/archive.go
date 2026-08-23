// Package archive browses, extracts and creates archives (PLAN.md §M18).
//
// Three constraints shape it.
//
//   - **Extracting is broad, creating is narrow.** The standard library covers
//     zip, tar, gzip, flate and read-only bzip2; everything else is a pure-Go
//     decoder. For two of the formats people ask for most there is no encoder
//     at any price: RAR compression is proprietary, and no maintained pure-Go
//     library writes 7z. So this extracts both and creates neither, and the UI
//     says so rather than offering a format that fails at the end of a long job.
//
//   - **Browsing extracts to a temp folder.** A virtual path scheme would be
//     more elegant and would force the watcher, thumbnails, preview, search,
//     hashing, drag and drop and session restore all to learn it. Extracting to
//     a real folder means every one of them keeps working unchanged, because it
//     *is* a real folder (§M18 decision 3).
//
//   - **The jobs are M8's search and M14's hashing again**: an id back
//     immediately, progress as events, and cancellation that actually stops the
//     work rather than letting it outlive the window that asked for it.
package archive

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Wails events. Separate names rather than one with a discriminator, as in
// backend/search and backend/hashing.
const (
	ProgressEvent = "archive:progress"
	DoneEvent     = "archive:done"
)

// mountPrefix names every mount folder this package creates.
//
// Every sweep and every release is scoped to it, so none of them can touch a
// directory the app did not make — which matters, because all of them delete.
//
// Leading dot: since §M21 a mount is created beside the archive rather than in
// the system temp directory, which means it lands in a folder the user is
// looking at. Hidden is the difference between a temp folder and litter.
const mountPrefix = ".file-base-mount-"

// Progress reports one job mid-flight.
type Progress struct {
	ID    string `json:"id"`
	Entry string `json:"entry"`
	// Done is bytes written so far. Total is the uncompressed size when the
	// format's headers know it, and 0 when the archive is a stream whose length
	// cannot be known until it ends — the UI shows an indeterminate bar then.
	Done  int64 `json:"done"`
	Total int64 `json:"total"`
}

// Done closes out a job. Exactly one is emitted per Extract or Create.
type Done struct {
	ID string `json:"id"`
	// Path is where the result landed: the extraction root, possibly moved by
	// the single-root collapse, or the archive that was written.
	Path      string `json:"path"`
	Entries   int    `json:"entries"`
	Bytes     int64  `json:"bytes"`
	Cancelled bool   `json:"cancelled"`
	// Error carries the encoded `fs-error:` payload, so a failure reaches the
	// UI as a typed FsError — including `password-required`, which is the one
	// the caller reacts to rather than reports.
	Error string `json:"error"`
}

// Archive is bound to Wails; its exported methods become the TS bindings.
type Archive struct {
	mu      sync.Mutex
	running map[string]context.CancelFunc
	counter int
	// mounts are the temp folders currently handed out, so Stop can reclaim
	// every one at quit without walking the disk.
	mounts map[string]bool

	emitProgress func(Progress)
	emitDone     func(Done)
}

func New() *Archive {
	return &Archive{
		running:      map[string]context.CancelFunc{},
		mounts:       map[string]bool{},
		emitProgress: func(Progress) {},
		emitDone:     func(Done) {},
	}
}

// Start wires the emitters to the Wails runtime. Package-level for the reason
// backend/db, backend/watcher, backend/search and backend/hashing are: Wails
// binds every exported method, and lifecycle is not for JavaScript to drive.
func Start(a *Archive, ctx context.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.emitProgress = func(p Progress) { runtime.EventsEmit(ctx, ProgressEvent, p) }
	a.emitDone = func(d Done) { runtime.EventsEmit(ctx, DoneEvent, d) }
}

// Stop cancels every running job and reclaims every mount. Called at shutdown.
func (a *Archive) stopAll() {
	a.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(a.running))
	for _, cancel := range a.running {
		cancels = append(cancels, cancel)
	}
	a.running = map[string]context.CancelFunc{}
	mounts := make([]string, 0, len(a.mounts))
	for path := range a.mounts {
		mounts = append(mounts, path)
	}
	a.mounts = map[string]bool{}
	a.mu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}
	for _, path := range mounts {
		_ = removeMount(path)
	}
}

func Stop(a *Archive) { a.stopAll() }

// Sweep removes mounts left behind by a crash or a force-quit, in the system
// temp directory.
//
// That is no longer where mounts are made — they sit beside their archive since
// §M21 — but it is still where the fallback puts them, and it is where every
// mount made by an earlier version of the app is. Orphans beside an archive are
// swept by NewMount instead, which is the one moment the app has a reason to
// read that directory.
//
// Scoped by prefix, so it can only ever remove something this package created.
func Sweep() int {
	entries, err := os.ReadDir(os.TempDir())
	if err != nil {
		return 0
	}

	removed := 0
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), mountPrefix) {
			continue
		}
		if removeMount(filepath.Join(os.TempDir(), entry.Name())) == nil {
			removed++
		}
	}
	return removed
}

// NewMount creates the folder a browsed archive is extracted into.
//
// It sits **beside the archive** (§M21), not in the system temp directory.
// Browsing a 20GB archive on an external drive used to need 20GB free on the
// boot volume and copy it all there; next to the archive the bytes never leave
// the volume they came from, and the space is reclaimed where it was taken.
//
// The folder is `.file-base-mount-<hash>`, hashed from the archive's own path:
//
//   - **Hashed, not random**, so one archive always maps to one folder. That is
//     what lets a mount stranded by a crash be recognised and replaced on the
//     next browse rather than accumulating a new one each time.
//   - **Hidden**, because this folder now lands where the user is looking.
//
// The archive's own name is the leaf inside it, so the breadcrumb still reads
// `… / Photos.zip / holiday` (§M18 decision 7).
func (a *Archive) NewMount(archivePath string) (string, error) {
	clean := filepath.Clean(archivePath)
	name := filepath.Base(clean)
	if name == "" || name == "." || name == string(filepath.Separator) {
		name = "archive"
	}

	root, err := a.makeMountRoot(clean)
	if err != nil {
		return "", wrapError(archivePath, err)
	}

	mount := filepath.Join(root, name)
	if err := os.Mkdir(mount, 0o755); err != nil {
		_ = os.RemoveAll(root)
		return "", wrapError(archivePath, err)
	}

	a.mu.Lock()
	a.mounts[root] = true
	a.mu.Unlock()
	return mount, nil
}

// mountRoot is the folder one archive extracts into: its own directory, under a
// name derived from its full path. Sixteen hex digits of SHA-256 — enough that
// two archives in one folder cannot collide, short enough to read.
func mountRoot(archivePath string) string {
	sum := sha256.Sum256([]byte(archivePath))
	return filepath.Join(filepath.Dir(archivePath), mountPrefix+hex.EncodeToString(sum[:])[:16])
}

// makeMountRoot creates that folder, with two fallbacks that both keep the
// mount as close to the archive as the disk allows.
func (a *Archive) makeMountRoot(archivePath string) (string, error) {
	beside := filepath.Dir(archivePath)
	a.sweepStaleMounts(beside)

	err := os.Mkdir(mountRoot(archivePath), 0o755)
	switch {
	case err == nil:
		return mountRoot(archivePath), nil

	case errors.Is(err, fs.ErrExist):
		// The sweep leaves live mounts alone, so this is a second pane opening
		// the same archive while the first extraction is still running. A
		// randomly-named sibling is still beside the archive.
		return os.MkdirTemp(beside, mountPrefix)

	default:
		// The archive's own folder cannot be written to — a read-only volume,
		// or an archive nested inside another mount, whose contents are made
		// read-only by design. The system temp directory is where every mount
		// lived before §M21, so it is the fallback that is known to work.
		return os.MkdirTemp("", mountPrefix)
	}
}

// sweepStaleMounts clears mounts a crash left in one directory.
//
// Orphans used to be invisible in the system temp directory and were swept once
// at startup; beside an archive they sit in a folder the user opens, so they are
// cleared whenever the app next browses anything in it — the one moment it has a
// reason to read that directory anyway.
//
// Mounts this process is holding are skipped. That, and the prefix, is the whole
// safety story for a recursive delete running inside the user's own folders:
// nothing without the prefix is touched, and nothing in use is touched. Like the
// startup sweep it assumes one running instance, which is the assumption Sweep
// has made since §M18.
func (a *Archive) sweepStaleMounts(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), mountPrefix) {
			continue
		}
		root := filepath.Join(dir, entry.Name())

		a.mu.Lock()
		held := a.mounts[root]
		a.mu.Unlock()
		if held {
			continue
		}
		_ = removeMount(root)
	}
}

// ReleaseMount removes a mount and the hashed directory holding it.
//
// Refuses anything that is not one of ours. This function deletes recursively
// and, since §M21, does so inside the user's own folders rather than in a temp
// directory — so the guard is the whole safety story, and it is two checks: the
// app's prefix, *and* a root this process actually handed out. A mount in the
// system temp directory is accepted without the second, because that is where
// the fallback and every pre-§M21 mount lives.
func (a *Archive) ReleaseMount(mountPath string) error {
	root := filepath.Dir(filepath.Clean(mountPath))
	if !strings.HasPrefix(filepath.Base(root), mountPrefix) {
		return archiveError(mountPath, "that is not an archive mount")
	}

	a.mu.Lock()
	ours := a.mounts[root]
	delete(a.mounts, root)
	a.mu.Unlock()

	if !ours && filepath.Dir(root) != filepath.Clean(os.TempDir()) {
		return archiveError(mountPath, "that is not an archive mount")
	}

	if err := removeMount(root); err != nil {
		return wrapError(mountPath, err)
	}
	return nil
}

// removeMount clears the read-only bits first, or RemoveAll cannot unlink.
func removeMount(root string) error {
	_ = makeWritable(root)
	return os.RemoveAll(root)
}

/* ---------- jobs ---------- */

func (a *Archive) begin() (string, context.Context) {
	ctx, cancel := context.WithCancel(context.Background())

	a.mu.Lock()
	a.counter++
	id := "archive-" + strconv.Itoa(a.counter)
	a.running[id] = cancel
	a.mu.Unlock()

	return id, ctx
}

func (a *Archive) finish(id string) {
	a.mu.Lock()
	delete(a.running, id)
	a.mu.Unlock()
}

// Cancel stops a running job. Unknown ids are not an error: the UI cancels on
// unmount, which races with the job finishing on its own.
func (a *Archive) Cancel(id string) error {
	a.mu.Lock()
	cancel := a.running[id]
	delete(a.running, id)
	a.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	return nil
}

// Extract starts an extraction and returns its id immediately.
func (a *Archive) Extract(request ExtractRequest) (string, error) {
	kind, err := Detect(request.Path)
	if err != nil {
		return "", err
	}
	if !kind.Archive() {
		return "", archiveError(request.Path, "this file is not an archive we can open")
	}
	if request.Destination == "" {
		return "", archiveError(request.Path, "an extraction needs somewhere to go")
	}

	id, ctx := a.begin()
	go a.runExtract(ctx, id, request, kind)
	return id, nil
}

func (a *Archive) runExtract(
	ctx context.Context,
	id string,
	request ExtractRequest,
	kind Kind,
) {
	defer a.finish(id)

	if err := os.MkdirAll(request.Destination, 0o755); err != nil {
		a.emitDone(Done{ID: id, Error: wrapError(request.Destination, err).Error()})
		return
	}

	job := &extraction{
		ctx:      ctx,
		request:  request,
		maxBytes: request.MaxBytes,
		maxItems: request.MaxEntries,
		report: func(entry string, done, total int64) {
			a.emitProgress(Progress{ID: id, Entry: entry, Done: done, Total: total})
		},
	}

	var err error
	switch {
	case kind.Format == FormatZip:
		err = job.fromZip()
	case kind.Format == Format7z:
		err = job.from7z()
	case kind.Format == FormatRar:
		err = job.fromRar()
	case kind.Format == FormatTar:
		err = job.fromPlainTar()
	default:
		err = job.fromStream(kind)
	}

	done := Done{ID: id, Path: request.Destination, Entries: job.entries, Bytes: job.written}

	switch {
	case err == nil:
		// Nothing to report.
	case ctx.Err() != nil:
		done.Cancelled = true
	case strings.HasPrefix(err.Error(), "fs-error:"):
		// Already encoded — a password prompt, most often.
		done.Error = err.Error()
	default:
		done.Error = archiveError(request.Path, err.Error()).Error()
	}

	if done.Error != "" || done.Cancelled {
		// A half-extracted folder is worse than none: the name is taken, and
		// nothing says which files are missing.
		_ = removeIfOurs(request.Destination)
		a.emitDone(done)
		return
	}

	if request.CollapseRoot {
		if moved, collapseErr := collapseSingleRoot(request.Destination); collapseErr == nil {
			done.Path = moved
		}
	}
	if request.ReadOnly {
		_ = makeReadOnly(done.Path)
	}

	a.emitDone(done)
}

// removeIfOurs cleans up a failed extraction without ever touching a folder
// that already held something. Uncompress extracts into a folder it just made,
// and a browse into a mount root it just made, so both are safe to remove;
// anything else is left alone.
func removeIfOurs(destination string) error {
	base := filepath.Base(filepath.Dir(filepath.Clean(destination)))
	if strings.HasPrefix(base, mountPrefix) {
		return os.RemoveAll(filepath.Dir(filepath.Clean(destination)))
	}
	return os.RemoveAll(destination)
}
