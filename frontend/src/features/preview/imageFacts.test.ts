import { describe, expect, it } from 'vitest'
import {
  formatAperture,
  formatAspectRatio,
  formatCamera,
  formatCaptureTime,
  formatColorMode,
  formatCoordinates,
  formatDimensions,
  formatExposureBias,
  formatFocalLength,
  formatMegapixels,
  formatResolution,
  formatShutter,
  imageFacts,
} from './imageFacts'
import type { ImageInfo } from '@/types/image'

const EMPTY: ImageInfo = {
  width: 0,
  height: 0,
  format: '',
  frames: 1,
  dpiWidth: 0,
  dpiHeight: 0,
  colorModel: '',
  bitDepth: 0,
  hasAlpha: false,
  indexed: false,
  float: false,
  profileName: '',
  orientation: 0,
  make: '',
  model: '',
  lens: '',
  software: '',
  artist: '',
  copyright: '',
  description: '',
  exposureTime: 0,
  fNumber: 0,
  iso: 0,
  focalLength: 0,
  focalLength35: 0,
  exposureBias: 0,
  exposureProgram: 0,
  meteringMode: 0,
  flash: 0,
  whiteBalance: -1,
  colorSpaceTag: 0,
  dateTaken: '',
  dateTakenUtcOffset: '',
  hasGps: false,
  latitude: 0,
  longitude: 0,
  altitude: 0,
}

const photo = (overrides: Partial<ImageInfo> = {}): ImageInfo => ({
  ...EMPTY,
  width: 4032,
  height: 3024,
  format: 'JPEG',
  dpiWidth: 72,
  dpiHeight: 72,
  colorModel: 'RGB',
  bitDepth: 8,
  profileName: 'Display P3',
  make: 'Apple',
  model: 'iPhone 15 Pro',
  exposureTime: 0.004,
  fNumber: 1.78,
  iso: 64,
  focalLength: 6.765,
  focalLength35: 24,
  exposureProgram: 2,
  meteringMode: 5,
  dateTaken: '2025-01-01 18:22:07',
  ...overrides,
})

const valueOf = (info: ImageInfo, group: string, label: string) =>
  imageFacts(info)
    .find((entry) => entry.title === group)
    ?.facts.find((fact) => fact.label === label)?.value

describe('formatShutter', () => {
  // What a camera's own display says, which is not what the file stores.
  it('prints sub-second exposures as fractions', () => {
    expect(formatShutter(0.004)).toBe('1/250 s')
    expect(formatShutter(1 / 60)).toBe('1/60 s')
  })

  it('prints long exposures as seconds', () => {
    expect(formatShutter(2)).toBe('2 s')
    expect(formatShutter(1.6)).toBe('1.6 s')
  })

  it('has nothing to say about an absent exposure', () => {
    expect(formatShutter(0)).toBe('')
  })
})

describe('formatAperture', () => {
  it('uses the notation engraved on lenses', () => {
    expect(formatAperture(1.78)).toBe('ƒ/1.8')
    expect(formatAperture(11)).toBe('ƒ/11')
  })

  it('is empty when absent', () => {
    expect(formatAperture(0)).toBe('')
  })
})

describe('formatFocalLength', () => {
  // 6.8mm on a phone and 24mm on a full-frame body frame the same picture; the
  // second is the number that means something.
  it('adds the 35mm equivalent when it differs', () => {
    expect(formatFocalLength(6.765, 24)).toBe('6.8 mm (24 mm equivalent)')
  })

  it('says it once when the camera is full frame', () => {
    expect(formatFocalLength(50, 50)).toBe('50 mm')
  })

  it('falls back to the equivalent alone', () => {
    expect(formatFocalLength(0, 27)).toBe('27 mm (35 mm equivalent)')
  })

  it('is empty when neither is recorded', () => {
    expect(formatFocalLength(0, 0)).toBe('')
  })
})

describe('formatExposureBias', () => {
  it('signs the value explicitly, with a real minus', () => {
    expect(formatExposureBias(0.33)).toBe('+0.33 EV')
    expect(formatExposureBias(-0.5)).toBe('−0.5 EV')
  })

  // Every uncompensated photograph records 0, and a row that is on all of them
  // and means nothing on any of them is what makes a panel unreadable.
  it('says nothing about no compensation', () => {
    expect(formatExposureBias(0)).toBe('')
  })
})

