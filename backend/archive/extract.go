package archive

import (
	"archive/tar"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/bodgit/sevenzip"
	"github.com/nwaples/rardecode/v2"
	yeka "github.com/yeka/zip"
)

// errUnsafeEntry aborts the whole extraction rather than skipping one entry.
//
// A "zip slip" archive — one carrying an entry named `../../../.ssh/authorized_keys`
// — is not a mostly-good archive with one odd member; it is a file built to
// write outside the folder it was pointed at. Extracting the rest of it and
// carrying on would leave the user with a half-unpacked directory and no reason
// to look closer.
var errUnsafeEntry = errors.New("this archive contains an entry that would write outside the destination")

// errCapped stops a browse mount that is expanding without end. A megabyte
// expanding to terabytes is a real archive shape, and browsing is something the
// user does by double-clicking rather than by deciding (PLAN.md §M18 dec. 12).
var errCapped = errors.New("this archive is larger than a preview will open — use Uncompress instead")

// ExtractRequest is one extraction job.
type ExtractRequest struct {
	Path        string `json:"path"`
	Destination string `json:"destination"`
	Password    string `json:"password"`
	// MaxBytes and MaxEntries bound a browse mount. Zero means unbounded, which
	// is what Uncompress passes: that is the user's explicit decision.
	MaxBytes   int64 `json:"maxBytes"`
	MaxEntries int   `json:"maxEntries"`
	// ReadOnly strips the write bits once everything is in place, so a browse
	// mount cannot be edited and then silently reclaimed (decision 6).
	ReadOnly bool `json:"readOnly"`
	// CollapseRoot moves a lone top-level entry up and removes the folder that
	// held it, so `report.pdf.zip` does not produce `report/report.pdf`.
	CollapseRoot bool `json:"collapseRoot"`
}

// extraction carries the state one job needs through the format-specific paths.
type extraction struct {
	ctx      context.Context
	request  ExtractRequest
	report   func(entry string, done, total int64)
	written  int64
	entries  int
	maxBytes int64
	maxItems int
}

func (e *extraction) check() error {
	if err := e.ctx.Err(); err != nil {
		return err
	}
	if e.maxBytes > 0 && e.written > e.maxBytes {
		return errCapped
	}
	if e.maxItems > 0 && e.entries > e.maxItems {
		return errCapped
	}
	return nil
}

// safeJoin resolves an entry name inside the destination, or refuses.
//
// `filepath.Clean("/" + name)` neutralises `..` by anchoring the walk at a
// notional root; the `Rel` check afterwards is the belt to that braces, because
// a name that survives cleaning and still escapes is exactly the case worth
// catching. Absolute names are refused outright.
func safeJoin(root, name string) (string, error) {
	if name == "" {
		return "", errUnsafeEntry
	}
	slashed := filepath.ToSlash(name)
	if strings.HasPrefix(slashed, "/") || filepath.IsAbs(name) {
		return "", errUnsafeEntry
	}
	if strings.Contains(slashed, "\x00") {
		return "", errUnsafeEntry
	}

	// Refused, not sanitised. Anchoring at "/" and cleaning would turn
	// `../escape` into `root/escape` — inside the destination, and therefore
	// "safe" — but it would also silently rewrite an entry that had no business
	// being written at all. An archive carrying `..` is suspicious, and quietly
	// repairing it hides exactly the thing worth seeing.
	for _, element := range strings.Split(slashed, "/") {
		if element == ".." {
			return "", errUnsafeEntry
		}
	}

	target := filepath.Join(root, filepath.FromSlash(filepath.Clean("/"+slashed)))

	relative, err := filepath.Rel(root, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", errUnsafeEntry
	}
	return target, nil
}

func (e *extraction) writeFile(target string, mode os.FileMode, source io.Reader) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	if mode == 0 {
		mode = 0o644
	}

	handle, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode.Perm())
	if err != nil {
		return err
	}
	defer func() { _ = handle.Close() }()

	buffer := make([]byte, 128*1024)
	for {
		if err := e.check(); err != nil {
			return err
		}
		read, readErr := source.Read(buffer)
		if read > 0 {
			if _, err := handle.Write(buffer[:read]); err != nil {
				return err
			}
			e.written += int64(read)
			e.report(filepath.Base(target), e.written, 0)
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return nil
			}
			return readErr
		}
	}
}

