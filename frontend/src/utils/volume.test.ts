import { describe, expect, it } from 'vitest'
import { dropEffectFor, sameVolume, volumeOf } from './volume'

const MOUNTS = ['/', '/Volumes/Backup', '/Volumes/Media']

describe('volumeOf', () => {
  it('falls back to the boot volume', () => {
    expect(volumeOf('/Users/dev/Documents', MOUNTS)).toBe('/')
  })

  // "/" is a prefix of everything, so the longest match has to win or every
  // path would look like it lives on the boot disk.
  it('prefers the longest matching mount', () => {
    expect(volumeOf('/Volumes/Backup/photos/a.jpg', MOUNTS)).toBe('/Volumes/Backup')
    expect(volumeOf('/Volumes/Media', MOUNTS)).toBe('/Volumes/Media')
  })

  it('does not match a mount that is only a string prefix', () => {
    // /Volumes/BackupOld is a different disk from /Volumes/Backup.
    expect(volumeOf('/Volumes/BackupOld/a.jpg', MOUNTS)).toBe('/')
  })

  it('ignores trailing slashes', () => {
    expect(volumeOf('/Volumes/Backup/', MOUNTS)).toBe('/Volumes/Backup')
  })
})

describe('sameVolume', () => {
  it('compares by mount point, not by path prefix', () => {
    expect(sameVolume('/Users/a', '/Users/b', MOUNTS)).toBe(true)
    expect(sameVolume('/Users/a', '/Volumes/Backup/b', MOUNTS)).toBe(false)
    expect(sameVolume('/Volumes/Backup/a', '/Volumes/Backup/b', MOUNTS)).toBe(true)
  })
})

describe('dropEffectFor', () => {
  const plain = { altKey: false }
  const option = { altKey: true }

  it('moves within a volume and copies across volumes, as Finder does', () => {
    expect(dropEffectFor(['/Users/dev/a.txt'], '/Users/dev/Documents', MOUNTS, plain)).toBe('move')
    expect(dropEffectFor(['/Users/dev/a.txt'], '/Volumes/Backup', MOUNTS, plain)).toBe('copy')
  })

  it('Option forces a copy either way', () => {
    expect(dropEffectFor(['/Users/dev/a.txt'], '/Users/dev/Documents', MOUNTS, option)).toBe('copy')
    expect(dropEffectFor(['/Volumes/Backup/a.txt'], '/Users/dev', MOUNTS, option)).toBe('copy')
  })

  it('defaults to move with nothing to judge by', () => {
    expect(dropEffectFor([], '/Users/dev', MOUNTS, plain)).toBe('move')
  })
})
