package archive

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/andybalholm/brotli"
	dsnetbzip2 "github.com/dsnet/compress/bzip2"
	"github.com/klauspost/compress/zstd"
	"github.com/pierrec/lz4/v4"
	"github.com/ulikunitz/xz"
	yeka "github.com/yeka/zip"
)

// CreateFormat is one of the formats the app can *write*.
//
// Shorter than the list it can read, and permanently so: RAR compression is
// proprietary and no maintained pure-Go library writes 7z. Both are absent
// here rather than present and failing at the end of a long job — which is the
// difference between a limitation and a bug (PLAN.md §M18 decision 14).
type CreateFormat string

const (
	CreateZip     CreateFormat = "zip"
	CreateTar     CreateFormat = "tar"
	CreateTarGz   CreateFormat = "tar.gz"
	CreateTarBz2  CreateFormat = "tar.bz2"
	CreateTarXz   CreateFormat = "tar.xz"
	CreateTarZstd CreateFormat = "tar.zst"
	CreateTarLz4  CreateFormat = "tar.lz4"
	CreateTarBr   CreateFormat = "tar.br"
)

// CreateFormats is every writable format, in the order the dialog lists them.
// Exported for the drift test that reads the frontend's own list.
func CreateFormats() []string {
	return []string{
		string(CreateZip), string(CreateTarGz), string(CreateTarZstd), string(CreateTarXz),
		string(CreateTarBz2), string(CreateTarLz4), string(CreateTarBr), string(CreateTar),
	}
}

// Encryptable reports whether a password means anything for a format.
//
// Only zip, and that is the whole story: WinZip AES-256 is the one
// interoperable answer in this set. A password on a tar.gz would mean inventing
// an envelope, and a file nobody else can open is worse than no encryption
// (§M18 decision 16).
func Encryptable(format string) bool { return CreateFormat(format) == CreateZip }

// CreateRequest is one compression job.
type CreateRequest struct {
	Sources     []string `json:"sources"`
	Destination string   `json:"destination"`
	Format      string   `json:"format"`
	Level       int      `json:"level"`
	// Password produces WinZip AES-256, and is refused for anything but zip.
	Password string `json:"password"`
	// SplitBytes rolls the output into `.001`, `.002`… once it passes this many
	// bytes. Zero writes one file.
	SplitBytes int64 `json:"splitBytes"`
}

/* ---------- splitting ---------- */

// splitWriter rolls its output into numbered parts.
//
// This is byte-splitting, not multi-volume zip: `archive/zip` cannot write a
// real spanned archive, and splitting the finished stream is both what 7-Zip
// does for its own format and what people mean by "split at 100MB". The honest
// consequence, which the UI states, is that a part is not independently
// openable and all of them are needed (§M18 decision 15).
type splitWriter struct {
	base    string
	limit   int64
	index   int
	written int64
	current *os.File
	parts   []string
}

func newSplitWriter(base string, limit int64) *splitWriter {
	return &splitWriter{base: base, limit: limit}
}

func (s *splitWriter) roll() error {
	if s.current != nil {
		if err := s.current.Close(); err != nil {
			return err
		}
	}
	s.index++
	name := fmt.Sprintf("%s.%03d", s.base, s.index)
	handle, err := os.Create(name)
	if err != nil {
		return err
	}
	s.current = handle
	s.parts = append(s.parts, name)
	s.written = 0
	return nil
}

func (s *splitWriter) Write(data []byte) (int, error) {
	total := 0
	for len(data) > 0 {
		if s.current == nil || s.written >= s.limit {
			if err := s.roll(); err != nil {
				return total, err
			}
		}
		room := s.limit - s.written
		chunk := data
		if int64(len(chunk)) > room {
			chunk = chunk[:room]
		}
		written, err := s.current.Write(chunk)
		s.written += int64(written)
		total += written
		if err != nil {
			return total, err
		}
		data = data[written:]
	}
	return total, nil
}

func (s *splitWriter) Close() error {
	if s.current == nil {
		return nil
	}
	return s.current.Close()
}

/* ---------- compressors ---------- */

// compressor wraps the destination in whatever writes the chosen format.
func compressor(format CreateFormat, sink io.Writer, level int) (io.WriteCloser, error) {
	switch format {
	case CreateTar:
		return nopWriteCloser{sink}, nil
	case CreateTarGz:
		return gzip.NewWriterLevel(sink, clamp(level, gzip.BestSpeed, gzip.BestCompression))
	case CreateTarBz2:
		// The standard library reads bzip2 but does not write it, which is why
		// dsnet/compress is a dependency at all.
		return dsnetbzip2.NewWriter(sink, &dsnetbzip2.WriterConfig{
			Level: clamp(level, dsnetbzip2.BestSpeed, dsnetbzip2.BestCompression),
		})
	case CreateTarXz:
		return xz.NewWriter(sink)
	case CreateTarZstd:
		return zstd.NewWriter(sink, zstd.WithEncoderLevel(zstd.EncoderLevelFromZstd(clamp(level, 1, 19))))
	case CreateTarLz4:
		return lz4.NewWriter(sink), nil
	case CreateTarBr:
		return brotli.NewWriterLevel(sink, clamp(level, brotli.BestSpeed, brotli.BestCompression)), nil
	}
	return nil, fmt.Errorf("no compressor for %q", format)
}