// entryLink creates a symlink only when it stays inside the destination.
func (e *extraction) entryLink(target, linkTarget string) error {
	resolved := linkTarget
	if !filepath.IsAbs(resolved) {
		resolved = filepath.Join(filepath.Dir(target), linkTarget)
	}
	if _, err := safeJoin(e.request.Destination, mustRel(e.request.Destination, resolved)); err != nil {
		return errUnsafeEntry
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	return os.Symlink(linkTarget, target)
}

func mustRel(base, target string) string {
	relative, err := filepath.Rel(base, target)
	if err != nil {
		return ".."
	}
	return relative
}

/* ---------- per-format extraction ---------- */

func (e *extraction) fromZip() error {
	reader, err := yeka.OpenReader(e.request.Path)
	if err != nil {
		return err
	}
	defer func() { _ = reader.Close() }()

	var total int64
	for _, file := range reader.File {
		total += int64(file.UncompressedSize64)
	}

	for _, file := range reader.File {
		if err := e.check(); err != nil {
			return err
		}
		e.entries++

		target, err := safeJoin(e.request.Destination, file.Name)
		if err != nil {
			return err
		}

		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}

		if file.IsEncrypted() {
			if e.request.Password == "" {
				return passwordError(e.request.Path, false)
			}
			file.SetPassword(e.request.Password)
		}

		body, err := file.Open()
		if err != nil {
			// A wrong password surfaces here rather than at open time, because
			// a zip's entries are encrypted individually.
			if file.IsEncrypted() {
				return passwordError(e.request.Path, true)
			}
			return err
		}

		writeErr := e.writeFile(target, file.Mode(), body)
		_ = body.Close()
		if writeErr != nil {
			// The AES check digest fails as a read error, which is what a wrong
			// password looks like from here.
			if file.IsEncrypted() && !errors.Is(writeErr, context.Canceled) &&
				!errors.Is(writeErr, errCapped) && !errors.Is(writeErr, errUnsafeEntry) {
				return passwordError(e.request.Path, true)
			}
			return writeErr
		}
		e.report(file.Name, e.written, total)
	}
	return nil
}

func (e *extraction) from7z() error {
	reader, err := sevenzip.OpenReaderWithPassword(e.request.Path, e.request.Password)
	if err != nil {
		if e.request.Password == "" {
			return passwordError(e.request.Path, false)
		}
		return passwordError(e.request.Path, true)
	}
	defer func() { _ = reader.Close() }()

	var total int64
	for _, file := range reader.File {
		total += int64(file.UncompressedSize)
	}

	for _, file := range reader.File {
		if err := e.check(); err != nil {
			return err
		}
		e.entries++

		target, err := safeJoin(e.request.Destination, file.Name)
		if err != nil {
			return err
		}
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}

		body, err := file.Open()
		if err != nil {
			return e.sevenZipFailure(err)
		}
		writeErr := e.writeFile(target, file.Mode(), body)
		_ = body.Close()
		if writeErr != nil {
			return e.sevenZipFailure(writeErr)
		}
		e.report(file.Name, e.written, total)
	}
	return nil
}

