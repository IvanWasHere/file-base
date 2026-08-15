package archive

import (
	"bufio"
	"compress/bzip2"
	"compress/gzip"
	"compress/lzw"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/andybalholm/brotli"
	"github.com/klauspost/compress/s2"
	"github.com/klauspost/compress/zstd"
	"github.com/pierrec/lz4/v4"
	"github.com/ulikunitz/xz"
	"github.com/ulikunitz/xz/lzma"

	"file-base/backend/filesystem"
)

// nopCloser adapts the readers that have nothing to release.
type nopCloser struct{ io.Reader }

func (nopCloser) Close() error { return nil }

// decompressor wraps a compressed stream in whatever reads it.
//
// Every single-stream format the app extracts passes through here, so the
// extractor never learns more than "give me the bytes inside". The tar reader,
// and the one-file writer, both sit on top of this.
func decompressor(format Format, source io.Reader) (io.ReadCloser, error) {
	switch format {
	case FormatGzip:
		return gzip.NewReader(source)
	case FormatBzip2:
		// The standard library reads bzip2 but cannot write it; dsnet/compress
		// supplies the writer in create.go. Reading stays on the stdlib, which
		// is faster and has no dependency.
		return nopCloser{bzip2.NewReader(source)}, nil
	case FormatXz:
		reader, err := xz.NewReader(source)
		if err != nil {
			return nil, err
		}
		return nopCloser{reader}, nil
	case FormatLzma:
		reader, err := lzma.NewReader(source)
		if err != nil {
			return nil, err
		}
		return nopCloser{reader}, nil
	case FormatLz4:
		return nopCloser{lz4.NewReader(source)}, nil
	case FormatZstd:
		reader, err := zstd.NewReader(source)
		if err != nil {
			return nil, err
		}
		return readCloserFunc{reader.IOReadCloser()}, nil
	case FormatBrotli:
		return nopCloser{brotli.NewReader(source)}, nil
	case FormatSnappy:
		return nopCloser{s2.NewReader(source)}, nil
	case FormatCompress:
		// Unix `compress`: LZW, MSB-first, with a two-byte header this skips.
		buffered := bufio.NewReader(source)
		if _, err := buffered.Discard(3); err != nil {
			return nil, err
		}
		return lzw.NewReader(buffered, lzw.MSB, 8), nil
	}
	return nil, fmt.Errorf("no decompressor for %q", format)
}

type readCloserFunc struct{ io.ReadCloser }

// countingReader reports how far through the source it has read.
//
// Progress is measured against the *archive* rather than against the extracted
// total, because the extracted total is unknowable for a stream until it ends —
// and this way one mechanism serves every format identically.
type countingReader struct {
	source io.Reader
	read   int64
	report func(int64)
	cancel func() error
}

func (c *countingReader) Read(buffer []byte) (int, error) {
	if c.cancel != nil {
		if err := c.cancel(); err != nil {
			return 0, err
		}
	}
	n, err := c.source.Read(buffer)
	c.read += int64(n)
	if c.report != nil {
		c.report(c.read)
	}
	return n, err
}

// Mirrors the encoding in backend/filesystem/errors.go so the frontend bridge
// parses archive failures through the same path.
func archiveError(path, message string) error {
	encoded, err := json.Marshal(map[string]string{
		"code": "unknown", "path": path, "message": message,
	})
	if err != nil {
		return errors.New(message)
	}
	return errors.New("fs-error:" + string(encoded))
}

// passwordError is the one failure the UI must react to rather than report: it
// prompts and tries again.
func passwordError(path string, wrong bool) error {
	message := "This archive is protected. Enter its password."
	if wrong {
		message = "That password did not work."
	}
	encoded, err := json.Marshal(map[string]string{
		"code": "password-required", "path": path, "message": message,
	})
	if err != nil {
		return errors.New(message)
	}
	return errors.New("fs-error:" + string(encoded))
}

// wrapError classifies an OS error and encodes it for the bridge, reusing the
// filesystem package's mapping so a permission denial reads the same however it
// was reached.
func wrapError(path string, err error) error {
	return filesystem.Wrap(path, err)
}
