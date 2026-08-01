package thumbs

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

/** Writes a test image of the given size in the given format. */
func writeImage(t *testing.T, dir, name string, width, height int, transparent bool) string {
	t.Helper()
	path := filepath.Join(dir, name)

	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			alpha := uint8(255)
			if transparent && x < width/2 {
				alpha = 0
			}
			// A gradient rather than a flat fill: a solid colour compresses to
			// almost nothing and would hide a scaling bug.
			img.Set(x, y, color.NRGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: alpha})
		}
	}

	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = file.Close() }()

	switch filepath.Ext(name) {
	case ".png":
		err = png.Encode(file, img)
	case ".gif":
		err = gif.Encode(file, img, nil)
	default:
		err = jpeg.Encode(file, img, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	return path
}

/** Unwraps a `data:` URL into the bytes it carries. */
func fromDataURL(t *testing.T, url string) []byte {
	t.Helper()
	comma := strings.IndexByte(url, ',')
	if !strings.HasPrefix(url, "data:") || comma < 0 {
		t.Fatalf("not a data URL: %.40q", url)
	}
	data, err := base64.StdEncoding.DecodeString(url[comma+1:])
	if err != nil {
		t.Fatalf("data URL payload is not base64: %v", err)
	}
	return data
}

func decode(t *testing.T, url string) image.Image {
	t.Helper()
	img, _, err := image.Decode(bytes.NewReader(fromDataURL(t, url)))
	if err != nil {
		t.Fatalf("the thumbnail is not a decodable image: %v", err)
	}
	return img
}

/** The image format inside a data URL. */
func formatOf(t *testing.T, url string) string {
	t.Helper()
	_, format, err := image.Decode(bytes.NewReader(fromDataURL(t, url)))
	if err != nil {
		t.Fatalf("undecodable thumbnail: %v", err)
	}
	return format
}

func TestScalesDownPreservingAspectRatio(t *testing.T) {
	dir := t.TempDir()
	source := writeImage(t, dir, "wide.png", 640, 320, false)

	data, err := New().Generate(source, 128)
	if err != nil {
		t.Fatal(err)
	}

	bounds := decode(t, data).Bounds()
	if bounds.Dx() != 128 {
		t.Errorf("width = %d, want 128", bounds.Dx())
	}
	if bounds.Dy() != 64 {
		t.Errorf("height = %d, want 64 (aspect ratio preserved)", bounds.Dy())
	}
}

func TestScalesByTheLongerSide(t *testing.T) {
	dir := t.TempDir()
	source := writeImage(t, dir, "tall.png", 200, 1000, false)

	data, err := New().Generate(source, 100)
	if err != nil {
		t.Fatal(err)
	}

	bounds := decode(t, data).Bounds()
	if bounds.Dy() != 100 || bounds.Dx() != 20 {
		t.Errorf("bounds = %dx%d, want 20x100", bounds.Dx(), bounds.Dy())
	}
}

// Enlarging a small icon produces a blurry square that is worse than the icon
// the UI would otherwise draw.
func TestDoesNotScaleUp(t *testing.T) {
	dir := t.TempDir()
	source := writeImage(t, dir, "tiny.png", 32, 32, false)

	data, err := New().Generate(source, 256)
	if err != nil {
		t.Fatal(err)
	}

	if bounds := decode(t, data).Bounds(); bounds.Dx() != 32 || bounds.Dy() != 32 {
		t.Errorf("bounds = %dx%d, want the original 32x32", bounds.Dx(), bounds.Dy())
	}
}

// A JPEG would fill the transparent half with black.
func TestKeepsTransparencyAsPng(t *testing.T) {
	dir := t.TempDir()
	source := writeImage(t, dir, "alpha.png", 200, 200, true)

	data, err := New().Generate(source, 64)
	if err != nil {
		t.Fatal(err)
	}

	if format := formatOf(t, data); format != "png" {
		t.Errorf("format = %q, want png for a transparent source", format)
	}
	if !strings.HasPrefix(data, "data:image/png;base64,") {
		t.Errorf("data URL prefix = %.30q", data)
	}
}

func TestUsesJpegForOpaqueImages(t *testing.T) {
	dir := t.TempDir()
	source := writeImage(t, dir, "photo.jpg", 400, 300, false)

	data, err := New().Generate(source, 128)
	if err != nil {
		t.Fatal(err)
	}

	if format := formatOf(t, data); format != "jpeg" {
		t.Errorf("format = %q, want jpeg for an opaque source", format)
	}
	if !strings.HasPrefix(data, "data:image/jpeg;base64,") {
		t.Errorf("data URL prefix = %.30q", data)
	}
}

// The format comes from the file's header, not its extension — a PNG named
// .jpg still renders.
func TestDetectsFormatFromContent(t *testing.T) {
	dir := t.TempDir()

	png := writeImage(t, dir, "real.png", 200, 200, false)
	contents, err := os.ReadFile(png)
	if err != nil {
		t.Fatal(err)
	}
	misnamed := filepath.Join(dir, "misnamed.jpg")
	if err := os.WriteFile(misnamed, contents, 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := New().Generate(misnamed, 64); err != nil {
		t.Errorf("a PNG named .jpg should still render: %v", err)
	}
}

func TestRendersGif(t *testing.T) {
	dir := t.TempDir()
	source := writeImage(t, dir, "animation.gif", 200, 200, false)

	if _, err := New().Generate(source, 64); err != nil {
		t.Errorf("gif should render: %v", err)
	}
}

// Most files are not images and the frontend asks before it knows, so this is
// an ordinary outcome with a plain message rather than a scary failure.
func TestRefusesNonImages(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "notes.txt")
	if err := os.WriteFile(path, []byte("not an image"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := New().Generate(path, 64)
	if err == nil {
		t.Fatal("a text file produced a thumbnail")
	}
	if !bytes.Contains([]byte(err.Error()), []byte("not a supported image")) {
		t.Errorf("message = %q", err.Error())
	}
}

func TestRefusesFoldersAndMissingPaths(t *testing.T) {
	dir := t.TempDir()
	if _, err := New().Generate(dir, 64); err == nil {
		t.Error("a folder produced a thumbnail")
	}
	if _, err := New().Generate(filepath.Join(dir, "ghost.png"), 64); err == nil {
		t.Error("a missing file produced a thumbnail")
	}
}

func TestClampsRequestedSize(t *testing.T) {
	dir := t.TempDir()
	source := writeImage(t, dir, "big.png", 900, 900, false)

	data, err := New().Generate(source, 10_000)
	if err != nil {
		t.Fatal(err)
	}
	if bounds := decode(t, data).Bounds(); bounds.Dx() > maxSize {
		t.Errorf("width = %d, want it clamped to %d", bounds.Dx(), maxSize)
	}
}

// Scrolling a folder of photographs asks for hundreds at once; the semaphore is
// what keeps that from saturating every core.
func TestConcurrentRequestsAreSafe(t *testing.T) {
	dir := t.TempDir()
	source := writeImage(t, dir, "shared.png", 300, 300, false)
	renderer := New()

	var group sync.WaitGroup
	errs := make([]error, 16)
	for index := range errs {
		group.Add(1)
		go func(slot int) {
			defer group.Done()
			_, errs[slot] = renderer.Generate(source, 96)
		}(index)
	}
	group.Wait()

	for slot, err := range errs {
		if err != nil {
			t.Fatalf("request %d failed: %v", slot, err)
		}
	}
}

func TestDecodable(t *testing.T) {
	for _, extension := range []string{"jpg", "JPEG", ".png", "gif"} {
		if !Decodable(extension) {
			t.Errorf("Decodable(%q) = false", extension)
		}
	}
	for _, extension := range []string{"txt", "pdf", "heic", "webp", ""} {
		if Decodable(extension) {
			t.Errorf("Decodable(%q) = true", extension)
		}
	}
}
