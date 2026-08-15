package archive

import (
	"os"
	"testing"
)

// Hand check against a real rar, which nothing can create (PLAN.md §M18).
// Skips unless FILEBASE_RAR_FIXTURE names one.
func TestRealRarExtracts(t *testing.T) {
	path := os.Getenv("FILEBASE_RAR_FIXTURE")
	if path == "" {
		t.Skip("set FILEBASE_RAR_FIXTURE to a real .rar")
	}

	kind, err := Detect(path)
	if err != nil {
		t.Fatalf("detect: %v", err)
	}
	t.Logf("detected format=%q isArchive=%v", kind.Format, kind.Format != FormatUnknown)
	if kind.Format != FormatRar {
		t.Fatalf("format = %q, want %q", kind.Format, FormatRar)
	}

	destination := t.TempDir()
	done := extract(t, path, destination, "")
	if done.Error != "" {
		t.Fatalf("extract: %s", done.Error)
	}

	out := files(destination)

	// Bytes, not just names: a decoder that produced the right tree of empty
	// files would pass every check above it.
	var total int64
	var empty int
	for _, name := range out {
		info, err := os.Stat(destination + "/" + name)
		if err != nil {
			t.Fatalf("stat %s: %v", name, err)
		}
		total += info.Size()
		if info.Size() == 0 {
			empty++
		}
	}
	t.Logf("extracted %d files, %d bytes, %d empty", len(out), total, empty)
	for index, name := range out {
		if index >= 10 {
			t.Logf("  … and %d more", len(out)-10)
			break
		}
		t.Logf("  %s", name)
	}
	if len(out) == 0 {
		t.Fatal("no files extracted")
	}
}
