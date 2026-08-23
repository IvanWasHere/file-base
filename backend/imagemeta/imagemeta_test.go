package imagemeta

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A property dictionary in the shape ImageIO hands back for a phone photo,
// which is what the mapping is written against.
func photoProperties() map[string]any {
	return map[string]any{
		"PixelWidth":  float64(4032),
		"PixelHeight": float64(3024),
		"DPIWidth":    float64(72),
		"DPIHeight":   float64(72),
		"ColorModel":  "RGB",
		"Depth":       float64(8),
		"ProfileName": "Display P3",
		"Orientation": float64(6),
		"{TIFF}": map[string]any{
			"Make":     "Apple",
			"Model":    "iPhone 15 Pro",
			"Software": "17.4",
			"DateTime": "2024:03:02 09:14:00",
		},
		"{Exif}": map[string]any{
			"ExposureTime":       0.004,
			"FNumber":            1.78,
			"ISOSpeedRatings":    []any{float64(64)},
			"FocalLength":        6.765,
			"FocalLenIn35mmFilm": float64(24),
			"ExposureBiasValue":  -0.5,
			"ExposureProgram":    float64(2),
			"MeteringMode":       float64(5),
			"Flash":              float64(16),
			"WhiteBalance":       float64(0),
			"ColorSpace":         float64(65535),
			"DateTimeOriginal":   "2024:03:01 18:22:07",
			"OffsetTimeOriginal": "+01:00",
			"LensModel":          "iPhone 15 Pro back triple camera 6.765mm f/1.78",
		},
		"{GPS}": map[string]any{
			"Latitude":     22.9068,
			"LatitudeRef":  "S",
			"Longitude":    43.1729,
			"LongitudeRef": "W",
			"Altitude":     12.5,
			"AltitudeRef":  float64(0),
		},
	}
}

func TestFromPropertiesReadsTheImage(t *testing.T) {
	info := fromProperties(photoProperties())

	if info.Width != 4032 || info.Height != 3024 {
		t.Fatalf("dimensions: %d × %d", info.Width, info.Height)
	}
	if info.ColorModel != "RGB" || info.BitDepth != 8 {
		t.Fatalf("colour: %s %d-bit", info.ColorModel, info.BitDepth)
	}
	if info.ProfileName != "Display P3" {
		t.Fatalf("profile: %q", info.ProfileName)
	}
	if info.Orientation != 6 {
		t.Fatalf("orientation: %d", info.Orientation)
	}
}

func TestFromPropertiesReadsTheCamera(t *testing.T) {
	info := fromProperties(photoProperties())

	if info.Make != "Apple" || info.Model != "iPhone 15 Pro" {
		t.Fatalf("camera: %q %q", info.Make, info.Model)
	}
	if !strings.HasPrefix(info.Lens, "iPhone 15 Pro back") {
		t.Fatalf("lens: %q", info.Lens)
	}
	if info.ExposureTime != 0.004 || info.FNumber != 1.78 {
		t.Fatalf("exposure: %v at f/%v", info.ExposureTime, info.FNumber)
	}
	// A list in EXIF, a number here: every reader shows the first.
	if info.ISO != 64 {
		t.Fatalf("iso: %d", info.ISO)
	}
	if info.FocalLength35 != 24 {
		t.Fatalf("focal length (35mm): %v", info.FocalLength35)
	}
	if info.ExposureBias != -0.5 {
		t.Fatalf("exposure bias: %v", info.ExposureBias)
	}
	// Codes, not words — the frontend owns the vocabulary (§M23 decision 3).
	if info.MeteringMode != 5 || info.ExposureProgram != 2 {
		t.Fatalf("codes: metering %d, program %d", info.MeteringMode, info.ExposureProgram)
	}
}

func TestFromPropertiesPrefersCaptureTimeOverFileTime(t *testing.T) {
	info := fromProperties(photoProperties())
	if info.DateTaken != "2024-03-01 18:22:07" {
		t.Fatalf("date taken: %q", info.DateTaken)
	}
	if info.DateTakenUTC != "+01:00" {
		t.Fatalf("offset: %q", info.DateTakenUTC)
	}
}

// A scan or an export has no capture time; the file's own is better than none.
func TestFromPropertiesFallsBackToTheFileTime(t *testing.T) {
	props := photoProperties()
	exif := props["{Exif}"].(map[string]any)
	delete(exif, "DateTimeOriginal")

	info := fromProperties(props)
	if info.DateTaken != "2024-03-02 09:14:00" {
		t.Fatalf("date taken: %q", info.DateTaken)
	}
}

func TestGPSIsSigned(t *testing.T) {
	info := fromProperties(photoProperties())

	if !info.HasGPS {
		t.Fatal("expected a fix")
	}
	// Rio: south and west, which every map in the world writes as negatives.
	if info.Latitude != -22.9068 {
		t.Fatalf("latitude: %v", info.Latitude)
	}
	if info.Longitude != -43.1729 {
		t.Fatalf("longitude: %v", info.Longitude)
	}
	if info.Altitude != 12.5 {
		t.Fatalf("altitude: %v", info.Altitude)
	}
}

