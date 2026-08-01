// Package search walks a directory tree and streams matching entries.
//
// Streaming rather than collecting: searching a home directory can take tens of
// seconds and touch hundreds of thousands of entries, and a user watching an
// empty pane for that long will assume the app is broken. Results are emitted
// in batches as they are found, and any search can be cancelled mid-walk.
//
// This is the one place criteria are applied inside Go, and it is deliberate.
// The PRD keeps filtering out of the backend because filtering is a UI
// decision — but a *search* is the user's explicit question, passed down whole,
// and it can only be answered while walking. Streaming half a million paths to
// TypeScript so it could discard all but nine would be the alternative.
// TypeScript still decides everything about the question and the answer: what
// is asked, how results are ordered, and what is shown.
package search

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"file-base/backend/filesystem"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Wails events. Two names rather than one with a flag, so the frontend can
// route progress and completion without inspecting a discriminator.
const (
	BatchEvent = "search:batch"
	DoneEvent  = "search:done"
)

const (
	// batchSize and batchInterval bound how often results reach the UI. A hit
	// in a deep tree can be seconds apart from the next, so time matters as
	// much as count: whichever comes first flushes.
	batchSize     = 64
	batchInterval = 100 * time.Millisecond

	// defaultMaxResults stops a pathological query ("e" over a home directory)
	// from streaming a quarter of a million rows into a virtualized list. The
	// frontend reports the truncation rather than pretending it found them all.
	defaultMaxResults = 5000
)

// Criteria is the whole question, as the user posed it.
type Criteria struct {
	// Query matches against the entry name, case-insensitively, as a substring.
	// Empty matches everything — which is what indexing a root uses.
	Query string `json:"query"`
	Root  string `json:"root"`
	// Extensions are lowercase and without the dot. Empty means any.
	Extensions []string `json:"extensions"`
	// Kind is "any", "file" or "folder".
	Kind string `json:"kind"`
	// Zero means unbounded, on all four.
	MinSize        int64 `json:"minSize"`
	MaxSize        int64 `json:"maxSize"`
	ModifiedAfter  int64 `json:"modifiedAfter"`  // unix milliseconds
	ModifiedBefore int64 `json:"modifiedBefore"` // unix milliseconds
	IncludeHidden  bool  `json:"includeHidden"`
	MaxResults     int   `json:"maxResults"`
}

// Batch is a chunk of results for one search.
type Batch struct {
	ID    string                `json:"id"`
	Items []filesystem.FileItem `json:"items"`
	// Scanned is entries visited so far — the number that makes a long search
	// look alive rather than hung.
	Scanned int `json:"scanned"`
}

// Done closes out a search. Exactly one is emitted per Find.
type Done struct {
	ID        string `json:"id"`
	Scanned   int    `json:"scanned"`
	Matched   int    `json:"matched"`
	Truncated bool   `json:"truncated"`
	Cancelled bool   `json:"cancelled"`
	// Error is a human-readable reason the walk could not start at all. A
	// directory that could not be read part-way through is skipped silently —
	// one unreadable folder must not fail an otherwise good search.
	Error string `json:"error"`
}

type Search struct {
	mu      sync.Mutex
	running map[string]context.CancelFunc
	counter int

	// Emitters are fields so tests can collect batches without a Wails runtime.
	emitBatch func(Batch)
	emitDone  func(Done)
}

func New() *Search {
	return &Search{
		running:   map[string]context.CancelFunc{},
		emitBatch: func(Batch) {},
		emitDone:  func(Done) {},
	}
}

// Start wires the emitters to the Wails runtime.
//
// Package-level rather than a method because Wails binds every exported method,
// and lifecycle control should not be callable from JavaScript (as in
// backend/db and backend/watcher).
func Start(s *Search, ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.emitBatch = func(batch Batch) { runtime.EventsEmit(ctx, BatchEvent, batch) }
	s.emitDone = func(done Done) { runtime.EventsEmit(ctx, DoneEvent, done) }
}

// Stop cancels every running search. Called at shutdown.
func Stop(s *Search) {
	s.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(s.running))
	for _, cancel := range s.running {
		cancels = append(cancels, cancel)
	}
	s.running = map[string]context.CancelFunc{}
	s.mu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}
}

// Find starts a search and returns its id immediately. Results arrive as
// events; the walk runs on its own goroutine.
func (s *Search) Find(criteria Criteria) (string, error) {
	root := filepath.Clean(criteria.Root)
	if root == "" || root == "." {
		return "", searchError("a search needs a folder to start from")
	}

	ctx, cancel := context.WithCancel(context.Background())

	s.mu.Lock()
	s.counter++
	id := "search-" + strconv.Itoa(s.counter)
	s.running[id] = cancel
	s.mu.Unlock()

	go s.walk(ctx, id, root, criteria)
	return id, nil
}

