// Package textfile reads one window of a file at a time (PLAN.md §M31).
//
// It exists so a 100GB log can be opened on a machine that could not hold a
// hundredth of it. Nothing here ever holds more than one chunk: the file is
// opened, one ReadAt lands in a buffer of the requested size, and the handle is
// closed. A 100GB file and a 10KB file cost the same.
//
// That is the whole difference from filesystem.ReadTextFile, which answers
// "the first N bytes" and is what the preview panel wants. This answers "the N
// bytes at offset X, and how big the file is", which is what a reader that can
// move around inside a file needs — and the file size travels with every chunk
// because the thing being read may be a log that is still being written to.
//
// Byte offsets, not line numbers. There is no way to know a line number at
// offset 52,428,800,000 without having read everything before it, which is the
// one thing this package must never do. Lines are a rendering of the bytes, and
// the only concession to them is snapToLine — a bounded scan for the newline
// nearest each edge of the window, so consecutive reads do not start and end
// mid-sentence.
//
// Read-only, deliberately. Writing into the middle of a file is only safe when
// the replacement is the same length as what it replaces; anything else shifts
// every byte after it, which for a file this size is a rewrite, not an edit
// (§M31 decision 9).
package textfile

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"file-base/backend/filesystem"
)

// TextFile is bound to Wails; its exported methods become the TS bindings.
type TextFile struct{}

func New() *TextFile {
	return &TextFile{}
}

const (
	// What a chunk size of 0 means. Large enough to fill a window with text,
	// small enough to be free.
	defaultChunkSize = 64 * 1024

	// The ceiling on one read. A chunk crosses the bridge as a JSON string, and
	// past a few megabytes the transfer and the rendering — not the disk — are
	// what makes the reader feel slow. It also bounds what any caller can make
	// this package allocate, which is the point of the package.
	maxChunkSize = 4 * 1024 * 1024

	// How far snapToLine will look for a newline on either edge.
	//
	// Fixed rather than proportional to the chunk, so a 10KB window and a 1MB
	// window behave the same way. A line longer than this is not a line — it is
	// a minified bundle or a base64 blob — and the window stays exactly where it
	// was asked for rather than reading megabytes to find an edge that may not
	// exist (§M31 decision 5).
	snapBudget = 64 * 1024
)

// Chunk is one window onto a file.
//
// Offset and Length describe bytes on disk and are what navigation is done
// with: the next window starts at Offset+Length. They are not the length of
// Data — invalid UTF-8 is replaced below, and one bad byte becomes three — so
// the caller must never measure the string to decide where it is.
type Chunk struct {
	// Offset is where the returned bytes actually start, which is not
	// necessarily where they were asked to: snapToLine moves it back to a line
	// boundary, and a request past the end of the file is clamped.
	Offset int64 `json:"offset"`
	// Length is how many bytes of the file this window covers.
	Length int    `json:"length"`
	Data   string `json:"data"`
	// FileSize is the size at the moment of the read. Reported with every chunk
	// rather than looked up once, because the common reason to open a file this
	// way is that something is still writing to it.
	FileSize int64 `json:"fileSize"`
	// Snapped is whether either edge was moved to a line boundary. False with
	// snapping switched off, and false when it was asked for but no newline was
	// within reach — the difference between "these are whole lines" and "this
	// is one line longer than the budget", which the reader says out loud.
	Snapped bool `json:"snapped"`
}

// ReadChunk returns the bytes of path at offset, at most size of them.
//
// offset and size are clamped rather than rejected: a reader that has just had
// its chunk size changed, or that is sitting at the end of a file which has
// since been truncated, is asking a reasonable question with stale numbers, and
// the answer is the nearest window that exists. The returned Offset and Length
// say where it landed, and everything the caller shows is read back from those.
//
// With snapToLine the window is moved to line boundaries: back to the byte
// after the newline preceding offset, and cut after the last newline it
// contains. Both scans are bounded (see snapBudget), and neither can return
// nothing — a window with no newline in reach is returned as asked, with
// Snapped false.
func (t *TextFile) ReadChunk(path string, offset int64, size int, snapToLine bool) (Chunk, error) {
	cleaned := filepath.Clean(path)

	if size <= 0 {
		size = defaultChunkSize
	}
	if size > maxChunkSize {
		size = maxChunkSize
	}

	handle, err := os.Open(cleaned)
	if err != nil {
		return Chunk{}, filesystem.Wrap(cleaned, err)
	}
	defer func() { _ = handle.Close() }()

	info, err := handle.Stat()
	if err != nil {
		return Chunk{}, filesystem.Wrap(cleaned, err)
	}
	// A folder opens and stats perfectly well; it is the read that fails, with
	// an error whose text would be about file descriptors. Said plainly instead.
	if info.IsDir() {
		return Chunk{}, filesystem.Wrap(cleaned, errors.New("That is a folder, not a file"))
	}

	fileSize := info.Size()
	if offset < 0 {
		offset = 0
	}
	if offset > fileSize {
		offset = fileSize
	}

	snapped := false
	if snapToLine && offset > 0 {
		if start, ok := lineStart(handle, offset); ok {
			offset = start
			snapped = true
		}
	}

	buffer := make([]byte, size)
	read, err := handle.ReadAt(buffer, offset)
	// EOF is how a short read at the end of the file reports itself, not a
	// failure — the bytes are in the buffer either way.
	if err != nil && !errors.Is(err, io.EOF) {
		return Chunk{}, filesystem.Wrap(cleaned, err)
	}
	window := buffer[:read]

	// Only worth cutting when there is more file after this window: the last
	// line of a file is whole whether or not it ends in a newline.
	if snapToLine && offset+int64(read) < fileSize {
		if cut := lineEnd(window); cut > 0 {
			window = window[:cut]
			snapped = true
		}
	}

	return Chunk{
		Offset: offset,
		Length: len(window),
		// Invalid UTF-8 is replaced rather than rejected, as ReadTextFile does:
		// Wails cannot marshal invalid UTF-8 at all, and a window that stops
		// mid-character — which every fixed-size window into a UTF-8 file
		// eventually does — should show one replacement character rather than
		// failing to open.
		Data:     strings.ToValidUTF8(string(window), "�"),
		FileSize: fileSize,
		Snapped:  snapped,
	}, nil
}

// lineStart finds the beginning of the line containing offset, looking back at
// most snapBudget bytes. Reports false when there is no newline in reach, which
// leaves the caller's offset alone.
func lineStart(handle *os.File, offset int64) (int64, bool) {
	from := offset - snapBudget
	if from < 0 {
		from = 0
	}

	buffer := make([]byte, offset-from)
	read, err := handle.ReadAt(buffer, from)
	if err != nil && !errors.Is(err, io.EOF) {
		return 0, false
	}

	index := strings.LastIndexByte(string(buffer[:read]), '\n')
	if index < 0 {
		// The start of the file is a line boundary, so a scan that reached it
		// has found one; anywhere else, the line is longer than the budget.
		return from, from == 0
	}
	return from + int64(index) + 1, true
}

// lineEnd returns how much of window ends at a line boundary — the index just
// past its last newline — or 0 when it holds none, or none but the budget's
// worth at the very end.
func lineEnd(window []byte) int {
	tail := window
	// Only the last snapBudget bytes are considered, for the reason the
	// backward scan is bounded: a window that is one enormous line should be
	// shown whole rather than searched end to end for an edge it does not have.
	if len(tail) > snapBudget {
		tail = tail[len(tail)-snapBudget:]
	}

	index := strings.LastIndexByte(string(tail), '\n')
	if index < 0 {
		return 0
	}
	return len(window) - len(tail) + index + 1
}
