// Package watcher reports filesystem changes under directories the UI is
// showing.
//
// It emits one coalesced "fs:change" event per directory per quiet window,
// never one per underlying syscall. That is the whole point: extracting an
// archive into a watched folder produces thousands of raw events, and
// forwarding them would turn one user action into thousands of React Query
// invalidations (PLAN.md §3, "Watcher storms").
//
// As everywhere else in backend/, this reports and does not decide. It does not
// know which directories are on screen, does not reference-count watchers, and
// does not refetch anything — the frontend owns all of that.
package watcher

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// EventName is the Wails event the frontend subscribes to.
const EventName = "fs:change"

const (
	// quietWindow is how long a directory must be still before its batch is
	// emitted. Long enough to absorb the burst of a multi-file write, short
	// enough to feel immediate.
	quietWindow = 120 * time.Millisecond

	// maxWait bounds the delay for a directory that never goes quiet. Without
	// it, a folder being written to continuously would coalesce forever and the
	// user would watch a stale listing while files visibly arrived elsewhere.
	maxWait = 750 * time.Millisecond

	// tick is how often batches are checked for readiness.
	tick = quietWindow / 2

	// maxPaths caps the per-batch path list. The frontend invalidates by
	// directory, so the paths are diagnostic; an unbounded list would let a
	// 100k-file extraction build a 100k-element payload for no purpose.
	maxPaths = 64

	// maxEntries is the largest directory this will watch.
	//
	// fsnotify's kqueue backend — what macOS uses — opens a file descriptor per
	// entry in a watched directory, so watching /usr/lib would cost thousands of
	// descriptors and start failing unrelated syscalls. Declining is better than
	// destabilising the process; those directories simply have no live updates,
	// and Refresh still works.
	maxEntries = 4096
)

// Change is one coalesced batch. Mirrors FileSystemEvent in
// frontend/src/types/file.ts.
type Change struct {
	// Dir is the directory whose contents changed — the React Query key the
	// frontend invalidates.
	Dir string `json:"dir"`
	// Kinds are the distinct operations seen in this window, sorted.
	Kinds []string `json:"kinds"`
	// Paths are the entries seen changing, capped at maxPaths.
	Paths []string `json:"paths"`
	// Gone is true when Dir itself was removed or renamed away.
	Gone bool `json:"gone"`
}

type batch struct {
	kinds map[string]bool
	paths map[string]bool
	gone  bool
	first time.Time
	last  time.Time
}

// Watcher is bound to Wails; its exported methods become the TS bindings.
type Watcher struct {
	mu      sync.Mutex
	inner   *fsnotify.Watcher
	watched map[string]bool
	pending map[string]*batch

	// emit is a field rather than a direct runtime call so tests can capture
	// batches without a Wails runtime behind them.
	emit func(Change)
	done chan struct{}
}

func New() *Watcher {
	return &Watcher{
		watched: map[string]bool{},
		pending: map[string]*batch{},
		emit:    func(Change) {},
	}
}

// Start begins delivering events to the frontend.
//
// A package-level function rather than a method because Wails binds every
// exported method, and lifecycle control has no business being callable from
// JavaScript (same reasoning as backend/db's Open/Close).
func Start(w *Watcher, ctx context.Context) error {
	inner, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}

	raiseFileLimit()

	w.mu.Lock()
	w.inner = inner
	w.done = make(chan struct{})
	w.emit = func(change Change) { runtime.EventsEmit(ctx, EventName, change) }
	w.mu.Unlock()

	go w.run()
	return nil
}

// Stop releases every watch. Safe to call on a Watcher that never started.
func Stop(w *Watcher) error {
	w.mu.Lock()
	inner, done := w.inner, w.done
	w.inner, w.done = nil, nil
	w.watched = map[string]bool{}
	w.pending = map[string]*batch{}
	w.mu.Unlock()

	if done != nil {
		close(done)
	}
	if inner != nil {
		return inner.Close()
	}
	return nil
}

// Watch starts reporting changes in path. Idempotent: watching an already
// watched directory is a no-op, so the frontend's reference counting does not
// have to be perfect for correctness.
func (w *Watcher) Watch(path string) error {
	cleaned := filepath.Clean(path)

	w.mu.Lock()
	inner := w.inner
	already := w.watched[cleaned]
	w.mu.Unlock()

	if inner == nil {
		return watchError(cleaned, "the watcher is not running")
	}
	if already {
		return nil
	}

	info, err := os.Stat(cleaned)
	if err != nil {
		return watchError(cleaned, err.Error())
	}
	if !info.IsDir() {
		return watchError(cleaned, "only directories can be watched")
	}
	if count, err := countEntries(cleaned); err == nil && count > maxEntries {
		return watchError(cleaned, "the folder is too large to watch for live changes")
	}

	if err := inner.Add(cleaned); err != nil {
		return watchError(cleaned, err.Error())
	}

	w.mu.Lock()
	w.watched[cleaned] = true
	w.mu.Unlock()
	return nil
}

