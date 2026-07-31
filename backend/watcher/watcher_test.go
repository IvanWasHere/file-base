package watcher

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
)

// collector stands in for the Wails runtime, so batching can be asserted
// without a webview behind it.
type collector struct {
	mu      sync.Mutex
	changes []Change
}

func (c *collector) record(change Change) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.changes = append(c.changes, change)
}

func (c *collector) all() []Change {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]Change(nil), c.changes...)
}

// startTesting wires a real fsnotify watcher to a collector instead of the
// Wails runtime. Mirrors Start, minus the event emitter.
func startTesting(t *testing.T) (*Watcher, *collector) {
	t.Helper()

	inner, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatal(err)
	}

	sink := &collector{}
	w := New()
	w.inner = inner
	w.done = make(chan struct{})
	w.emit = sink.record

	go w.run()
	t.Cleanup(func() { _ = Stop(w) })

	return w, sink
}

// waitForChanges polls until at least one batch has been emitted, so tests do
// not encode a fixed sleep.
func waitForChanges(t *testing.T, sink *collector, timeout time.Duration) []Change {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if changes := sink.all(); len(changes) > 0 {
			// Let any straggler batch land before asserting on the set.
			time.Sleep(quietWindow + tick)
			return sink.all()
		}
		time.Sleep(tick)
	}
	t.Fatalf("no change was emitted within %s", timeout)
	return nil
}

func decodeError(t *testing.T, err error) map[string]string {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
	message := err.Error()
	if !strings.HasPrefix(message, "fs-error:") {
		t.Fatalf("error is not encoded for the bridge: %q", message)
	}
	var payload map[string]string
	if decodeErr := json.Unmarshal([]byte(strings.TrimPrefix(message, "fs-error:")), &payload); decodeErr != nil {
		t.Fatalf("error payload is not valid JSON: %v", decodeErr)
	}
	return payload
}

func TestReportsACreate(t *testing.T) {
	w, sink := startTesting(t)
	dir := t.TempDir()

	if err := w.Watch(dir); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}

	changes := waitForChanges(t, sink, 3*time.Second)
	if len(changes) != 1 {
		t.Fatalf("expected one batch, got %+v", changes)
	}
	if changes[0].Dir != dir {
		t.Errorf("dir = %q, want %q", changes[0].Dir, dir)
	}
	if !contains(changes[0].Kinds, "create") {
		t.Errorf("kinds = %v, want a create", changes[0].Kinds)
	}
	if !contains(changes[0].Paths, filepath.Join(dir, "notes.txt")) {
		t.Errorf("paths = %v", changes[0].Paths)
	}
}

// The whole reason this package coalesces: one archive extraction must not
// become one invalidation per file.
func TestCoalescesABurst(t *testing.T) {
	w, sink := startTesting(t)
	dir := t.TempDir()

	if err := w.Watch(dir); err != nil {
		t.Fatal(err)
	}
	for index := range 200 {
		name := filepath.Join(dir, "file-"+string(rune('a'+index%26))+string(rune('a'+index/26))+".txt")
		if err := os.WriteFile(name, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	changes := waitForChanges(t, sink, 5*time.Second)
	t.Logf("200 writes coalesced into %d batches", len(changes))

	// A few batches are acceptable — maxWait deliberately flushes a directory
	// that never goes quiet — but it must be nothing like one per file.
	if len(changes) > 6 {
		t.Fatalf("200 writes produced %d batches; coalescing is not working", len(changes))
	}
	for _, change := range changes {
		if change.Dir != dir {
			t.Errorf("unexpected dir %q", change.Dir)
		}
		if len(change.Paths) > maxPaths {
			t.Errorf("paths not capped: %d", len(change.Paths))
		}
	}
}

func TestReportsTheWatchedDirectoryDisappearing(t *testing.T) {
	w, sink := startTesting(t)
	parent := t.TempDir()
	dir := filepath.Join(parent, "doomed")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	if err := w.Watch(dir); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}

	changes := waitForChanges(t, sink, 3*time.Second)

	var gone bool
	for _, change := range changes {
		if change.Dir == dir && change.Gone {
			gone = true
		}
	}
	if !gone {
		t.Fatalf("the watched directory vanishing was not reported: %+v", changes)
	}
}

func TestUnwatchStopsReporting(t *testing.T) {
	w, sink := startTesting(t)
	dir := t.TempDir()

	if err := w.Watch(dir); err != nil {
		t.Fatal(err)
	}
	if err := w.Unwatch(dir); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(maxWait + 3*tick)

	if changes := sink.all(); len(changes) != 0 {
		t.Fatalf("events kept arriving after Unwatch: %+v", changes)
	}
}

// The frontend reference-counts watches, and releases on unmount can arrive
// after a watch already failed. Neither case may become an error.
func TestWatchAndUnwatchAreForgiving(t *testing.T) {
	w, _ := startTesting(t)
	dir := t.TempDir()

	if err := w.Watch(dir); err != nil {
		t.Fatal(err)
	}
	if err := w.Watch(dir); err != nil {
		t.Fatalf("watching twice should be a no-op: %v", err)
	}
	if err := w.Unwatch(filepath.Join(dir, "never-watched")); err != nil {
		t.Fatalf("unwatching something unwatched should be a no-op: %v", err)
	}
}

func TestWatchRejectsNonDirectories(t *testing.T) {
	w, _ := startTesting(t)
	dir := t.TempDir()
	file := filepath.Join(dir, "notes.txt")
	if err := os.WriteFile(file, []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}

	if payload := decodeError(t, w.Watch(file)); !strings.Contains(payload["message"], "directories") {
		t.Errorf("message = %q", payload["message"])
	}
	if payload := decodeError(t, w.Watch(filepath.Join(dir, "ghost"))); payload["path"] == "" {
		t.Error("the error should name the path")
	}
}

// kqueue holds a descriptor per entry in a watched directory, so an enormous
// folder is declined rather than allowed to exhaust the process.
func TestWatchDeclinesHugeDirectories(t *testing.T) {
	w, _ := startTesting(t)
	dir := t.TempDir()

	for index := range maxEntries + 1 {
		name := filepath.Join(dir, "f"+itoa(index))
		if err := os.WriteFile(name, nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}

	payload := decodeError(t, w.Watch(dir))
	if !strings.Contains(payload["message"], "too large") {
		t.Errorf("message = %q", payload["message"])
	}
}

func TestWatchBeforeStart(t *testing.T) {
	w := New()
	if payload := decodeError(t, w.Watch(t.TempDir())); !strings.Contains(payload["message"], "not running") {
		t.Errorf("message = %q", payload["message"])
	}
	// Stopping a watcher that never started must not panic.
	if err := Stop(w); err != nil {
		t.Fatal(err)
	}
}

func TestKindOf(t *testing.T) {
	cases := []struct {
		op   fsnotify.Op
		want string
	}{
		{fsnotify.Create, "create"},
		{fsnotify.Remove, "remove"},
		{fsnotify.Rename, "rename"},
		{fsnotify.Write, "write"},
		{fsnotify.Chmod, "chmod"},
		// A single event can carry several bits; the structural one wins.
		{fsnotify.Create | fsnotify.Write, "create"},
	}
	for _, testCase := range cases {
		if got := kindOf(fsnotify.Event{Op: testCase.op}); got != testCase.want {
			t.Errorf("kindOf(%v) = %q, want %q", testCase.op, got, testCase.want)
		}
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	digits := ""
	for value > 0 {
		digits = string(rune('0'+value%10)) + digits
		value /= 10
	}
	return digits
}