type nopWriteCloser struct{ io.Writer }

func (nopWriteCloser) Close() error { return nil }

func clamp(value, low, high int) int {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

/* ---------- the job ---------- */

type creation struct {
	ctx     context.Context
	request CreateRequest
	report  func(entry string, done, total int64)
	written int64
	entries int
	total   int64
}

// sourceEntry is one file or folder to put in the archive, with the name it
// takes inside it.
type sourceEntry struct {
	path string
	name string
	info os.FileInfo
}

// walkSources flattens the selection into entries, and totals the bytes so the
// progress bar has a denominator.
func walkSources(sources []string) ([]sourceEntry, int64, error) {
	var entries []sourceEntry
	var total int64

	for _, source := range sources {
		cleaned := filepath.Clean(source)
		info, err := os.Lstat(cleaned)
		if err != nil {
			return nil, 0, err
		}
		root := filepath.Dir(cleaned)

		if !info.IsDir() {
			entries = append(entries, sourceEntry{cleaned, filepath.Base(cleaned), info})
			total += info.Size()
			continue
		}

		err = filepath.Walk(cleaned, func(path string, walked os.FileInfo, err error) error {
			if err != nil {
				// One unreadable file must not fail the whole archive, the same
				// rule that keeps a dangling symlink from making a directory
				// unlistable (§M1).
				return nil
			}
			name, relErr := filepath.Rel(root, path)
			if relErr != nil {
				return nil
			}
			entries = append(entries, sourceEntry{path, filepath.ToSlash(name), walked})
			if !walked.IsDir() {
				total += walked.Size()
			}
			return nil
		})
		if err != nil {
			return nil, 0, err
		}
	}
	return entries, total, nil
}

func (c *creation) copyInto(sink io.Writer, path string) error {
	handle, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = handle.Close() }()

	buffer := make([]byte, 128*1024)
	for {
		if err := c.ctx.Err(); err != nil {
			return err
		}
		read, readErr := handle.Read(buffer)
		if read > 0 {
			if _, err := sink.Write(buffer[:read]); err != nil {
				return err
			}
			c.written += int64(read)
			c.report(filepath.Base(path), c.written, c.total)
		}
		if readErr != nil {
			if readErr == io.EOF {
				return nil
			}
			return readErr
		}
	}
}

func (c *creation) toZip(sink io.Writer, entries []sourceEntry) error {
	writer := yeka.NewWriter(sink)
	defer func() { _ = writer.Close() }()

	for _, entry := range entries {
		if err := c.ctx.Err(); err != nil {
			return err
		}
		c.entries++

		if entry.info.IsDir() {
			if _, err := writer.Create(entry.name + "/"); err != nil {
				return err
			}
			continue
		}
		if entry.info.Mode()&os.ModeSymlink != 0 {
			continue
		}

		var body io.Writer
		var err error
		if c.request.Password != "" {
			// AES-256 rather than the legacy cipher, which is broken well enough
			// to be decorative — offering it beside this one would invite
			// picking it for compatibility (§M18 decision 16).
			body, err = writer.Encrypt(entry.name, c.request.Password, yeka.AES256Encryption)
		} else {
			header, headerErr := yeka.FileInfoHeader(entry.info)
			if headerErr != nil {
				return headerErr
			}
			header.Name = entry.name
			header.Method = yeka.Deflate
			body, err = writer.CreateHeader(header)
		}
		if err != nil {
			return err
		}
		if err := c.copyInto(body, entry.path); err != nil {
			return err
		}
	}
	return writer.Close()
}

func (c *creation) toTar(sink io.Writer, entries []sourceEntry) error {
	writer := tar.NewWriter(sink)
	defer func() { _ = writer.Close() }()

	for _, entry := range entries {
		if err := c.ctx.Err(); err != nil {
			return err
		}
		c.entries++

		link := ""
		if entry.info.Mode()&os.ModeSymlink != 0 {
			target, err := os.Readlink(entry.path)
			if err != nil {
				continue
			}
			link = target
		}

		header, err := tar.FileInfoHeader(entry.info, link)
		if err != nil {
			return err
		}
		header.Name = entry.name
		if entry.info.IsDir() {
			header.Name += "/"
		}
		if err := writer.WriteHeader(header); err != nil {
			return err
		}
		if entry.info.Mode().IsRegular() {
			if err := c.copyInto(writer, entry.path); err != nil {
				return err
			}
		}
	}
	return writer.Close()
}

