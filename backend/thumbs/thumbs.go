// Package thumbs renders image thumbnails.
//
// Two constraints shape it. First, decoding is native and format-limited on
// purpose: a file explorer must not become an image-conversion pipeline, and
// shelling out to `qlmanage` for arbitrary types would trade a bounded CPU cost
// for an unbounded process-spawning one. Second, requests arrive in bursts —
// scrolling a folder of ten thousand photos asks for hundreds at once — so the
// work is bounded by a semaphore rather than by however many goroutines the
// frontend happens to ask for (PLAN.md §3, "Thumbnail CPU cost").
//
// Caching is the frontend's job. This renders; services/thumbs stores the
// result in SQLite keyed by path and mtime.
package thumbs

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	// Registering the decoders is the entire reason for these imports: the
	// format is detected from the file's own header, not its extension.
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"golang.org/x/image/draw"
)

const (
	// maxSourceBytes skips files too large to decode cheaply. A 200MP TIFF would
	// hold ~800MB decoded, and a thumbnail is not worth that.
	maxSourceBytes = 80 * 1024 * 1024

	// maxSize bounds what callers may ask for. Anything larger is a preview, not
	// a thumbnail, and belongs on the full-image path.
	maxSize = 512

	// jpegQuality is the usual photographic compromise. At thumbnail scale the
	// difference from 95 is invisible and the file is a third of the size —
	// which matters when thousands live in one SQLite database.
	jpegQuality = 82
)

// Thumbs is bound to Wails; its exported methods become the TS bindings.
type Thumbs struct {
	// slots bounds concurrent decodes. Buffered channel rather than a worker
	// pool: requests already arrive on their own goroutines from Wails, and this
	// only needs to stop them all decoding at once.
	slots chan struct{}
}

func New() *Thumbs {
	// Leaving a core or two free keeps the UI responsive while a folder of
	// photographs is being scrolled.
	workers := runtime.NumCPU() - 1
	if workers < 1 {
		workers = 1
	}
	if workers > 4 {
		workers = 4
	}
	return &Thumbs{slots: make(chan struct{}, workers)}
}

// Generate renders a thumbnail no larger than size in either dimension,
// returning a `data:` URL.
//
// A URL rather than bytes for two reasons. Wails marshals a []byte to a JSON
// array of numbers — a 10KB thumbnail crosses as ~40KB of text, which is the
// wrong trade when scrolling a folder asks for hundreds. And the caller needs
// the format anyway: PNG and JPEG are both possible, and a bare buffer would
// leave the UI guessing which it received.
//
// Aspect ratio is preserved and images smaller than the target are not scaled
// up: enlarging a 32×32 icon to 256×256 produces a blurry square that is worse
// than the icon the UI would otherwise draw.
func (t *Thumbs) Generate(path string, size int) (string, error) {
	cleaned := filepath.Clean(path)
	if size <= 0 {
		size = 128
	}
	if size > maxSize {
		size = maxSize
	}

	info, err := os.Stat(cleaned)
	if err != nil {
		return "", thumbError(cleaned, err.Error())
	}
	if info.IsDir() {
		return "", thumbError(cleaned, "a folder has no thumbnail")
	}
	if info.Size() > maxSourceBytes {
		return "", thumbError(cleaned, "the image is too large to render")
	}

	t.slots <- struct{}{}
	defer func() { <-t.slots }()

	handle, err := os.Open(cleaned)
	if err != nil {
		return "", thumbError(cleaned, err.Error())
	}
	defer func() { _ = handle.Close() }()

	source, _, err := image.Decode(handle)
	if err != nil {
		// Not an unexpected failure: most files are not images, and the frontend
		// asks before it knows. The message says so plainly.
		return "", thumbError(cleaned, "this file is not a supported image")
	}

	return encode(scale(source, size))
}

// scale fits src inside a size×size box, preserving aspect ratio.
func scale(source image.Image, size int) image.Image {
	bounds := source.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return source
	}
	// Already small enough: scaling up only blurs it.
	if width <= size && height <= size {
		return source
	}

	if width > height {
		height = height * size / width
		width = size
	} else {
		width = width * size / height
		height = size
	}
	if width < 1 {
		width = 1
	}
	if height < 1 {
		height = 1
	}

	target := image.NewRGBA(image.Rect(0, 0, width, height))
	// CatmullRom rather than a box filter: downscaling a photograph by 10× with
	// nearest-neighbour produces visible aliasing, and at thumbnail sizes the
	// extra cost is microseconds.
	draw.CatmullRom.Scale(target, target.Bounds(), source, bounds, draw.Over, nil)
	return target
}

// encode picks a format by whether the image needs an alpha channel.
//
// JPEG for photographs, which is most of what gets thumbnailed and a third of
// the size; PNG when there is transparency to keep, because a JPEG would fill
// it with black.
func encode(img image.Image) (string, error) {
	var buffer bytes.Buffer

	if isOpaque(img) {
		if err := jpeg.Encode(&buffer, img, &jpeg.Options{Quality: jpegQuality}); err != nil {
			return "", thumbError("", err.Error())
		}
		return dataURL("image/jpeg", buffer.Bytes()), nil
	}

	if err := png.Encode(&buffer, img); err != nil {
		return "", thumbError("", err.Error())
	}
	return dataURL("image/png", buffer.Bytes()), nil
}

func dataURL(mime string, data []byte) string {
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// isOpaque asks the image itself when it can answer.
//
// Every stdlib image type implements Opaque(); the fallback is for anything
// exotic a future decoder might return, where assuming transparency (PNG) is
// the safe guess.
func isOpaque(img image.Image) bool {
	if opaque, ok := img.(interface{ Opaque() bool }); ok {
		return opaque.Opaque()
	}
	return false
}

// Decodable reports whether a file extension is one this package can render.
//
// Exported so the frontend can avoid asking for thumbnails it will not get —
// one failed request per text file in a folder is a lot of pointless traffic.
func Decodable(extension string) bool {
	switch strings.ToLower(strings.TrimPrefix(extension, ".")) {
	case "jpg", "jpeg", "png", "gif":
		return true
	default:
		return false
	}
}

// Mirrors the encoding in backend/filesystem/errors.go so the frontend bridge
// parses thumbnail failures through the same path.
func thumbError(path, message string) error {
	encoded, err := json.Marshal(map[string]string{
		"code": "unknown", "path": path, "message": message,
	})
	if err != nil {
		return errors.New(message)
	}
	return errors.New("fs-error:" + string(encoded))
}
