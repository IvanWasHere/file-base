package search

import (
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"

	"file-base/backend/filesystem"
)

// sink stands in for the Wails runtime so streaming can be asserted without a
// webview behind it.
type sink struct {
	mu      sync.Mutex
	batches []Batch
	done    []Done
}

func (s *sink) batch(b Batch) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.batches = append(s.batches, b)
}

func (s *sink) finish(d Done) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.done = append(s.done, d)
}

func (s *sink) items() []filesystem.FileItem {
	s.mu.Lock()
	defer s.mu.Unlock()
	var all []filesystem.FileItem
	for _, batch := range s.batches {
		all = append(all, batch.Items...)
	}
	return all
}

func (s *sink) completed() (Done, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.done) == 0 {
		return Done{}, false
	}
	return s.done[0], true
}

func (s *sink) batchCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.batches)
}

func newTesting() (*Search, *sink) {
	collector := &sink{}
	finder := New()
	finder.emitBatch = collector.batch
	finder.emitDone = collector.finish
	return finder, collector
}

// waitForDone polls rather than sleeping a fixed amount, so the tests are not
// tuned to machine speed.
func waitForDone(t *testing.T, collector *sink, timeout time.Duration) Done {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if done, ok := collector.completed(); ok {
			return done
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("search did not finish within %s", timeout)
	return Done{}
}

func names(items []filesystem.FileItem) []string {
	result := make([]string, 0, len(items))
	for _, item := range items {
		result = append(result, item.Name)
	}
	sort.Strings(result)
	return result
}

// tree builds a small fixture:
//
//	root/notes.txt, root/report.pdf, root/.hidden.txt
//	root/nested/deep-notes.txt, root/nested/image.PNG
//	root/.git/config
func tree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()

	mkdir := func(path string) {
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	write := func(path string, size int) {
		if err := os.WriteFile(path, make([]byte, size), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	mkdir(filepath.Join(root, "nested"))
	mkdir(filepath.Join(root, ".git"))
	write(filepath.Join(root, "notes.txt"), 10)
	write(filepath.Join(root, "report.pdf"), 5000)
	write(filepath.Join(root, ".hidden.txt"), 10)
	write(filepath.Join(root, "nested", "deep-notes.txt"), 20)
	write(filepath.Join(root, "nested", "image.PNG"), 100)
	write(filepath.Join(root, ".git", "config"), 10)

	return root
}

func TestFindsMatchesAcrossTheTree(t *testing.T) {
	finder, collector := newTesting()
	root := tree(t)

	if _, err := finder.Find(Criteria{Query: "notes", Root: root}); err != nil {
		t.Fatal(err)
	}
	done := waitForDone(t, collector, 3*time.Second)

	if got := names(collector.items()); len(got) != 2 {
		t.Fatalf("names = %v, want notes.txt and deep-notes.txt", got)
	}
	if done.Matched != 2 {
		t.Errorf("matched = %d, want 2", done.Matched)
	}
	if done.Cancelled || done.Truncated || done.Error != "" {
		t.Errorf("unexpected outcome: %+v", done)
	}
}

func TestMatchingIsCaseInsensitive(t *testing.T) {
	finder, collector := newTesting()
	root := tree(t)

	if _, err := finder.Find(Criteria{Query: "NOTES", Root: root}); err != nil {
		t.Fatal(err)
	}
	waitForDone(t, collector, 3*time.Second)

	if got := len(collector.items()); got != 2 {
		t.Errorf("matched %d, want 2", got)
	}
}

// A hidden directory is skipped whole: nothing inside it is visible to a user
// who asked not to see hidden files, and descending into .git would dominate
// the scan of a source tree.
func TestHiddenEntriesAreSkippedUnlessAsked(t *testing.T) {
	finder, collector := newTesting()
	root := tree(t)

	if _, err := finder.Find(Criteria{Query: "", Root: root}); err != nil {
		t.Fatal(err)
	}
	waitForDone(t, collector, 3*time.Second)

	for _, name := range names(collector.items()) {
		if name == ".hidden.txt" || name == "config" || name == ".git" {
			t.Fatalf("hidden entry %q leaked into the results", name)
		}
	}

	finder, collector = newTesting()
	if _, err := finder.Find(Criteria{Query: "", Root: root, IncludeHidden: true}); err != nil {
		t.Fatal(err)
	}
	waitForDone(t, collector, 3*time.Second)

	var sawConfig bool
	for _, name := range names(collector.items()) {
		if name == "config" {
			sawConfig = true
		}
	}
	if !sawConfig {
		t.Error("includeHidden did not descend into a hidden directory")
	}
}

func TestFiltersByKindExtensionSizeAndDate(t *testing.T) {
	root := tree(t)

	t.Run("kind", func(t *testing.T) {
		finder, collector := newTesting()
		if _, err := finder.Find(Criteria{Root: root, Kind: "folder"}); err != nil {
			t.Fatal(err)
		}
		waitForDone(t, collector, 3*time.Second)
		if got := names(collector.items()); len(got) != 1 || got[0] != "nested" {
			t.Errorf("folders = %v, want [nested]", got)
		}
	})

	t.Run("extension", func(t *testing.T) {
		finder, collector := newTesting()
		// Deliberately upper-case in the fixture and dotted in the criteria:
		// both sides are normalised.
		if _, err := finder.Find(Criteria{Root: root, Extensions: []string{".PNG"}}); err != nil {
			t.Fatal(err)
		}
		waitForDone(t, collector, 3*time.Second)
		if got := names(collector.items()); len(got) != 1 || got[0] != "image.PNG" {
			t.Errorf("by extension = %v, want [image.PNG]", got)
		}
	})

	t.Run("size", func(t *testing.T) {
		finder, collector := newTesting()
		if _, err := finder.Find(Criteria{Root: root, MinSize: 1000}); err != nil {
			t.Fatal(err)
		}
		waitForDone(t, collector, 3*time.Second)
		// Folders are excluded, not exempted: otherwise asking for large files
		// would hand back every directory in the tree.
		if got := names(collector.items()); len(got) != 1 || got[0] != "report.pdf" {
			t.Errorf("by size = %v, want [report.pdf]", got)
		}
	})

	t.Run("date", func(t *testing.T) {
		finder, collector := newTesting()
		future := time.Now().Add(time.Hour).UnixMilli()
		if _, err := finder.Find(Criteria{Root: root, ModifiedAfter: future}); err != nil {
			t.Fatal(err)
		}
		waitForDone(t, collector, 3*time.Second)
		if got := collector.items(); len(got) != 0 {
			t.Errorf("nothing should be modified in the future: %v", names(got))
		}
	})
}

// Results have to arrive while the walk is still going, or a slow search shows
// an empty pane for its whole duration.
func TestStreamsInBatches(t *testing.T) {
	finder, collector := newTesting()
	root := t.TempDir()
	for index := range 300 {
		name := filepath.Join(root, "match-"+itoa(index)+".txt")
		if err := os.WriteFile(name, nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}

	if _, err := finder.Find(Criteria{Query: "match", Root: root}); err != nil {
		t.Fatal(err)
	}
	waitForDone(t, collector, 5*time.Second)

	if collector.batchCount() < 2 {
		t.Errorf("300 results arrived in %d batch(es); they should stream", collector.batchCount())
	}
	if got := len(collector.items()); got != 300 {
		t.Errorf("got %d results, want 300", got)
	}
}

func TestTruncatesAtTheLimit(t *testing.T) {
	finder, collector := newTesting()
	root := t.TempDir()
	for index := range 50 {
		if err := os.WriteFile(filepath.Join(root, "f"+itoa(index)+".txt"), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}

	if _, err := finder.Find(Criteria{Root: root, MaxResults: 10}); err != nil {
		t.Fatal(err)
	}
	done := waitForDone(t, collector, 3*time.Second)

	if !done.Truncated {
		t.Error("the result cap was not reported as truncation")
	}
	if done.Matched != 10 {
		t.Errorf("matched = %d, want 10", done.Matched)
	}
}

func TestCancelStopsTheWalk(t *testing.T) {
	finder, collector := newTesting()
	root := t.TempDir()
	// Deep enough that the walk is still running when Cancel lands.
	current := root
	for depth := range 40 {
		current = filepath.Join(current, "level"+itoa(depth))
		if err := os.MkdirAll(current, 0o755); err != nil {
			t.Fatal(err)
		}
		for index := range 40 {
			if err := os.WriteFile(filepath.Join(current, "f"+itoa(index)+".txt"), nil, 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}

	id, err := finder.Find(Criteria{Query: "f", Root: root})
	if err != nil {
		t.Fatal(err)
	}
	if err := finder.Cancel(id); err != nil {
		t.Fatal(err)
	}

	done := waitForDone(t, collector, 5*time.Second)
	if !done.Cancelled {
		t.Errorf("expected a cancelled search, got %+v", done)
	}
	if done.Scanned >= 40*40 {
		t.Errorf("scanned %d entries after cancelling; it did not stop early", done.Scanned)
	}
}

// The frontend cancels on unmount, which races with the search finishing on
// its own.
func TestCancelIsForgiving(t *testing.T) {
	finder, _ := newTesting()
	if err := finder.Cancel("search-does-not-exist"); err != nil {
		t.Errorf("cancelling an unknown search should be a no-op: %v", err)
	}
}

func TestFindRejectsAnEmptyRoot(t *testing.T) {
	finder, _ := newTesting()
	if _, err := finder.Find(Criteria{Query: "x"}); err == nil {
		t.Fatal("a search with no root was allowed")
	}
}

// One unreadable directory must not fail an otherwise good search — on macOS
// that is routinely a TCC-protected folder inside a fine tree.
func TestUnreadableDirectoriesAreSkipped(t *testing.T) {
	finder, collector := newTesting()
	root := t.TempDir()

	blocked := filepath.Join(root, "blocked")
	if err := os.Mkdir(blocked, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(blocked, "secret.txt"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "visible.txt"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(blocked, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(blocked, 0o755) })

	if _, err := finder.Find(Criteria{Query: ".txt", Root: root}); err != nil {
		t.Fatal(err)
	}
	done := waitForDone(t, collector, 3*time.Second)

	if done.Error != "" {
		t.Errorf("an unreadable subdirectory failed the whole search: %q", done.Error)
	}
	if got := names(collector.items()); len(got) != 1 || got[0] != "visible.txt" {
		t.Errorf("results = %v, want [visible.txt]", got)
	}
}

func TestExtensionOf(t *testing.T) {
	cases := map[string]string{
		"notes.txt":   "txt",
		"image.PNG":   "png",
		"archive.tar": "tar",
		"README":      "",
		".gitignore":  "",
	}
	for name, want := range cases {
		if got := extensionOf(name); got != want {
			t.Errorf("extensionOf(%q) = %q, want %q", name, got, want)
		}
	}
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
