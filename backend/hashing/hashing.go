// Package hashing computes file checksums (PLAN.md M14).
//
// The shape is M8's search, not M6's file operations, and that is the whole
// design: a checksum over a selection has unbounded duration, results that
// should appear as they land, and a user who closes the window meaning *stop*.
// So `Hash` returns an id immediately, digests arrive as events, and `Cancel`
// stops the work rather than letting it outlive the window that asked for it.
//
// Three constraints shape the rest:
//
//   - **Nothing is read into memory.** io.CopyBuffer from the file into the hash
//     writer with a fixed buffer, so a 20GB disk image costs `bufferSize` bytes,
//     not 20GB. Digests cross the bridge as hex strings — M10 learned the hard
//     way that a Go []byte marshals to a JSON array of numbers.
//
//   - **Progress is measured in bytes.** The common case is one large file,
//     where a file-count bar reads 0/1 for four minutes and then finishes.
//
//   - **A failed file fails its own row.** Permission denied on one file in a
//     selection of forty must not kill the batch — the same rule that keeps one
//     dangling symlink from making a directory unlistable.
//
// Correctness is pinned here rather than anywhere else: hashing_test.go checks
// every algorithm against published vectors, including the empty input, which
// is exactly where a wrong implementation looks right.
package hashing

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"

	"crypto/md5"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"

	"file-base/backend/filesystem"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Wails events. Three names rather than one with a discriminator, so the
// frontend routes a digest, a progress tick and completion without inspecting
// the payload — as in backend/search.
const (
	ResultEvent   = "hash:result"
	ProgressEvent = "hash:progress"
	DoneEvent     = "hash:done"
)

const (
	// bufferSize is the read buffer, per worker. Large enough that syscall
	// overhead disappears against disk throughput, small enough that four
	// workers hold a megabyte between them regardless of file size.
	bufferSize = 256 * 1024

	// progressInterval and progressBytes bound how often a running file reports
	// itself, whichever comes first — the watcher's reasoning, applied to a
	// different stream. A fast SSD would otherwise emit thousands of events a
	// second, and a slow network volume none for minutes.
	progressInterval = 100 * time.Millisecond
	progressBytes    = 64 << 20

	// maxWorkers bounds concurrency. Hashing is CPU- and IO-bound at once;
	// handing 200 selected files to 200 goroutines thrashes the disk and
	// finishes no sooner. Follows backend/thumbs' semaphore.
	maxWorkers = 4
)

// Algorithms, as the frontend spells them.
//
// Every one is in the standard library — the last place to want a third-party
// implementation is a feature whose only job is telling the truth about bytes.
//
// CRC32 is here as an integrity check, not a hash; MD5 and SHA-1 are here
// because published checksums still use them. Which of those is safe to trust
// is a question the UI answers, not this package (PLAN.md M14 decision 11).
var constructors = map[string]func() hash.Hash{
	"crc32":   func() hash.Hash { return crc32.NewIEEE() },
	"md5":     md5.New,
	"sha1":    sha1.New,
	"sha224":  sha256.New224,
	"sha256":  sha256.New,
	"sha384":  sha512.New384,
	"sha512":  sha512.New,
}

