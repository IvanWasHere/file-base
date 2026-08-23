/**
 * An image's metadata, turned into the rows a preview panel draws (§M23).
 *
 * Separate from the component for the reason `previewKind` is: this is where
 * every judgement about *what a photographer would want to read* lives — that a
 * shutter is "1/250 s" and not "0.004", that 22.9068 south is "22.9068° S",
 * that an orientation of 1 is not worth a row — and none of it needs React to
 * be tested.
 *
 * Two rules run through all of it:
 *
 *  1. **A fact with no value is not a row.** A screenshot has no lens, and
 *     "Lens: —" is noise dressed up as information. The groups collapse the
 *     same way, so a PNG shows one short block and a raw file shows three.
 *  2. **Nothing is invented.** Absent stays absent: no "Unknown", no zero
 *     rendered as a real measurement, no timezone applied to a clock that never
 *     recorded one.
 */

import {
  colorSpaceLabel,
  exposureProgramLabel,
  flashLabel,
  meteringModeLabel,
  orientationLabel,
  whiteBalanceLabel,
} from '@/constants/exif'
import type { ImageInfo } from '@/types/image'

export interface ImageFact {
  label: string
  value: string
}

export interface ImageFactGroup {
  title: string
  facts: ImageFact[]
}

/** Drops the rows with nothing in them — rule 1, applied in one place. */
function group(title: string, facts: (ImageFact | null)[]): ImageFactGroup | null {
  const present = facts.filter((fact): fact is ImageFact => fact !== null && fact.value !== '')
  return present.length > 0 ? { title, facts: present } : null
}

function fact(label: string, value: string): ImageFact | null {
  return value ? { label, value } : null
}

/** `6.765` reads as `6.8`, `24.0` as `24` — a measurement, not a float. */
function trim(value: number, decimals = 1): string {
  return Number(value.toFixed(decimals)).toString()
}

/**
 * A shutter speed as a camera shows it.
 *
 * Fractions below a second, decimals above: `1/250 s`, `2 s`, `1.6 s`. The
 * rounding is deliberate — sensors record 0.0040000001 and no display in
 * photography has ever shown that.
 */
export function formatShutter(seconds: number): string {
  if (seconds <= 0) return ''
  if (seconds >= 1) return `${trim(seconds)} s`
  return `1/${Math.round(1 / seconds)} s`
}

/** `ƒ/1.8`, in the notation lenses are engraved with. */
export function formatAperture(fNumber: number): string {
  return fNumber > 0 ? `ƒ/${trim(fNumber)}` : ''
}

/**
 * The focal length, with the 35mm equivalent when it differs.
 *
 * The equivalent is the number that means something across cameras: 6.8mm on a
 * phone and 24mm on a full-frame body frame the same picture, and only the
 * second tells a reader what they are looking at.
 */
export function formatFocalLength(focal: number, equivalent: number): string {
  if (focal <= 0) return equivalent > 0 ? `${trim(equivalent)} mm (35 mm equivalent)` : ''
  const base = `${trim(focal)} mm`
  if (equivalent <= 0 || Math.abs(equivalent - focal) < 0.5) return base
  return `${base} (${trim(equivalent)} mm equivalent)`
}

/**
 * Exposure compensation, with a real minus sign and an explicit plus.
 *
 * Zero returns nothing: every photograph that was not compensated says 0, and a
 * row that is present on all of them and means nothing on any of them is the
 * kind of thing that makes a metadata panel unreadable.
 */
export function formatExposureBias(stops: number): string {
  if (!stops) return ''
  return `${stops > 0 ? '+' : '−'}${trim(Math.abs(stops), 2)} EV`
}

/** `4,032 × 3,024 px`, grouped so a five-digit width stays readable. */
export function formatDimensions(width: number, height: number): string {
  if (width <= 0 || height <= 0) return ''
  return `${width.toLocaleString()} × ${height.toLocaleString()} px`
}