// Cancel stops a running search. Unknown ids are not an error: the frontend
// cancels on unmount, which can race with the search finishing on its own.
func (s *Search) Cancel(id string) error {
	s.mu.Lock()
	cancel := s.running[id]
	delete(s.running, id)
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	return nil
}

func (s *Search) walk(ctx context.Context, id, root string, criteria Criteria) {
	defer func() {
		s.mu.Lock()
		delete(s.running, id)
		s.mu.Unlock()
	}()

	limit := criteria.MaxResults
	if limit <= 0 {
		limit = defaultMaxResults
	}

	matcher := compile(criteria)

	var (
		pending   []filesystem.FileItem
		scanned   int
		matched   int
		truncated bool
		lastFlush = time.Now()
	)

	flush := func() {
		if len(pending) == 0 {
			return
		}
		s.emitBatch(Batch{ID: id, Items: pending, Scanned: scanned})
		pending = nil
		lastFlush = time.Now()
	}

	walkErr := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			// An unreadable directory is skipped, not fatal. On macOS this is
			// routinely a TCC-protected folder inside an otherwise fine tree,
			// and failing the whole search over one would be useless.
			if entry != nil && entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}

		// The root itself is where the search starts, not a result.
		if path == root {
			return nil
		}

		name := entry.Name()
		hidden := strings.HasPrefix(name, ".")
		if hidden && !criteria.IncludeHidden {
			// Skipping the whole subtree, not just the entry: nothing inside a
			// hidden directory is visible to a user who asked not to see hidden
			// files, and descending into .git would dominate the scan.
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}

		scanned++

		item := filesystem.Describe(path, false)
		if !matcher(item) {
			return nil
		}

		matched++
		pending = append(pending, item)

		if matched >= limit {
			truncated = true
			return errLimitReached
		}
		if len(pending) >= batchSize || time.Since(lastFlush) >= batchInterval {
			flush()
		}
		return nil
	})

	flush()

	done := Done{ID: id, Scanned: scanned, Matched: matched, Truncated: truncated}
	switch {
	case errors.Is(walkErr, errLimitReached):
		// Not an error: the cap was reached and reported as truncation.
	case ctx.Err() != nil:
		done.Cancelled = true
	case walkErr != nil:
		done.Error = walkErr.Error()
	}
	s.emitDone(done)
}

var errLimitReached = errors.New("result limit reached")

// compile turns criteria into a single predicate, doing the case folding and
// the extension set construction once rather than per entry.
func compile(criteria Criteria) func(filesystem.FileItem) bool {
	query := strings.ToLower(strings.TrimSpace(criteria.Query))

	extensions := map[string]bool{}
	for _, extension := range criteria.Extensions {
		trimmed := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(extension), "."))
		if trimmed != "" {
			extensions[trimmed] = true
		}
	}

	return func(item filesystem.FileItem) bool {
		if query != "" && !strings.Contains(strings.ToLower(item.Name), query) {
			return false
		}

		switch criteria.Kind {
		case "file":
			if item.IsDirectory {
				return false
			}
		case "folder":
			if !item.IsDirectory {
				return false
			}
		}

		if len(extensions) > 0 {
			if item.IsDirectory || !extensions[extensionOf(item.Name)] {
				return false
			}
		}

		// A size filter excludes directories rather than exempting them. A
		// directory's reported size is its own inode, not its contents, so
		// comparing it is meaningless — and letting folders through unfiltered
		// means asking for "10-100 MB" hands back every folder in the tree,
		// which is the opposite of narrowing.
		if criteria.MinSize > 0 || criteria.MaxSize > 0 {
			if item.IsDirectory {
				return false
			}
			if criteria.MinSize > 0 && item.Size < criteria.MinSize {
				return false
			}
			if criteria.MaxSize > 0 && item.Size > criteria.MaxSize {
				return false
			}
		}

		if criteria.ModifiedAfter > 0 && item.ModifiedAt < criteria.ModifiedAfter {
			return false
		}
		if criteria.ModifiedBefore > 0 && item.ModifiedAt > criteria.ModifiedBefore {
			return false
		}

		return true
	}
}

// extensionOf mirrors extname() in frontend/src/utils/path.ts: a leading dot
// names a hidden file, it does not introduce an extension.
func extensionOf(name string) string {
	index := strings.LastIndex(name, ".")
	if index <= 0 {
		return ""
	}
	return strings.ToLower(name[index+1:])
}

// Mirrors the encoding in backend/filesystem/errors.go so the frontend bridge
// parses search failures through the same path.
func searchError(message string) error {
	encoded, err := json.Marshal(map[string]string{
		"code": "unknown", "path": "", "message": message,
	})
	if err != nil {
		return errors.New(message)
	}
	return errors.New("fs-error:" + string(encoded))
}