describe('formatDimensions and megapixels', () => {
  it('groups the digits', () => {
    expect(formatDimensions(4032, 3024)).toBe('4,032 × 3,024 px')
  })

  it('reports megapixels for a photograph', () => {
    expect(formatMegapixels(4032, 3024)).toBe('12.2 MP')
  })

  // An icon is not measured in megapixels.
  it('says nothing for a tiny image', () => {
    expect(formatMegapixels(16, 16)).toBe('')
  })
})

describe('formatAspectRatio', () => {
  it('reduces the common ones', () => {
    expect(formatAspectRatio(4032, 3024)).toBe('4:3')
    expect(formatAspectRatio(1920, 1080)).toBe('16:9')
    expect(formatAspectRatio(512, 512)).toBe('1:1')
  })

  // A resize leaves 500 × 667 where 3:4 was, and reducing that exactly gives
  // 500:667 — true, and no use to anybody.
  it('names a ratio a resize rounded off', () => {
    expect(formatAspectRatio(500, 667)).toBe('3:4')
    expect(formatAspectRatio(1999, 1125)).toBe('16:9')
  })

  // An arbitrary crop has no name, and 1207:800 is a fact that helps nobody.
  it('falls back to a decimal for an arbitrary crop', () => {
    expect(formatAspectRatio(1207, 800)).toBe('1.51:1')
    expect(formatAspectRatio(1640, 1146)).toBe('1.43:1')
  })

  // Wide enough to name a photograph, tight enough that a crop 1.7% off 4:3 is
  // not called 4:3 — that difference is a decision somebody made.
  it('does not name a ratio that is merely nearby', () => {
    expect(formatAspectRatio(3000, 2000)).toBe('3:2')
    expect(formatAspectRatio(4000, 2950)).toBe('1.36:1')
  })
})

describe('formatResolution', () => {
  it('says it once when the axes agree', () => {
    expect(formatResolution(72, 72)).toBe('72 dpi')
  })

  it('says both when they do not', () => {
    expect(formatResolution(300, 150)).toBe('300 × 150 dpi')
  })

  it('is empty when the file records none', () => {
    expect(formatResolution(0, 0)).toBe('')
  })
})

describe('formatColorMode', () => {
  it('states the mode the way an editor does', () => {
    expect(formatColorMode({ ...EMPTY, colorModel: 'RGB', bitDepth: 8 })).toBe('RGB, 8-bit')
  })

  it('mentions an alpha channel', () => {
    expect(formatColorMode({ ...EMPTY, colorModel: 'RGB', bitDepth: 8, hasAlpha: true })).toBe(
      'RGB, 8-bit + alpha',
    )
  })

  it('mentions an indexed palette and floating point', () => {
    expect(formatColorMode({ ...EMPTY, colorModel: 'RGB', bitDepth: 8, indexed: true })).toBe(
      'RGB, indexed, 8-bit',
    )
    expect(formatColorMode({ ...EMPTY, colorModel: 'RGB', bitDepth: 32, float: true })).toBe(
      'RGB, 32-bit float',
    )
  })
})

describe('formatCamera', () => {
  // The tell of a metadata panel nobody read the output of.
  it('does not say Canon twice', () => {
    expect(formatCamera('Canon', 'Canon EOS R6')).toBe('Canon EOS R6')
    expect(formatCamera('NIKON CORPORATION', 'NIKON D850')).toBe('NIKON CORPORATION NIKON D850')
  })

  it('joins a make and model that do not overlap', () => {
    expect(formatCamera('Apple', 'iPhone 15 Pro')).toBe('Apple iPhone 15 Pro')
  })

  it('copes with either half being absent', () => {
    expect(formatCamera('', 'X100V')).toBe('X100V')
    expect(formatCamera('FUJIFILM', '')).toBe('FUJIFILM')
  })
})