// Algorithms lists every algorithm this package can compute, sorted. Exported
// for the drift test that reads the frontend's own list: an algorithm offered
// in the sidebar that Go has never heard of would be a row that fails for a
// reason the user cannot act on.
func Algorithms() []string {
	names := make([]string, 0, len(constructors))
	for name := range constructors {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// Request is one job: a set of files and the single algorithm to run over them.
//
// One algorithm at a time is deliberate. Computing all seven in one pass shares
// the read, but SHA-512 and CRC32 are not remotely the same CPU cost, and it
// would mean paying for six columns nobody asked to see.
type Request struct {
	Paths     []string `json:"paths"`
	Algorithm string   `json:"algorithm"`
}

// Result is one file's outcome. Exactly one is emitted per path that was not
// cancelled — a digest or an error, never both.
type Result struct {
	ID     string `json:"id"`
	Path   string `json:"path"`
	Digest string `json:"digest"`
	// Bytes is what was actually read, so a row's progress bar can finish
	// against the same number it was counting up to.
	Bytes int64 `json:"bytes"`
	// Error carries the encoded `fs-error:` payload, so a failed row reaches the
	// UI as a typed FsError through the same decoder every other failure uses.
	Error string `json:"error"`
}

// Progress reports one file mid-read.
type Progress struct {
	ID        string `json:"id"`
	Path      string `json:"path"`
	BytesRead int64  `json:"bytesRead"`
	// Total is the size at the moment the file was opened. The listing carries
	// the same number, but a file can grow between the two, and the bar should
	// follow what is being read now.
	Total int64 `json:"total"`
}

// Done closes out a job. Exactly one is emitted per Hash.
type Done struct {
	ID        string `json:"id"`
	Completed int    `json:"completed"`
	Failed    int    `json:"failed"`
	Cancelled bool   `json:"cancelled"`
}

// Hashing is bound to Wails; its exported methods become the TS bindings.
type Hashing struct {
	mu      sync.Mutex
	running map[string]context.CancelFunc
	counter int

	// Emitters are fields so tests can collect events without a Wails runtime.
	emitResult   func(Result)
	emitProgress func(Progress)
	emitDone     func(Done)
}

func New() *Hashing {
	return &Hashing{
		running:      map[string]context.CancelFunc{},
		emitResult:   func(Result) {},
		emitProgress: func(Progress) {},
		emitDone:     func(Done) {},
	}
}

// Start wires the emitters to the Wails runtime.
//
// Package-level rather than a method because Wails binds every exported method,
// and lifecycle control should not be callable from JavaScript (as in
// backend/db, backend/watcher and backend/search).
func Start(h *Hashing, ctx context.Context) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.emitResult = func(result Result) { runtime.EventsEmit(ctx, ResultEvent, result) }
	h.emitProgress = func(progress Progress) { runtime.EventsEmit(ctx, ProgressEvent, progress) }
	h.emitDone = func(done Done) { runtime.EventsEmit(ctx, DoneEvent, done) }
}

// Stop cancels every running job. Called at shutdown.
func Stop(h *Hashing) {
	h.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(h.running))
	for _, cancel := range h.running {
		cancels = append(cancels, cancel)
	}
	h.running = map[string]context.CancelFunc{}
	h.mu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}
}

// Hash starts a job and returns its id immediately. Digests arrive as events.
func (h *Hashing) Hash(request Request) (string, error) {
	if _, ok := constructors[request.Algorithm]; !ok {
		// Rejected before an id exists: a job that can never produce a digest
		// should fail the call, not emit forty error rows saying the same thing.
		return "", hashError("", "there is no algorithm called "+strconv.Quote(request.Algorithm))
	}
	if len(request.Paths) == 0 {
		return "", hashError("", "there is nothing to hash")
	}

	ctx, cancel := context.WithCancel(context.Background())

	h.mu.Lock()
	h.counter++
	id := "hash-" + strconv.Itoa(h.counter)
	h.running[id] = cancel
	h.mu.Unlock()

	go h.run(ctx, id, request)
	return id, nil
}

// Cancel stops a running job. Unknown ids are not an error: the modal cancels
// on close, which can race with the job finishing on its own.
func (h *Hashing) Cancel(id string) error {
	h.mu.Lock()
	cancel := h.running[id]
	delete(h.running, id)
	h.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	return nil
}