export function formatMegapixels(width: number, height: number): string {
  const megapixels = (width * height) / 1_000_000
  // Below 0.1 MP the number rounds to nothing useful — an icon is not measured
  // in megapixels.
  return megapixels >= 0.1 ? `${trim(megapixels)} MP` : ''
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/**
 * The ratios worth naming, landscape-first. Their inverses are checked too, so
 * a portrait 3:4 is recognised as readily as a landscape 4:3.
 */
const COMMON_RATIOS: [number, number][] = [
  [1, 1],
  [5, 4],
  [4, 3],
  [3, 2],
  [16, 10],
  [16, 9],
  [2, 1],
  [21, 9],
]

/**
 * How far from a named ratio still counts as that ratio.
 *
 * 0.5%, which is the difference between a 500 × 667 scan and a true 3:4 — the
 * rounding a resize leaves behind, not a crop anybody chose. Wide enough to
 * name what a photograph is, tight enough that a 3:2 frame is never called 4:3.
 */
const RATIO_TOLERANCE = 0.005

/**
 * The aspect ratio, named where a name exists and decimal where none does.
 *
 * Three answers, in descending order of usefulness. An exact reduction is best
 * — 1,920 × 1,080 really is 16:9. Failing that, a near miss on a ratio anybody
 * would recognise: 500 × 667 is a 3:4 photograph that has been through a
 * resize, and saying so is more use than the truth of 500:667. Failing both,
 * the decimal, because an arbitrary crop has no name and `1207:800` is a fact
 * that helps nobody.
 */
export function formatAspectRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) return ''

  const divisor = gcd(width, height)
  const w = width / divisor
  const h = height / divisor
  if (w <= 40 && h <= 40) return `${w}:${h}`

  const ratio = width / height
  for (const [long, short] of COMMON_RATIOS) {
    for (const [a, b] of [
      [long, short],
      [short, long],
    ] as [number, number][]) {
      if (Math.abs(ratio - a / b) / (a / b) <= RATIO_TOLERANCE) return `${a}:${b}`
    }
  }

  return `${ratio.toFixed(2)}:1`
}

export function formatResolution(dpiWidth: number, dpiHeight: number): string {
  if (dpiWidth <= 0 && dpiHeight <= 0) return ''
  // Square resolution is the overwhelming case, and "72 × 72 dpi" says the same
  // thing twice.
  if (!dpiHeight || dpiWidth === dpiHeight) return `${trim(dpiWidth)} dpi`
  if (!dpiWidth) return `${trim(dpiHeight)} dpi`
  return `${trim(dpiWidth)} × ${trim(dpiHeight)} dpi`
}

/**
 * The colour mode, the way an image editor states it: `RGB, 8-bit + alpha`.
 *
 * One row rather than four, because these facts are only meaningful together —
 * "8" alone answers nothing.
 */
export function formatColorMode(info: ImageInfo): string {
  if (!info.colorModel && info.bitDepth <= 0) return ''

  const parts: string[] = []
  if (info.colorModel) parts.push(info.indexed ? `${info.colorModel}, indexed` : info.colorModel)
  if (info.bitDepth > 0) parts.push(`${info.bitDepth}-bit${info.float ? ' float' : ''}`)

  const base = parts.join(', ')
  return info.hasAlpha ? `${base} + alpha` : base
}

const CAPTURE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  // The value is a wall clock with no zone. Formatting it in UTC is what keeps
  // the digits the camera recorded: anything else would show a photo taken at
  // 18:22 in Lisbon as 19:22 to a reader in Berlin (§M23 decision 4).
  timeZone: 'UTC',
})

/**
 * The capture time, printed as the camera's own clock.
 *
 * The stored offset is appended rather than applied, so a reader who cares
 * which 18:22 it was can see it and one who does not is not shown a converted
 * time pretending to be the original.
 */