func TestGPSBelowSeaLevel(t *testing.T) {
	props := photoProperties()
	gps := props["{GPS}"].(map[string]any)
	gps["AltitudeRef"] = float64(1)

	if info := fromProperties(props); info.Altitude != -12.5 {
		t.Fatalf("altitude: %v", info.Altitude)
	}
}

// Null Island is a real place and a very common way of saying "no fix".
func TestGPSAtZeroZeroIsNoFix(t *testing.T) {
	props := photoProperties()
	props["{GPS}"] = map[string]any{
		"Latitude": float64(0), "LatitudeRef": "N",
		"Longitude": float64(0), "LongitudeRef": "E",
	}

	if info := fromProperties(props); info.HasGPS {
		t.Fatal("expected no fix at 0,0")
	}
}

func TestGPSWithoutCoordinatesIsNoFix(t *testing.T) {
	props := photoProperties()
	// Some cameras write a GPS block holding only a datum and a status.
	props["{GPS}"] = map[string]any{"MapDatum": "WGS-84", "Status": "V"}

	if info := fromProperties(props); info.HasGPS {
		t.Fatal("expected no fix from a GPS block with no position")
	}
}

// A PNG or a screenshot has no EXIF at all, which is the common case rather
// than a failure: the image half must still be complete.
func TestFromPropertiesWithNoExif(t *testing.T) {
	info := fromProperties(map[string]any{
		"PixelWidth": float64(1440), "PixelHeight": float64(900),
		"ColorModel": "RGB", "Depth": float64(8), "HasAlpha": true,
	})

	if info.Width != 1440 || !info.HasAlpha {
		t.Fatalf("image: %#v", info)
	}
	if info.Make != "" || info.ISO != 0 || info.HasGPS {
		t.Fatalf("expected no camera data: %#v", info)
	}
}

// Values arrive as whatever the property list held: an f-number is 1.78 in one
// file and 2 in the next, and an integer must not read as zero.
func TestNumbersSurviveEitherEncoding(t *testing.T) {
	info := fromProperties(map[string]any{
		"PixelWidth": uint64(800),
		"Depth":      int64(16),
		"{Exif}":     map[string]any{"FNumber": int64(2), "ISOSpeedRatings": float64(100)},
	})

	if info.Width != 800 || info.BitDepth != 16 {
		t.Fatalf("image: %#v", info)
	}
	if info.FNumber != 2 {
		t.Fatalf("f-number: %v", info.FNumber)
	}
	// A bare number where a list was expected is still a sensitivity.
	if info.ISO != 100 {
		t.Fatalf("iso: %d", info.ISO)
	}
}

func TestExifDate(t *testing.T) {
	cases := map[string]string{
		"2019:06:18 11:32:01": "2019-06-18 11:32:01",
		// A camera with an unset clock, which is not a date worth showing.
		"0000:00:00 00:00:00": "",
		"":                    "",
		"nonsense":            "",
		"2019:06:18":          "",
	}
	for raw, want := range cases {
		if got := exifDate(raw); got != want {
			t.Fatalf("exifDate(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestFormatName(t *testing.T) {
	cases := map[string]string{
		"public.jpeg":          "JPEG",
		"public.png":           "PNG",
		"public.heic":          "HEIC",
		"com.compuserve.gif":   "GIF",
		"com.adobe.raw-image":  "RAW Image",
		"org.webmproject.webp": "WEBP",
		"":                     "",
	}
	for uti, want := range cases {
		if got := formatName(uti); got != want {
			t.Fatalf("formatName(%q) = %q, want %q", uti, got, want)
		}
	}
}

// The cgo path, end to end: a PNG written here, read back through ImageIO.
func TestReadRealFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "swatch.png")

	img := image.NewNRGBA(image.Rect(0, 0, 40, 25))
	img.Set(0, 0, color.NRGBA{R: 255, A: 255})
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, img); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buffer.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	info, err := New().Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.Width != 40 || info.Height != 25 {
		t.Fatalf("dimensions: %d × %d", info.Width, info.Height)
	}
	if info.Format != "PNG" {
		t.Fatalf("format: %q", info.Format)
	}
	if info.ColorModel != "RGB" || info.BitDepth != 8 {
		t.Fatalf("colour: %s %d-bit", info.ColorModel, info.BitDepth)
	}
	if !info.HasAlpha {
		t.Fatal("expected an alpha channel on an NRGBA png")
	}
	if info.Frames != 1 {
		t.Fatalf("frames: %d", info.Frames)
	}
}

// The format is read from the bytes, not from the name — which is the point of
// reporting it at all beside the extension the listing already shows.
func TestReadIdentifiesAMisnamedFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "actually-a-png.jpg")

	var buffer bytes.Buffer
	if err := png.Encode(&buffer, image.NewGray(image.Rect(0, 0, 8, 8))); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buffer.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	info, err := New().Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if info.Format != "PNG" {
		t.Fatalf("format: %q, want PNG", info.Format)
	}
}

func TestReadRejectsSomethingThatIsNotAnImage(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "notes.txt")
	if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := New().Read(path); err == nil {
		t.Fatal("expected an error for a text file")
	}
}

func TestReadRejectsAMissingFile(t *testing.T) {
	if _, err := New().Read(filepath.Join(t.TempDir(), "nope.png")); err == nil {
		t.Fatal("expected an error for a missing file")
	}
}
