/**
 * EXIF's vocabulary, as data (PLAN.md §M23).
 *
 * Go reports the numbers the file holds and nothing else — metering mode 5 is
 * metering mode 5 — for the reason §M22 kept a Finder tag's colour as an index:
 * naming things is a UI decision, and PLAN.md §1 keeps those out of the
 * backend. This is where the numbers become words.
 *
 * Every lookup falls back to nothing rather than to "Unknown (7)". A row with
 * no value is not rendered at all, which is the honest answer for a code this
 * build has never heard of — and far better than a panel full of "Unknown".
 */

/** The shutter's exposure programme (EXIF tag 34850). */
const EXPOSURE_PROGRAMS: Record<number, string> = {
  1: 'Manual',
  // "Program AE", not "Program": the row is already labelled Program, and
  // "Program: Program" reads as a rendering fault rather than as P mode. AE is
  // what the mode is called on every camera that has it.
  2: 'Program AE',
  3: 'Aperture priority',
  4: 'Shutter priority',
  5: 'Creative',
  6: 'Action',
  7: 'Portrait',
  8: 'Landscape',
}

/** How the camera measured the light (EXIF tag 37383). */
const METERING_MODES: Record<number, string> = {
  1: 'Average',
  2: 'Center-weighted',
  3: 'Spot',
  4: 'Multi-spot',
  5: 'Pattern',
  6: 'Partial',
}

const WHITE_BALANCE: Record<number, string> = {
  0: 'Auto',
  1: 'Manual',
}

/**
 * The colour space the file claims (EXIF tag 40961).
 *
 * 65535 is "uncalibrated", which in practice means "something other than sRGB,
 * see the profile" — a Display P3 photo from an iPhone says exactly this, which
 * is why the panel shows the ICC profile name beside it.
 */
const COLOR_SPACES: Record<number, string> = {
  1: 'sRGB',
  2: 'Adobe RGB',
  65535: 'Uncalibrated',
}

/**
 * How the image is rotated relative to how it is stored (EXIF tag 274).
 *
 * 1 is the ordinary case and is deliberately absent: "Orientation: Normal" is a
 * row that tells the reader nothing, and every image that has never been turned
 * says it.
 */
const ORIENTATIONS: Record<number, string> = {
  2: 'Mirrored',
  3: 'Rotated 180°',
  4: 'Mirrored, rotated 180°',
  5: 'Mirrored, rotated 90° CCW',
  6: 'Rotated 90° CW',
  7: 'Mirrored, rotated 90° CW',
  8: 'Rotated 90° CCW',
}

function labelFrom(table: Record<number, string>, code: number): string {
  return table[code] ?? ''
}

export const exposureProgramLabel = (code: number): string => labelFrom(EXPOSURE_PROGRAMS, code)
export const meteringModeLabel = (code: number): string => labelFrom(METERING_MODES, code)
export const whiteBalanceLabel = (code: number): string => labelFrom(WHITE_BALANCE, code)
export const colorSpaceLabel = (code: number): string => labelFrom(COLOR_SPACES, code)
export const orientationLabel = (code: number): string => labelFrom(ORIENTATIONS, code)

/**
 * The flash tag is a bit field, not an enumeration (EXIF tag 37385).
 *
 * Bit 0 is whether it fired; bits 3–4 are the mode the camera was in. Reading
 * it as a lookup table is the usual mistake — the table would need 32 rows, and
 * cameras use values that are not in it.
 */
export function flashLabel(code: number): string {
  // Not "Did not fire": a camera with no flash writes 0, and so does a camera
  // that chose not to fire. There is nothing here worth a row.
  if (code <= 0) return ''

  const fired = (code & 0x1) !== 0
  const parts = [fired ? 'Fired' : 'Did not fire']

  const mode = (code >> 3) & 0x3
  if (mode === 1) parts.push('forced')
  if (mode === 2) parts.push('suppressed')
  if (mode === 3) parts.push('auto')
  // Bit 6: the "red-eye reduction" lamp, which is a separate fact from firing.
  if ((code & 0x40) !== 0) parts.push('red-eye reduction')

  return parts.join(', ')
}