export function formatCaptureTime(dateTaken: string, offset: string): string {
  // "2024-03-01 18:22:07" — the shape `backend/imagemeta` normalises to.
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(dateTaken.trim())
  if (!match) return ''

  const [, year, month, day, hour, minute, second] = match
  const stamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )
  if (Number.isNaN(stamp)) return ''

  const printed = CAPTURE_FORMAT.format(new Date(stamp))
  return offset ? `${printed} (UTC${offset})` : printed
}

/**
 * Coordinates in the hemisphere notation every photo application shows.
 *
 * The wire carries signed degrees, which is the form worth computing with; this
 * is the form worth reading.
 */
export function formatCoordinates(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(5)}° ${latitude < 0 ? 'S' : 'N'}`
  const lon = `${Math.abs(longitude).toFixed(5)}° ${longitude < 0 ? 'W' : 'E'}`
  return `${lat}, ${lon}`
}

/**
 * The camera, without saying "Canon" twice.
 *
 * Most makers put the brand in the model — "Canon EOS R6", "NIKON D850" — and a
 * naive join produces "Canon Canon EOS R6", which is the tell of a metadata
 * panel nobody read the output of.
 */
export function formatCamera(make: string, model: string): string {
  if (!make) return model
  if (!model) return make
  return model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`
}

/**
 * Everything worth showing about an image, grouped.
 *
 * Three groups, in the order a reader asks the questions: what is this image,
 * what took it, where was it taken.
 */
export function imageFacts(info: ImageInfo): ImageFactGroup[] {
  const image = group('Image', [
    fact('Dimensions', formatDimensions(info.width, info.height)),
    fact('Megapixels', formatMegapixels(info.width, info.height)),
    fact('Aspect ratio', formatAspectRatio(info.width, info.height)),
    fact('Resolution', formatResolution(info.dpiWidth, info.dpiHeight)),
    fact('Color mode', formatColorMode(info)),
    fact('Color profile', info.profileName),
    fact('Color space', colorSpaceLabel(info.colorSpaceTag)),
    // Only when the file is turned: "Normal" on every upright photograph is a
    // row that never says anything.
    fact('Orientation', orientationLabel(info.orientation)),
    fact('Format', info.format),
    // A still image says "1", which is not news.
    fact('Frames', info.frames > 1 ? info.frames.toLocaleString() : ''),
  ])

  const camera = group('Camera', [
    // "Model", not "Camera": the group is already called Camera, and a row
    // repeating its own heading reads as a rendering mistake. It sits beside
    // Lens, which is the EXIF pairing anyone scanning this expects.
    fact('Model', formatCamera(info.make, info.model)),
    fact('Lens', info.lens),
    fact('Shutter', formatShutter(info.exposureTime)),
    fact('Aperture', formatAperture(info.fNumber)),
    fact('ISO', info.iso > 0 ? info.iso.toLocaleString() : ''),
    fact('Focal length', formatFocalLength(info.focalLength, info.focalLength35)),
    fact('Exposure bias', formatExposureBias(info.exposureBias)),
    fact('Program', exposureProgramLabel(info.exposureProgram)),
    fact('Metering', meteringModeLabel(info.meteringMode)),
    fact('Flash', flashLabel(info.flash)),
    fact('White balance', whiteBalanceLabel(info.whiteBalance)),
    fact('Taken', formatCaptureTime(info.dateTaken, info.dateTakenUtcOffset)),
    fact('Software', info.software),
    fact('Artist', info.artist),
    fact('Copyright', info.copyright),
    fact('Description', info.description),
  ])

  const location = info.hasGps
    ? group('Location', [
        fact('Coordinates', formatCoordinates(info.latitude, info.longitude)),
        fact('Altitude', info.altitude ? `${trim(info.altitude)} m` : ''),
      ])
    : null

  return [image, camera, location].filter((entry): entry is ImageFactGroup => entry !== null)
}