func (h *Hashing) run(ctx context.Context, id string, request Request) {
	defer func() {
		h.mu.Lock()
		delete(h.running, id)
		h.mu.Unlock()
	}()

	workers := maxWorkers
	if len(request.Paths) < workers {
		workers = len(request.Paths)
	}

	queue := make(chan string)
	var (
		counts    sync.Mutex
		completed int
		failed    int
		group     sync.WaitGroup
	)

	for range workers {
		group.Add(1)
		go func() {
			defer group.Done()
			buffer := make([]byte, bufferSize)
			for path := range queue {
				result := h.hashOne(ctx, id, path, request.Algorithm, buffer)
				// Nil means the read was cancelled part-way. A half-read file has
				// no digest and no failure to report — the job's Done event says
				// what happened, once, rather than every abandoned row doing it.
				if result == nil {
					continue
				}

				counts.Lock()
				if result.Error == "" {
					completed++
				} else {
					failed++
				}
				counts.Unlock()

				h.emitResult(*result)
			}
		}()
	}

	for _, path := range request.Paths {
		select {
		case queue <- path:
		case <-ctx.Done():
			// The workers may already have returned, so this must not block on a
			// send nobody will receive.
		}
		if ctx.Err() != nil {
			break
		}
	}
	close(queue)
	group.Wait()

	h.emitDone(Done{
		ID:        id,
		Completed: completed,
		Failed:    failed,
		Cancelled: ctx.Err() != nil,
	})
}

// hashOne streams one file. Returns nil when cancellation stopped the read.
func (h *Hashing) hashOne(
	ctx context.Context,
	id, path, algorithm string,
	buffer []byte,
) *Result {
	cleaned := filepath.Clean(path)
	failure := func(err error) *Result {
		return &Result{ID: id, Path: cleaned, Error: err.Error()}
	}

	info, err := os.Stat(cleaned)
	if err != nil {
		return failure(filesystem.Wrap(cleaned, err))
	}
	if info.IsDir() {
		// The UI drops folders from the row list before asking (decision 8), so
		// this is a backstop rather than a path anyone should reach. A recursive
		// folder digest is a different feature with its own unanswered question:
		// what tree encoding?
		return failure(hashError(cleaned, "a folder has no checksum"))
	}

	file, err := os.Open(cleaned)
	if err != nil {
		return failure(filesystem.Wrap(cleaned, err))
	}
	defer func() { _ = file.Close() }()

	digest := constructors[algorithm]()
	reader := &progressReader{
		source: file,
		ctx:    ctx,
		total:  info.Size(),
		report: func(read int64) {
			h.emitProgress(Progress{ID: id, Path: cleaned, BytesRead: read, Total: info.Size()})
		},
	}

	read, err := io.CopyBuffer(digest, reader, buffer)
	if err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return failure(filesystem.Wrap(cleaned, err))
	}

	return &Result{ID: id, Path: cleaned, Digest: hex.EncodeToString(digest.Sum(nil)), Bytes: read}
}

// progressReader counts bytes on their way into the hash and reports them at a
// bounded rate. It is also where cancellation lands: a 20GB read has to notice
// the modal closing somewhere, and the read loop is the only place it can.
type progressReader struct {
	source io.Reader
	ctx    context.Context
	total  int64
	report func(int64)

	read       int64
	lastReport time.Time
	lastBytes  int64
}

func (r *progressReader) Read(buffer []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}

	n, err := r.source.Read(buffer)
	r.read += int64(n)

	now := time.Now()
	// The zero time makes the first read report immediately, so a row shows a
	// bar as soon as it starts rather than 100ms later.
	if now.Sub(r.lastReport) >= progressInterval || r.read-r.lastBytes >= progressBytes {
		r.lastReport = now
		r.lastBytes = r.read
		r.report(r.read)
	}
	return n, err
}

// Mirrors the encoding in backend/filesystem/errors.go for the failures that
// are this package's own judgement rather than the OS's; anything the OS said
// goes through filesystem.Wrap so it keeps its classification.
func hashError(path, message string) error {
	encoded, err := json.Marshal(map[string]string{
		"code": "unknown", "path": path, "message": message,
	})
	if err != nil {
		return errors.New(message)
	}
	return errors.New("fs-error:" + string(encoded))
}
