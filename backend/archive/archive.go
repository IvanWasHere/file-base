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

// mountPrefix names every temp folder this package creates.
//
// The startup sweep and every release are scoped to it, so neither can touch a
// directory the app did not make — which matters, because both of them delete.
const mountPrefix = "file-base-mount-"

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

// Sweep removes mounts left behind by a crash or a force-quit.
//
// A temp folder that is never reclaimed is a disk leak measured in gigabytes,
// and the one thing that cannot clean up after itself is a process that died.
// Scoped by prefix inside the system temp directory, so it can only ever remove
// something this package created.
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

// NewMount creates the temp folder a browsed archive is extracted into.
//
// The random component is a *directory* and the archive's own name is the leaf
// inside it, so the breadcrumb reads `… / Photos.zip / holiday` rather than
// `/var/folders/xy/T/file-base-mount-8f3k2` — unique either way, legible only
// this way (§M18 decision 7).
func (a *Archive) NewMount(archivePath string) (string, error) {
	name := filepath.Base(filepath.Clean(archivePath))
	if name == "" || name == "." || name == string(filepath.Separator) {
		name = "archive"
	}

	root, err := os.MkdirTemp("", mountPrefix)
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

// ReleaseMount removes a mount and the random directory holding it.
//
// Refuses anything that is not one of ours. This function deletes recursively,
// so the guard is the whole safety story: a bug elsewhere that passed a user
// path must not be able to erase it.
func (a *Archive) ReleaseMount(mountPath string) error {
	root := filepath.Dir(filepath.Clean(mountPath))
	if !strings.HasPrefix(filepath.Base(root), mountPrefix) {
		return archiveError(mountPath, "that is not an archive mount")
	}
	if filepath.Dir(root) != filepath.Clean(os.TempDir()) {
		return archiveError(mountPath, "that is not an archive mount")
	}

	a.mu.Lock()
	delete(a.mounts, root)
	a.mu.Unlock()

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
// and a mount into a temp directory, so both are safe to remove; anything else
// is left alone.
func removeIfOurs(destination string) error {
	base := filepath.Base(filepath.Dir(filepath.Clean(destination)))
	if strings.HasPrefix(base, mountPrefix) {
		return os.RemoveAll(filepath.Dir(filepath.Clean(destination)))
	}
	return os.RemoveAll(destination)
}