func (e *extraction) fromRar() error {
	var options []rardecode.Option
	if e.request.Password != "" {
		options = append(options, rardecode.Password(e.request.Password))
	}

	reader, err := rardecode.OpenReader(e.request.Path, options...)
	if err != nil {
		return err
	}
	defer func() { _ = reader.Close() }()

	for {
		if err := e.check(); err != nil {
			return err
		}
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		e.entries++

		target, err := safeJoin(e.request.Destination, header.Name)
		if err != nil {
			return err
		}
		if header.IsDir {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := e.writeFile(target, header.Mode(), reader); err != nil {
			return err
		}
		e.report(header.Name, e.written, 0)
	}
}

func (e *extraction) fromTar(source io.Reader) error {
	reader := tar.NewReader(source)
	for {
		if err := e.check(); err != nil {
			return err
		}
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		e.entries++

		target, err := safeJoin(e.request.Destination, header.Name)
		if err != nil {
			return err
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeSymlink:
			if err := e.entryLink(target, header.Linkname); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := e.writeFile(target, os.FileMode(header.Mode), reader); err != nil {
				return err
			}
			e.report(header.Name, e.written, 0)
		default:
			// Devices, fifos and hard links are not things a file explorer
			// should be recreating on the user's disk.
		}
	}
}

// fromStream handles a single-stream compressor holding one file.
func (e *extraction) fromStream(kind Kind) error {
	handle, err := os.Open(e.request.Path)
	if err != nil {
		return err
	}
	defer func() { _ = handle.Close() }()

	reader, err := decompressor(kind.Format, handle)
	if err != nil {
		return err
	}
	defer func() { _ = reader.Close() }()

	if kind.TarInside {
		return e.fromTar(reader)
	}

	name := StripArchiveExtension(filepath.Base(e.request.Path))
	target, err := safeJoin(e.request.Destination, name)
	if err != nil {
		return err
	}
	e.entries++
	return e.writeFile(target, 0o644, reader)
}

/* ---------- after the entries are on disk ---------- */

// collapseSingleRoot moves a lone top-level entry up and removes the folder.
//
// `report.pdf.zip` producing `report/report.pdf` is the pointless wrapper; a
// two-hundred-entry archive emptying itself into Downloads is the tarbomb.
// Deciding after extraction rather than before means no pre-pass over formats
// that would have to be decompressed twice to answer the question.
func collapseSingleRoot(destination string) (string, error) {
	entries, err := os.ReadDir(destination)
	if err != nil || len(entries) != 1 {
		return destination, err
	}

	only := entries[0]
	parent := filepath.Dir(destination)
	target := uniquePath(filepath.Join(parent, only.Name()))

	if err := os.Rename(filepath.Join(destination, only.Name()), target); err != nil {
		// Leaving the folder in place is a worse layout, never a lost file.
		return destination, nil
	}
	_ = os.Remove(destination)
	return target, nil
}

// uniquePath appends a counter until nothing is in the way. Extraction must
// never overwrite something already on disk.
func uniquePath(path string) string {
	if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
		return path
	}
	extension := filepath.Ext(path)
	stem := strings.TrimSuffix(path, extension)
	for counter := 2; counter < 1000; counter++ {
		candidate := stem + " " + itoa(counter) + extension
		if _, err := os.Lstat(candidate); errors.Is(err, os.ErrNotExist) {
			return candidate
		}
	}
	return path
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

// makeReadOnly strips the write bits from everything under root.
//
// Directories keep their execute bit or nothing below them can be listed. This
// is what makes decision 6 true rather than merely intended: the OS refuses the
// edit, so there is no unsaved work to lose when the mount is reclaimed.
func makeReadOnly(root string) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return os.Chmod(path, 0o555)
		}
		return os.Chmod(path, 0o444)
	})
}

// makeWritable undoes it, so the mount can be removed.
func makeWritable(root string) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return os.Chmod(path, 0o755)
		}
		return os.Chmod(path, 0o644)
	})
}

// fromPlainTar opens an uncompressed tar from disk.
func (e *extraction) fromPlainTar() error {
	handle, err := os.Open(e.request.Path)
	if err != nil {
		return err
	}
	defer func() { _ = handle.Close() }()
	return e.fromTar(handle)
}

// sevenZipFailure separates "this needs a password" from a genuine read error.
//
// A 7z does not fail at open time the way an encrypted zip entry does: the
// archive opens, and the *decoder* fails part-way through with an lzma2 error
// that says nothing a user could act on. `sevenzip.ReadError` carries an
// `Encrypted` hint for exactly this, so the guess is the library's rather than
// ours — and a corrupt archive still reports as corrupt.
func (e *extraction) sevenZipFailure(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, errCapped) ||
		errors.Is(err, errUnsafeEntry) {
		return err
	}

	// A *pointer* to ReadError, which is what the library returns — matching the
	// value type compiles, never matches, and quietly reports every wrong
	// password as an lzma2 decoder failure.
	var readErr *sevenzip.ReadError
	if errors.As(err, &readErr) && readErr.Encrypted {
		return passwordError(e.request.Path, e.request.Password != "")
	}
	return err
}
