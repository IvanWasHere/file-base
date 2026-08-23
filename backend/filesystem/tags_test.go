package filesystem

import (
	"os"
	"path/filepath"
	"testing"

	"howett.net/plist"
)

func tempFile(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatalf("could not create %s: %v", name, err)
	}
	return path
}

func TestSetTagsRoundTrips(t *testing.T) {
	fs := New()
	path := tempFile(t, "report.pdf")

	tags := []Tag{{Name: "Urgent", Color: 6}, {Name: "Work", Color: 4}}
	if err := fs.SetTags([]string{path}, tags); err != nil {
		t.Fatalf("SetTags: %v", err)
	}

	read, err := fs.ReadTags(path)
	if err != nil {
		t.Fatalf("ReadTags: %v", err)
	}
	if len(read) != 2 {
		t.Fatalf("expected 2 tags, got %#v", read)
	}
	if read[0] != tags[0] || read[1] != tags[1] {
		t.Fatalf("tags did not round trip: %#v", read)
	}
}

// The listing is where tags actually reach the UI; a round trip through
// SetTags/ReadTags alone would not prove Describe reads them.
func TestReadDirectoryReportsTags(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	path := filepath.Join(dir, "photo.png")
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := fs.SetTags([]string{path}, []Tag{{Name: "Holiday", Color: 5}}); err != nil {
		t.Fatalf("SetTags: %v", err)
	}

	items, err := fs.ReadDirectory(dir, false)
	if err != nil {
		t.Fatalf("ReadDirectory: %v", err)
	}
	item, ok := find(items, "photo.png")
	if !ok {
		t.Fatal("photo.png missing from the listing")
	}
	if len(item.Tags) != 1 || item.Tags[0].Name != "Holiday" || item.Tags[0].Color != 5 {
		t.Fatalf("listing did not carry the tag: %#v", item.Tags)
	}
}

// An untagged file is the overwhelmingly common case: it must be empty, not an
// error, and must not make the entry look broken.
func TestUntaggedFileHasNoTags(t *testing.T) {
	fs := New()
	path := tempFile(t, "plain.txt")

	tags, err := fs.ReadTags(path)
	if err != nil {
		t.Fatalf("ReadTags on an untagged file: %v", err)
	}
	if len(tags) != 0 {
		t.Fatalf("expected no tags, got %#v", tags)
	}
}

// Removing every tag has to remove the attribute, not write an empty array —
// otherwise a file the user untagged still carries tag metadata.
func TestSetTagsWithNoneClearsTheAttribute(t *testing.T) {
	fs := New()
	path := tempFile(t, "notes.md")

	if err := fs.SetTags([]string{path}, []Tag{{Name: "Draft", Color: 3}}); err != nil {
		t.Fatalf("SetTags: %v", err)
	}
	if err := fs.SetTags([]string{path}, nil); err != nil {
		t.Fatalf("SetTags(nil): %v", err)
	}

	raw, err := readTagsAttr(path)
	if err != nil {
		t.Fatalf("readTagsAttr: %v", err)
	}
	if raw != nil {
		t.Fatalf("attribute still present: %q", raw)
	}

	// And clearing an already-clear file is not an error.
	if err := fs.SetTags([]string{path}, nil); err != nil {
		t.Fatalf("clearing twice: %v", err)
	}
}

func TestSetTagsAppliesToEveryPath(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	paths := []string{filepath.Join(dir, "a.txt"), filepath.Join(dir, "b.txt")}
	for _, path := range paths {
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	if err := fs.SetTags(paths, []Tag{{Name: "Batch", Color: 2}}); err != nil {
		t.Fatalf("SetTags: %v", err)
	}
	for _, path := range paths {
		tags, err := fs.ReadTags(path)
		if err != nil || len(tags) != 1 || tags[0].Name != "Batch" {
			t.Fatalf("%s: %#v (%v)", path, tags, err)
		}
	}
}

// A missing path is a real error rather than an empty tag list: the caller
// asked about something that is not there.
func TestReadTagsOnMissingPathFails(t *testing.T) {
	fs := New()
	_, err := fs.ReadTags(filepath.Join(t.TempDir(), "nope.txt"))
	if payload := decodeError(t, err); payload.Code != "not-found" {
		t.Fatalf("expected not-found, got %q", payload.Code)
	}
}

func TestNormaliseTags(t *testing.T) {
	got := NormaliseTags([]Tag{
		{Name: "  Work  ", Color: 4},
		{Name: "", Color: 2},
		{Name: "   ", Color: 2},
		{Name: "work", Color: 6}, // duplicate, case-insensitively
		{Name: "Odd", Color: 42}, // outside the palette
		{Name: "Neg", Color: -1}, // and below it
	})

	want := []Tag{{Name: "Work", Color: 4}, {Name: "Odd", Color: 0}, {Name: "Neg", Color: 0}}
	if len(got) != len(want) {
		t.Fatalf("expected %d tags, got %#v", len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("tag %d: got %#v, want %#v", i, got[i], want[i])
		}
	}
}

// The older spelling — a bare name with no colour index — is what pre-Mavericks
// systems and some third-party taggers write. It has to decode, or those files
// would appear untagged.
func TestDecodeTagsAcceptsBothSpellings(t *testing.T) {
	raw, err := plist.Marshal(
		[]string{"Plain", "Coloured\n6", "Bad\nxyz", "\n3"},
		plist.BinaryFormat,
	)
	if err != nil {
		t.Fatal(err)
	}

	got := decodeTags(raw)
	want := []Tag{{Name: "Plain"}, {Name: "Coloured", Color: 6}, {Name: "Bad"}}
	if len(got) != len(want) {
		t.Fatalf("expected %d tags, got %#v", len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("tag %d: got %#v, want %#v", i, got[i], want[i])
		}
	}
}

// Anything that is not a plist of strings — a file tagged by something with its
// own ideas, or a truncated attribute — reads as no tags rather than failing.
func TestDecodeTagsRejectsGarbage(t *testing.T) {
	if got := decodeTags([]byte("not a property list")); got != nil {
		t.Fatalf("expected nil, got %#v", got)
	}
}