// Create starts a compression job and returns its id immediately.
func (a *Archive) Create(request CreateRequest) (string, error) {
	format := CreateFormat(request.Format)
	if !isCreatable(format) {
		return "", archiveError(request.Destination,
			"this app cannot create "+request.Format+" archives")
	}
	if len(request.Sources) == 0 {
		return "", archiveError(request.Destination, "there is nothing to compress")
	}
	if request.Password != "" && !Encryptable(request.Format) {
		return "", archiveError(request.Destination,
			"only zip archives can be given a password")
	}

	id, ctx := a.begin()
	go a.runCreate(ctx, id, request, format)
	return id, nil
}

func isCreatable(format CreateFormat) bool {
	for _, candidate := range CreateFormats() {
		if candidate == string(format) {
			return true
		}
	}
	return false
}

func (a *Archive) runCreate(
	ctx context.Context,
	id string,
	request CreateRequest,
	format CreateFormat,
) {
	defer a.finish(id)

	entries, total, err := walkSources(request.Sources)
	if err != nil {
		a.emitDone(Done{ID: id, Error: wrapError(request.Destination, err).Error()})
		return
	}

	job := &creation{
		ctx: ctx, request: request, total: total,
		report: func(entry string, done, total int64) {
			a.emitProgress(Progress{ID: id, Entry: entry, Done: done, Total: total})
		},
	}

	written, err := writeArchive(job, request, format, entries)
	done := Done{ID: id, Path: request.Destination, Entries: job.entries, Bytes: job.written}

	switch {
	case err == nil:
		if len(written) > 0 {
			// The first part is what the user opens; any others sit beside it.
			// Reported whenever splitting was on, not only when it produced more
			// than one part: a small archive split at 100MB yields a single
			// `.001`, and the un-suffixed base name never exists at all.
			done.Path = written[0]
		}
	case ctx.Err() != nil:
		done.Cancelled = true
	default:
		done.Error = archiveError(request.Destination, err.Error()).Error()
	}

	if done.Error != "" || done.Cancelled {
		// A half-written archive is not a smaller archive; it is a file that
		// looks like one and cannot be opened — so the parts go.
		//
		// *Only* the parts. Removing the destination unconditionally deleted a
		// file that was already there whenever the O_EXCL guard refused to
		// overwrite it: the guard saved the file and the cleanup then took it.
		// `written` holds what this job actually created, and is empty on
		// exactly that path.
		for _, part := range written {
			_ = os.Remove(part)
		}
	}
	a.emitDone(done)
}

// writeArchive puts the bytes on disk and reports which files it made.
func writeArchive(
	job *creation,
	request CreateRequest,
	format CreateFormat,
	entries []sourceEntry,
) ([]string, error) {
	var sink io.Writer
	var closeSink func() error
	var parts []string
	// Held rather than deferred: a `defer` assigning to a local cannot change an
	// unnamed return value, so the split path reported the base name — a file
	// that never exists — as where the archive landed.
	var splitter *splitWriter

	if request.SplitBytes > 0 {
		splitter = newSplitWriter(request.Destination, request.SplitBytes)
		sink = splitter
		closeSink = splitter.Close
	} else {
		handle, err := os.OpenFile(request.Destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err != nil {
			return nil, err
		}
		sink = handle
		closeSink = handle.Close
		parts = []string{request.Destination}
	}

	writeErr := func() error {
		if format == CreateZip {
			// A zip carries its own compression per entry, so it is written
			// straight to the sink rather than through a stream compressor.
			return job.toZip(sink, entries)
		}
		compress, err := compressor(format, sink, request.Level)
		if err != nil {
			return err
		}
		if err := job.toTar(compress, entries); err != nil {
			_ = compress.Close()
			return err
		}
		return compress.Close()
	}()

	closeErr := closeSink()
	if splitter != nil {
		parts = splitter.parts
	}
	if writeErr != nil {
		return parts, writeErr
	}
	return parts, closeErr
}

// SplitParts lists the parts of a split archive, in order, given its first one.
//
// Reassembly is the other half of decision 15: handing the app a `.001` has to
// be enough, because a part on its own is not an archive.
func SplitParts(first string) []string {
	if !strings.HasSuffix(first, ".001") {
		return nil
	}
	base := strings.TrimSuffix(first, ".001")

	var parts []string
	for index := 1; ; index++ {
		name := fmt.Sprintf("%s.%03d", base, index)
		if _, err := os.Stat(name); err != nil {
			break
		}
		parts = append(parts, name)
	}
	return parts
}
