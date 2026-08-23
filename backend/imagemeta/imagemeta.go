// Package imagemeta reads what an image says about itself (PLAN.md §M23).
//
// Everything here comes from ImageIO — the same framework Preview, Photos and
// every macOS image editor read metadata with — rather than from a Go decoder
// or a third-party EXIF parser. Three reasons:
//
//   - It knows every format the system knows, including the ones no pure-Go
//     decoder handles: HEIC, camera RAW, multi-page TIFF, AVIF.
//   - It reads headers only. A 200MP RAW answers as fast as a thumbnail does,
//     because nothing is decoded.
//   - It is already on the machine. An unmaintained EXIF library would be a new
//     dependency that knows less.
//
// The cgo half (imageio_darwin.go) does one thing: hand back the property
// dictionary as a binary property list. Everything below is ordinary Go working
// on a map, which is what makes the mapping testable without a photo on disk.
//
// Note what is *not* done here: no enum is turned into a word. Exposure program
// 3 stays 3, and `constants/exif.ts` decides that it reads "Aperture priority",
// exactly as §M22 kept Finder's colour index a number and let the frontend own
// the swatch (PLAN.md §1: no UI decisions in Go).
package imagemeta

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"file-base/backend/filesystem"

	"howett.net/plist"
)

// ImageMeta is bound to Wails; its exported methods become the TS bindings.
type ImageMeta struct{}

func New() *ImageMeta {
	return &ImageMeta{}
}

// ImageInfo is the wire representation of an image's metadata.
//
// Flat rather than nested-by-EXIF-group: the groups are an artefact of how the
// format stores things — a lens model lives under Exif in one file and ExifAux
// in another — and the panel that renders this groups by what the reader is
// looking for, not by which IFD it came from.
//
// Zero means absent for every numeric field. That is unambiguous here: a photo
// with a focal length of 0mm, an f-number of 0 or an ISO of 0 does not exist.
type ImageInfo struct {
	Width  int `json:"width"`
	Height int `json:"height"`
	// Format is what the bytes actually are, from the system's own type
	// identification — "JPEG" for a JPEG named .png, which is worth seeing.
	Format string `json:"format"`
	// Frames counts images in the file: >1 for an animated GIF, a multi-page
	// TIFF, or a HEIC burst.
	Frames int `json:"frames"`

	DPIWidth  float64 `json:"dpiWidth"`
	DPIHeight float64 `json:"dpiHeight"`
	// ColorModel is ImageIO's own vocabulary — "RGB", "Gray", "CMYK", "Lab".
	ColorModel  string `json:"colorModel"`
	BitDepth    int    `json:"bitDepth"`
	HasAlpha    bool   `json:"hasAlpha"`
	Indexed     bool   `json:"indexed"`
	Float       bool   `json:"float"`
	ProfileName string `json:"profileName"`
	// Orientation is the EXIF value, 1–8. The frontend says what it means.
	Orientation int `json:"orientation"`

	Make      string `json:"make"`
	Model     string `json:"model"`
	Lens      string `json:"lens"`
	Software  string `json:"software"`
	Artist    string `json:"artist"`
	Copyright string `json:"copyright"`
	// Description is IPTC's caption, which is where a caption written in Photoshop
	// or Lightroom ends up.
	Description string `json:"description"`

	// ExposureTime is in seconds; the frontend prints it as 1/250.
	ExposureTime  float64 `json:"exposureTime"`
	FNumber       float64 `json:"fNumber"`
	ISO           int     `json:"iso"`
	FocalLength   float64 `json:"focalLength"`
	FocalLength35 float64 `json:"focalLength35"`
	ExposureBias  float64 `json:"exposureBias"`
	// Codes, not words: EXIF enumerations the frontend has the labels for.
	ExposureProgram int `json:"exposureProgram"`
	MeteringMode    int `json:"meteringMode"`
	Flash           int `json:"flash"`
	// WhiteBalance is the one enumeration here whose *zero* is a real answer:
	// 0 is "auto", 1 is "manual". It is therefore -1 when the file says nothing,
	// because reporting 0 would make every screenshot claim its white balance
	// was set automatically.
	WhiteBalance  int `json:"whiteBalance"`
	ColorSpaceTag int `json:"colorSpaceTag"`

	// DateTaken is the camera's own clock, as "2019-06-18 11:32:01".
	//
	// A string rather than a unix timestamp, deliberately. EXIF records local
	// wall-clock time with no zone, so converting it to an instant would mean
	// inventing one — and then a photo taken at 11:32 in Lisbon would be shown
	// as 12:32 to someone browsing it in Berlin. The offset, when the file
	// records one, is reported beside it rather than folded in.
	DateTaken    string `json:"dateTaken"`
	DateTakenUTC string `json:"dateTakenUtcOffset"`

	HasGPS bool `json:"hasGps"`
	// Signed: south and west are negative, as everywhere outside EXIF.
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	// Altitude is metres above sea level, negative below it.
	Altitude float64 `json:"altitude"`
}

