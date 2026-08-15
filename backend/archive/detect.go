package archive

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Format is one archive or compression format.
//
// A `Format` says how to *read* the bytes; whether those bytes then contain a
// tar is a separate question, because `photos.tar.gz` and `notes.txt.gz` are
// the same gzip stream with different things inside it.
type Format string

const (
	FormatUnknown  Format = ""
	FormatZip      Format = "zip"
	Format7z       Format = "7z"
	FormatRar      Format = "rar"
	FormatTar      Format = "tar"
	FormatGzip     Format = "gz"
	FormatBzip2    Format = "bz2"
	FormatXz       Format = "xz"
	FormatLzma     Format = "lzma"
	FormatLz4      Format = "lz4"
	FormatZstd     Format = "zst"
	FormatBrotli   Format = "br"
	FormatSnappy   Format = "sz"
	FormatCompress Format = "Z"
)

// Container reports whether a format holds many entries in its own right.
//
// The single-stream compressors hold exactly one thing, which is usually — but
// not always — a tar.
func (f Format) Container() bool {
	switch f {
	case FormatZip, Format7z, FormatRar, FormatTar:
		return true
	}
	return false
}

// Kind is what detection concluded about a file.
type Kind struct {
	Format Format
	// TarInside is set when a single-stream compressor wraps a tar, which is
	// what makes `photos.tar.gz` a folder of files rather than one blob.
	TarInside bool
}

// Archive reports whether this is something the app can open at all.
func (k Kind) Archive() bool { return k.Format != FormatUnknown }

// sniffBytes is enough for every magic number below plus a tar header, which
// lives at offset 257.
const sniffBytes = 512

// magic maps a signature to its format. Ordered longest-first at match time, so
// a shorter prefix cannot claim a file a longer one describes better.
var magic = []struct {
	prefix []byte
	format Format
}{
	{[]byte{0xFD, '7', 'z', 'X', 'Z', 0x00}, FormatXz},
	{[]byte{'R', 'a', 'r', '!', 0x1A, 0x07, 0x01, 0x00}, FormatRar}, // RAR5
	{[]byte{'R', 'a', 'r', '!', 0x1A, 0x07, 0x00}, FormatRar},       // RAR4
	{[]byte{0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C}, Format7z},
	{[]byte{0xFF, 0x06, 0x00, 0x00, 's', 'N', 'a', 'P', 'p', 'Y'}, FormatSnappy},
	{[]byte{0x28, 0xB5, 0x2F, 0xFD}, FormatZstd},
	{[]byte{0x04, 0x22, 0x4D, 0x18}, FormatLz4},
	{[]byte{'P', 'K', 0x03, 0x04}, FormatZip},
	{[]byte{'P', 'K', 0x05, 0x06}, FormatZip}, // empty archive
	{[]byte{'P', 'K', 0x07, 0x08}, FormatZip}, // spanned
	{[]byte{'B', 'Z', 'h'}, FormatBzip2},
	{[]byte{0x1F, 0x8B}, FormatGzip},
	{[]byte{0x1F, 0x9D}, FormatCompress},
}

// byExtension is the fallback for the two formats that have no signature.
//
// Raw LZMA has no magic at all — its header starts with the properties byte,
// which is *usually* 0x5D but is not required to be — and Brotli has none by
// design. Guessing from a weak prefix would misread ordinary files as archives,
// which is worse than asking the name; M10's rule that an extension is a claim
// rather than a fact cuts the other way here, because a claim is all there is.
var byExtension = map[string]Format{
	".lzma": FormatLzma,
	".br":   FormatBrotli,
	".tbr":  FormatBrotli,
}

// tarMagic sits at offset 257 of a tar header block.
var tarMagic = []byte("ustar")

func looksLikeTar(header []byte) bool {
	return len(header) >= 262 && bytes.Equal(header[257:262], tarMagic)
}

// Detect identifies a file by its content, falling back to its name only where
// the format has no signature to find.
//
// Content first is not a preference: M10 shipped a bug where a text file named
// `.png` rendered as a broken image, and the same mistake here would be an
// archive named `.zip` that is really a rar refusing to open. The extension is
// a hint about which answer to expect, never the answer.
func Detect(path string) (Kind, error) {
	cleaned := filepath.Clean(path)

	handle, err := os.Open(cleaned)
	if err != nil {
		return Kind{}, wrapError(cleaned, err)
	}
	defer func() { _ = handle.Close() }()

	header := make([]byte, sniffBytes)
	read, err := io.ReadFull(handle, header)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		return Kind{}, wrapError(cleaned, err)
	}
	header = header[:read]

	kind := Kind{Format: fromMagic(header)}

	if kind.Format == FormatUnknown {
		if looksLikeTar(header) {
			kind.Format = FormatTar
		} else if format, ok := byExtension[strings.ToLower(filepath.Ext(cleaned))]; ok {
			kind.Format = format
		}
	}

	if kind.Format == FormatUnknown || kind.Format.Container() {
		return kind, nil
	}

	// A single-stream format wraps exactly one thing. Peeking at the first
	// block of it is what separates `photos.tar.gz` — a folder — from
	// `notes.txt.gz`, which is one file.
	if _, err := handle.Seek(0, io.SeekStart); err != nil {
		return kind, nil
	}
	kind.TarInside = tarWrapped(kind.Format, handle)
	return kind, nil
}

func fromMagic(header []byte) Format {
	for _, entry := range magic {
		if len(header) >= len(entry.prefix) && bytes.Equal(header[:len(entry.prefix)], entry.prefix) {
			return entry.format
		}
	}
	return FormatUnknown
}

// tarWrapped decompresses just enough to see a tar header.
//
// Errors are swallowed deliberately: a stream this cannot decompress is simply
// "not a tar as far as we know", and extraction will report the real failure
// with a real message rather than detection guessing at one.
func tarWrapped(format Format, source io.Reader) bool {
	reader, err := decompressor(format, source)
	if err != nil {
		return false
	}
	defer func() { _ = reader.Close() }()

	header := make([]byte, sniffBytes)
	read, err := io.ReadFull(reader, header)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		return false
	}
	return looksLikeTar(header[:read])
}

// StripArchiveExtension gives the name the contents of a single-stream archive
// should take: `notes.txt.gz` holds `notes.txt`.
//
// A name with nothing left to strip keeps a suffix rather than colliding with
// the archive beside it — extracting `data` from `data` in the same folder can
// only fail.
func StripArchiveExtension(name string) string {
	lower := strings.ToLower(name)
	for _, suffix := range []string{
		".tar.gz", ".tar.bz2", ".tar.xz", ".tar.lzma", ".tar.lz4", ".tar.zst",
		".tar.br", ".tar.sz", ".tar.Z",
		".tgz", ".tbz", ".tbz2", ".txz", ".tzst", ".tlz4", ".tbr",
		".gz", ".bz2", ".xz", ".lzma", ".lz4", ".zst", ".br", ".sz", ".z",
		".zip", ".7z", ".rar", ".tar",
	} {
		if strings.HasSuffix(lower, strings.ToLower(suffix)) && len(name) > len(suffix) {
			return name[:len(name)-len(suffix)]
		}
	}
	return name + ".out"
}
