package textfile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// write puts content in a temp file and returns its path.
func write(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "sample.log")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestReadChunkReturnsTheWindowAtAnOffset(t *testing.T) {
	path := write(t, "0123456789abcdefghij")

	chunk, err := New().ReadChunk(path, 10, 5, false)
	if err != nil {
		t.Fatalf("ReadChunk: %v", err)
	}
	if chunk.Data != "abcde" {
		t.Fatalf("expected the five bytes at offset 10, got %q", chunk.Data)
	}
	if chunk.Offset != 10 || chunk.Length != 5 {
		t.Fatalf("expected offset 10 length 5, got %d/%d", chunk.Offset, chunk.Length)
	}
	if chunk.FileSize != 20 {
		t.Fatalf("expected the file size to travel with the chunk, got %d", chunk.FileSize)
	}
}

// The reason the package exists: what it costs to read the end of a file must
// not depend on how much file is in front of it. A sparse file is the cheapest
// way to say "very large" in a test — it occupies no disk — and reading the
// last bytes of a 4GB one has to be instant, which it only is if nothing walks
// there from the beginning.
func TestReadChunkSeeksRatherThanWalking(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sparse.bin")
	handle, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	const size = int64(4 << 30)
	if _, err := handle.WriteAt([]byte("the end"), size-7); err != nil {
		t.Fatal(err)
	}
	if err := handle.Close(); err != nil {
		t.Fatal(err)
	}

	chunk, err := New().ReadChunk(path, size-7, 16, false)
	if err != nil {
		t.Fatalf("ReadChunk: %v", err)
	}
	if chunk.Data != "the end" {
		t.Fatalf("expected the tail of the file, got %q", chunk.Data)
	}
	if chunk.FileSize != size {
		t.Fatalf("expected a %d byte file, got %d", size, chunk.FileSize)
	}
}

func TestReadChunkStopsAtTheEndOfTheFile(t *testing.T) {
	path := write(t, "short")

	chunk, err := New().ReadChunk(path, 2, 1024, false)
	if err != nil {
		t.Fatalf("ReadChunk: %v", err)
	}
	if chunk.Data != "ort" || chunk.Length != 3 {
		t.Fatalf("expected the last three bytes, got %q (%d)", chunk.Data, chunk.Length)
	}
}

func TestReadChunkClampsTheOffset(t *testing.T) {
	path := write(t, "hello")
	reader := New()

	before, err := reader.ReadChunk(path, -100, 8, false)
	if err != nil {
		t.Fatalf("ReadChunk: %v", err)
	}
	if before.Offset != 0 || before.Data != "hello" {
		t.Fatalf("a negative offset should read from the start, got %d %q", before.Offset, before.Data)
	}

	past, err := reader.ReadChunk(path, 9_000, 8, false)
	if err != nil {
		t.Fatalf("ReadChunk: %v", err)
	}
	if past.Offset != 5 || past.Length != 0 {
		t.Fatalf("an offset past the end should land at it, got %d/%d", past.Offset, past.Length)
	}
}

func TestReadChunkBoundsTheSize(t *testing.T) {
	path := write(t, strings.Repeat("x", 1024))
	reader := New()

	// 0 is what a caller with no preference sends; it must not mean "no bytes".
	fallback, err := reader.ReadChunk(path, 0, 0, false)
	if err != nil {
		t.Fatalf("ReadChunk: %v", err)
	}
	if fallback.Length != 1024 {
		t.Fatalf("expected the default chunk to cover this file, got %d", fallback.Length)
	}

	// The ceiling is what stops one call allocating whatever it likes.
	capped, err := reader.ReadChunk(path, 0, 1<<30, false)
	if err != nil {
		t.Fatalf("ReadChunk: %v", err)
	}
	if capped.Length != 1024 {
		t.Fatalf("expected the file, got %d bytes", capped.Length)
	}
}