// ErrNotAnImage is returned for a file the system cannot identify as an image.
var ErrNotAnImage = errors.New("not an image")

// Read returns what the file at path says about itself.
//
// Header-only, so this is cheap enough to run on every selection change; the
// frontend still caches it by path and mtime, as it does previews.
func (m *ImageMeta) Read(path string) (ImageInfo, error) {
	blob, frames, format, err := copyProperties(path)
	if err != nil {
		return ImageInfo{}, filesystem.Wrap(path, err)
	}

	var props map[string]any
	if _, err := plist.Unmarshal(blob, &props); err != nil {
		return ImageInfo{}, filesystem.Wrap(path, fmt.Errorf("unreadable image properties: %w", err))
	}

	info := fromProperties(props)
	info.Frames = frames
	info.Format = format
	return info, nil
}

// fromProperties maps ImageIO's dictionary onto ImageInfo.
//
// Every lookup is a miss away from nothing: a PNG has no {Exif}, a scan has no
// {GPS}, and a screenshot has neither. Absent is the common case, not the error
// case, which is why nothing here reports one.
func fromProperties(props map[string]any) ImageInfo {
	info := ImageInfo{
		Width:       intOf(props["PixelWidth"]),
		Height:      intOf(props["PixelHeight"]),
		DPIWidth:    floatOf(props["DPIWidth"]),
		DPIHeight:   floatOf(props["DPIHeight"]),
		ColorModel:  stringOf(props["ColorModel"]),
		BitDepth:    intOf(props["Depth"]),
		HasAlpha:    boolOf(props["HasAlpha"]),
		Indexed:     boolOf(props["IsIndexed"]),
		Float:       boolOf(props["IsFloat"]),
		ProfileName: stringOf(props["ProfileName"]),
		Orientation: intOf(props["Orientation"]),
	}

	tiff := dictOf(props["{TIFF}"])
	info.Make = stringOf(tiff["Make"])
	info.Model = stringOf(tiff["Model"])
	info.Software = stringOf(tiff["Software"])
	info.Artist = stringOf(tiff["Artist"])
	info.Copyright = stringOf(tiff["Copyright"])
	// The top-level Orientation is ImageIO's normalised one and is the one to
	// trust; TIFF's is the fallback for files where it did not surface.
	if info.Orientation == 0 {
		info.Orientation = intOf(tiff["Orientation"])
	}

	exif := dictOf(props["{Exif}"])
	info.ExposureTime = floatOf(exif["ExposureTime"])
	info.FNumber = floatOf(exif["FNumber"])
	// A list, because EXIF allows several sensitivities; the first is the one
	// every reader shows.
	info.ISO = intOf(firstOf(exif["ISOSpeedRatings"]))
	info.FocalLength = floatOf(exif["FocalLength"])
	info.FocalLength35 = floatOf(exif["FocalLenIn35mmFilm"])
	info.ExposureBias = floatOf(exif["ExposureBiasValue"])
	info.ExposureProgram = intOf(exif["ExposureProgram"])
	info.MeteringMode = intOf(exif["MeteringMode"])
	info.Flash = intOf(exif["Flash"])
	info.WhiteBalance = intOrMissing(exif["WhiteBalance"])
	info.ColorSpaceTag = intOf(exif["ColorSpace"])
	info.DateTaken = exifDate(stringOf(exif["DateTimeOriginal"]))
	info.DateTakenUTC = stringOf(exif["OffsetTimeOriginal"])

	// The lens is wherever the camera maker chose to put it.
	aux := dictOf(props["{ExifAux}"])
	info.Lens = firstNonEmpty(
		stringOf(exif["LensModel"]),
		stringOf(aux["LensModel"]),
		stringOf(exif["LensMake"]),
	)

	// Falling back to when the file was written, which is what a scanner or an
	// editor leaves behind when there is no capture time.
	if info.DateTaken == "" {
		info.DateTaken = exifDate(stringOf(exif["DateTimeDigitized"]))
	}
	if info.DateTaken == "" {
		info.DateTaken = exifDate(stringOf(tiff["DateTime"]))
	}

	iptc := dictOf(props["{IPTC}"])
	info.Description = firstNonEmpty(
		stringOf(iptc["Caption/Abstract"]),
		stringOf(iptc["Headline"]),
	)
	info.Artist = firstNonEmpty(info.Artist, stringOf(firstOf(iptc["Byline"])))
	info.Copyright = firstNonEmpty(info.Copyright, stringOf(iptc["CopyrightNotice"]))

	readGPS(dictOf(props["{GPS}"]), &info)
	return info
}

