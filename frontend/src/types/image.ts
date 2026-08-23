/**
 * What an image says about itself (PLAN.md §M23).
 *
 * Mirrors `backend/imagemeta`'s wire struct. Flat rather than grouped by EXIF
 * block: which IFD a lens model happened to be stored in is the format's
 * business, and the panel groups by what a reader is looking for.
 *
 * **Zero means absent** for every number here, and that is unambiguous: no
 * photograph has an ISO of 0, an f-number of 0 or a focal length of 0mm. Every
 * row in the panel is rendered only when its value is present, so a screenshot
 * shows four facts and a raw file shows twenty.
 */
export interface ImageInfo {
  width: number
  height: number
  /** What the bytes actually are — "JPEG" for a JPEG named `.png`. */
  format: string
  /** Images in the file: more than one for an animated GIF or a multi-page TIFF. */
  frames: number

  dpiWidth: number
  dpiHeight: number
  /** ImageIO's vocabulary: "RGB", "Gray", "CMYK", "Lab". */
  colorModel: string
  bitDepth: number
  hasAlpha: boolean
  indexed: boolean
  float: boolean
  profileName: string
  /** The EXIF value, 1–8. `constants/exif.ts` says what it means. */
  orientation: number

  make: string
  model: string
  lens: string
  software: string
  artist: string
  copyright: string
  description: string

  /** Seconds. Printed as a shutter speed — 0.004 is "1/250 s". */
  exposureTime: number
  fNumber: number
  iso: number
  focalLength: number
  focalLength35: number
  exposureBias: number
  exposureProgram: number
  meteringMode: number
  flash: number
  whiteBalance: number
  colorSpaceTag: number

  /**
   * The camera's own clock, as "2024-03-01 18:22:07" — a string, not an
   * instant. EXIF records wall-clock time with no zone, so turning it into a
   * timestamp would mean inventing one and showing a photo taken at 11:32 in
   * Lisbon as 12:32 in Berlin (§M23 decision 4).
   */
  dateTaken: string
  /** The zone the camera recorded beside it, when it recorded one: "+01:00". */
  dateTakenUtcOffset: string

  hasGps: boolean
  /** Signed degrees: south and west are negative. */
  latitude: number
  longitude: number
  /** Metres above sea level, negative below it. */
  altitude: number
}