func TestSnapToLineMovesBothEdges(t *testing.T) {
	path := write(t, "first line\nsecond line\nthird line\nfourth line\n")

	// Offset 15 and length 12 is the middle of "second line" through the middle
	// of "third line" — mid-word at both ends.
	chunk, err := New().ReadChunk(path, 15, 12, true)
	if err != nil {
		t.Fatalf("ReadChunk: %v", err)
	}
	if chunk.Data != "second line\n" {
		t.Fatalf("expected whole lines, got %q", chunk.Data)
	}
	if chunk.Offset != 11 {
		t.Fatalf("expected the start of the second line, got %d", chunk.Offset)
	}
	if !chunk.Snapped {
		t.Fatal("expected the chunk to report that it was snapped")
	}
}

func TestSnapToLineKeepsTheLastLineOfTheFile(t *testing.T) {
	// No trailing newline: the final line is whole because the file ends, and
	// cutting back to the previous newline would hide it entirely.
	path := write(t, "alpha\nomega")

	chunk, err := New().ReadChunk(path, 6, 64, true)
	if err != nil {
		t.Fatalf("ReadChunk: %v", err)
	}
	if chunk.Data != "omega" {
		t.Fatalf("expected the last line, got %q", chunk.Data)
	}
}

func TestSnapToLineGivesUpOnAnEnormousLine(t *testing.T) {
	// One line far longer than the budget, which is what a minified bundle or a
	// base64 blob looks like. The window has to come back as asked rather than
	// the reader reading megabytes hunting for an edge that is not there.
	path := write(t, strings.Repeat("x", 300*1024))

	chunk, err := New().ReadChunk(path, 200*1024, 1024, true)
	if err != nil {
		t.Fatalf("ReadChunk: %v", err)
	}
	if chunk.Offset != int64(200*1024) || chunk.Length != 1024 {
		t.Fatalf("expected the window as asked, got %d/%d", chunk.Offset, chunk.Length)
	}
	if chunk.Snapped {
		t.Fatal("expected Snapped false when no newline was in reach")
	}
}

// Stepping is Offset+Length, so snapped windows have to tile the file: every
// line exactly once, in order, with nothing dropped between chunks.
func TestSnappedWindowsTileTheFile(t *testing.T) {
	var builder strings.Builder
	for i := 0; i < 200; i++ {
		builder.WriteString("line ")
		builder.WriteString(strings.Repeat("y", i%40))
		builder.WriteString("\n")
	}
	content := builder.String()
	path := write(t, content)

	reader := New()
	var seen strings.Builder
	offset := int64(0)
	for steps := 0; ; steps++ {
		if steps > 500 {
			t.Fatal("stepping did not reach the end of the file")
		}
		chunk, err := reader.ReadChunk(path, offset, 64, true)
		if err != nil {
			t.Fatalf("ReadChunk: %v", err)
		}
		if chunk.Length == 0 {
			break
		}
		if chunk.Offset != offset {
			t.Fatalf("a window that follows the previous one should need no snapping: asked %d, got %d", offset, chunk.Offset)
		}
		seen.WriteString(chunk.Data)
		offset = chunk.Offset + int64(chunk.Length)
	}

	if seen.String() != content {
		t.Fatal("the windows did not reassemble into the file")
	}
}

func TestReadChunkReplacesInvalidUTF8(t *testing.T) {
	path := write(t, "ok\xff\xfebad")

	chunk, err := New().ReadChunk(path, 0, 64, false)
	if err != nil {
		t.Fatalf("ReadChunk: %v", err)
	}
	if !strings.Contains(chunk.Data, "�") {
		t.Fatalf("expected the bad bytes to be replaced, got %q", chunk.Data)
	}
	// The length is bytes on disk, not the length of the string: the caller
	// navigates with it, and a replacement character is three bytes standing in
	// for one.
	if chunk.Length != 7 {
		t.Fatalf("expected the on-disk length, got %d", chunk.Length)
	}
}

func TestReadChunkRefusesAFolder(t *testing.T) {
	if _, err := New().ReadChunk(t.TempDir(), 0, 64, false); err == nil {
		t.Fatal("expected reading a folder to fail")
	}
}

func TestReadChunkReportsAMissingFile(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "gone.log")
	_, err := New().ReadChunk(missing, 0, 64, false)
	if err == nil {
		t.Fatal("expected reading a missing file to fail")
	}
	// Encoded for the bridge, so the frontend sees `not-found` rather than prose.
	if !strings.Contains(err.Error(), "not-found") {
		t.Fatalf("expected a classified error, got %q", err.Error())
	}
}