// readGPS turns EXIF's hemisphere-and-magnitude into signed degrees.
//
// A photo taken in Rio stores 22.9 with a "S", and every map in the world wants
// -22.9. Doing that conversion here rather than in the panel keeps one signed
// pair on the wire, which is also the only form worth copying to a clipboard.
func readGPS(gps map[string]any, info *ImageInfo) {
	if len(gps) == 0 {
		return
	}

	lat, hasLat := gps["Latitude"]
	lon, hasLon := gps["Longitude"]
	if !hasLat || !hasLon {
		return
	}

	latitude := math.Abs(floatOf(lat))
	longitude := math.Abs(floatOf(lon))
	if strings.EqualFold(stringOf(gps["LatitudeRef"]), "S") {
		latitude = -latitude
	}
	if strings.EqualFold(stringOf(gps["LongitudeRef"]), "W") {
		longitude = -longitude
	}

	// 0,0 is a real place in the Gulf of Guinea and a very common way for a file
	// to say "no fix". A pin dropped there is worse than no pin.
	if latitude == 0 && longitude == 0 {
		return
	}

	info.HasGPS = true
	info.Latitude = latitude
	info.Longitude = longitude

	altitude := math.Abs(floatOf(gps["Altitude"]))
	// AltitudeRef 1 means below sea level. Unlike latitude, the magnitude is
	// stored unsigned with no textual hemisphere.
	if intOf(gps["AltitudeRef"]) == 1 {
		altitude = -altitude
	}
	info.Altitude = altitude
}

// exifDate rewrites EXIF's "2019:06:18 11:32:01" as "2019-06-18 11:32:01".
//
// Only the separators change: no zone is applied and no instant is computed,
// because the value has neither. A string that is not in EXIF's shape is
// dropped rather than half-converted.
func exifDate(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) < 19 {
		return ""
	}
	date, clock, found := strings.Cut(trimmed[:19], " ")
	if !found || len(date) != 10 || len(clock) != 8 {
		return ""
	}
	// A camera with an unset clock writes zeroes; showing "0000-00-00" as a
	// capture date would be worse than showing nothing.
	if strings.HasPrefix(date, "0000") {
		return ""
	}
	return strings.ReplaceAll(date, ":", "-") + " " + clock
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// The plist decoder hands back `any`, and a property that is an integer in one
// file is a float in the next — an f-number is 1.8 in one camera's output and 2
// in another's. These four accessors are where that stops mattering.

func dictOf(value any) map[string]any {
	if dict, ok := value.(map[string]any); ok {
		return dict
	}
	return map[string]any{}
}

func firstOf(value any) any {
	if list, ok := value.([]any); ok && len(list) > 0 {
		return list[0]
	}
	return value
}

func stringOf(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}

func boolOf(value any) bool {
	flag, ok := value.(bool)
	return ok && flag
}

func floatOf(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int64:
		return float64(typed)
	case uint64:
		return float64(typed)
	case int:
		return float64(typed)
	}
	return 0
}

// intOrMissing distinguishes "the file did not say" from "the file said zero",
// which matters for exactly one tag — see ImageInfo.WhiteBalance.
func intOrMissing(value any) int {
	if value == nil {
		return -1
	}
	return intOf(value)
}

func intOf(value any) int {
	// Through float64 so a value stored as 8.0 still reads as 8. Values this
	// large do not occur in image metadata, so the conversion cannot surprise.
	return int(floatOf(value))
}