// Unwatch stops reporting changes in path. Unwatching something that is not
// watched is not an error — the frontend releases on unmount, which can happen
// after a watch already failed.
func (w *Watcher) Unwatch(path string) error {
	cleaned := filepath.Clean(path)

	w.mu.Lock()
	inner := w.inner
	watched := w.watched[cleaned]
	delete(w.watched, cleaned)
	delete(w.pending, cleaned)
	w.mu.Unlock()

	if inner == nil || !watched {
		return nil
	}
	if err := inner.Remove(cleaned); err != nil && !errors.Is(err, fsnotify.ErrNonExistentWatch) {
		return watchError(cleaned, err.Error())
	}
	return nil
}

func (w *Watcher) run() {
	w.mu.Lock()
	inner, done := w.inner, w.done
	w.mu.Unlock()
	if inner == nil {
		return
	}

	ticker := time.NewTicker(tick)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return
		case event, ok := <-inner.Events:
			if !ok {
				return
			}
			w.record(event, time.Now())
		case _, ok := <-inner.Errors:
			// A watch error concerns one path and must not stop the loop; the
			// affected directory simply stops updating live.
			if !ok {
				return
			}
		case now := <-ticker.C:
			for _, change := range w.collect(now) {
				w.emit(change)
			}
		}
	}
}

// record folds one raw event into its directory's batch.
func (w *Watcher) record(event fsnotify.Event, now time.Time) {
	path := filepath.Clean(event.Name)

	w.mu.Lock()
	defer w.mu.Unlock()

	// An event naming a watched directory itself means that directory was
	// removed or renamed away — distinct from a change to its contents, and the
	// pane showing it needs to know.
	if w.watched[path] && (event.Has(fsnotify.Remove) || event.Has(fsnotify.Rename)) {
		w.add(path, path, "remove", now)
		w.pending[path].gone = true
		return
	}

	dir := filepath.Dir(path)
	if !w.watched[dir] {
		// kqueue also reports events for entries inside a watched directory
		// whose own parent is not watched; nothing is listening for those.
		return
	}
	w.add(dir, path, kindOf(event), now)
}

// add must be called with the lock held.
func (w *Watcher) add(dir, path, kind string, now time.Time) {
	current, ok := w.pending[dir]
	if !ok {
		current = &batch{kinds: map[string]bool{}, paths: map[string]bool{}, first: now}
		w.pending[dir] = current
	}
	current.kinds[kind] = true
	if len(current.paths) < maxPaths {
		current.paths[path] = true
	}
	current.last = now
}

// collect removes and returns every batch that has gone quiet or hit maxWait.
func (w *Watcher) collect(now time.Time) []Change {
	w.mu.Lock()
	defer w.mu.Unlock()

	changes := make([]Change, 0, len(w.pending))
	for dir, current := range w.pending {
		quiet := now.Sub(current.last) >= quietWindow
		overdue := now.Sub(current.first) >= maxWait
		if !quiet && !overdue {
			continue
		}
		delete(w.pending, dir)
		changes = append(changes, toChange(dir, current))
	}

	// Deterministic order so a burst across several directories is reported the
	// same way every time.
	sort.Slice(changes, func(i, j int) bool { return changes[i].Dir < changes[j].Dir })
	return changes
}

func toChange(dir string, from *batch) Change {
	kinds := make([]string, 0, len(from.kinds))
	for kind := range from.kinds {
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)

	paths := make([]string, 0, len(from.paths))
	for path := range from.paths {
		paths = append(paths, path)
	}
	sort.Strings(paths)

	return Change{Dir: dir, Kinds: kinds, Paths: paths, Gone: from.gone}
}

// kindOf reduces an fsnotify op set to one label. The order matters: a single
// event can carry several bits, and the most structural one is the most useful
// to report.
func kindOf(event fsnotify.Event) string {
	switch {
	case event.Has(fsnotify.Create):
		return "create"
	case event.Has(fsnotify.Remove):
		return "remove"
	case event.Has(fsnotify.Rename):
		return "rename"
	case event.Has(fsnotify.Write):
		return "write"
	default:
		return "chmod"
	}
}

func countEntries(dir string) (int, error) {
	handle, err := os.Open(dir)
	if err != nil {
		return 0, err
	}
	defer func() { _ = handle.Close() }()

	// Reads at most maxEntries+1 names rather than the whole listing: the only
	// question is whether the directory is over the limit.
	names, err := handle.Readdirnames(maxEntries + 1)
	if err != nil && len(names) == 0 {
		return 0, err
	}
	return len(names), nil
}

// Mirrors the encoding in backend/filesystem/errors.go so the frontend bridge
// parses watcher failures through the same path.
func watchError(path, message string) error {
	encoded, err := json.Marshal(map[string]string{
		"code": "unknown", "path": path, "message": message,
	})
	if err != nil {
		return errors.New(message)
	}
	return errors.New("fs-error:" + string(encoded))
}