describe('formatCaptureTime', () => {
  // The digits the camera recorded, whatever timezone the reader is in.
  it('prints the camera clock, not a converted instant', () => {
    const printed = formatCaptureTime('2025-01-01 18:22:07', '')
    // 18:22:07 or 6:22:07 PM depending on the reader's locale — what matters is
    // that the digits are the camera's, not shifted into the runner's zone.
    expect(printed).toMatch(/\b(18|6):22:07\b/)
    expect(printed).toContain('2025')
  })

  it('appends the recorded offset rather than applying it', () => {
    expect(formatCaptureTime('2025-01-01 18:22:07', '+01:00')).toContain('(UTC+01:00)')
  })

  it('is empty for anything that is not a capture time', () => {
    expect(formatCaptureTime('', '')).toBe('')
    expect(formatCaptureTime('yesterday', '')).toBe('')
  })
})

describe('formatCoordinates', () => {
  it('reads back in hemispheres', () => {
    expect(formatCoordinates(-22.9068, -43.1729)).toBe('22.90680° S, 43.17290° W')
    expect(formatCoordinates(51.5074, 0.1278)).toBe('51.50740° N, 0.12780° E')
  })
})

describe('imageFacts', () => {
  it('groups a photograph into image, camera and location', () => {
    const groups = imageFacts(photo({ hasGps: true, latitude: -22.9, longitude: -43.1 }))
    expect(groups.map((group) => group.title)).toEqual(['Image', 'Camera', 'Location'])
  })

  // Rule 1: a screenshot has no lens, and "Lens: —" is noise dressed as data.
  it('drops the camera group entirely for a screenshot', () => {
    const groups = imageFacts({
      ...EMPTY,
      width: 2880,
      height: 1800,
      format: 'PNG',
      colorModel: 'RGB',
      bitDepth: 8,
      hasAlpha: true,
    })
    expect(groups.map((group) => group.title)).toEqual(['Image'])
  })

  it('drops the location group when there is no fix', () => {
    expect(imageFacts(photo()).map((group) => group.title)).toEqual(['Image', 'Camera'])
  })

  it('renders the camera rows a photographer reads', () => {
    const info = photo()
    expect(valueOf(info, 'Camera', 'Shutter')).toBe('1/250 s')
    expect(valueOf(info, 'Camera', 'Aperture')).toBe('ƒ/1.8')
    expect(valueOf(info, 'Camera', 'ISO')).toBe('64')
    expect(valueOf(info, 'Camera', 'Focal length')).toBe('6.8 mm (24 mm equivalent)')
    expect(valueOf(info, 'Camera', 'Program')).toBe('Program AE')
    expect(valueOf(info, 'Camera', 'Metering')).toBe('Pattern')
  })

  // "Orientation: Normal" is true of every upright photograph ever taken.
  it('mentions orientation only when the file is turned', () => {
    expect(valueOf(photo({ orientation: 1 }), 'Image', 'Orientation')).toBeUndefined()
    expect(valueOf(photo({ orientation: 6 }), 'Image', 'Orientation')).toBe('Rotated 90° CW')
  })

  it('mentions frames only when there is more than one', () => {
    expect(valueOf(photo({ frames: 1 }), 'Image', 'Frames')).toBeUndefined()
    expect(valueOf(photo({ frames: 24 }), 'Image', 'Frames')).toBe('24')
  })

  // A code this build has never heard of is left out rather than rendered as
  // "Unknown (9)", which is a row that costs space and says nothing.
  it('leaves an unrecognised code out', () => {
    expect(valueOf(photo({ meteringMode: 99 }), 'Camera', 'Metering')).toBeUndefined()
  })

  it('reads the flash tag as the bit field it is', () => {
    expect(valueOf(photo({ flash: 0 }), 'Camera', 'Flash')).toBeUndefined()
    expect(valueOf(photo({ flash: 16 }), 'Camera', 'Flash')).toBe('Did not fire, suppressed')
    // 0x09 is fired in compulsory mode; 0x19 is fired in auto mode. Reading the
    // tag as a lookup table gets these two the wrong way round.
    expect(valueOf(photo({ flash: 9 }), 'Camera', 'Flash')).toBe('Fired, forced')
    expect(valueOf(photo({ flash: 25 }), 'Camera', 'Flash')).toBe('Fired, auto')
    expect(valueOf(photo({ flash: 89 }), 'Camera', 'Flash')).toBe('Fired, auto, red-eye reduction')
  })

  // The empty case has to be safe: an image the system identified but knows
  // nothing else about should produce no groups rather than a group of blanks.
  it('produces nothing at all for an empty record', () => {
    expect(imageFacts(EMPTY)).toEqual([])
  })
})
