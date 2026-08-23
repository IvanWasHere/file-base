import { describe, expect, it } from 'vitest'
import { toFileItem, toFsError } from './decode'
import { filesystem } from '../../../../wailsjs/go/models'

/**
 * Builds the wire shape Go sends, with sensible defaults.
 *
 * Through `createFrom` rather than as a literal since §M22: `FileItem` gained a
 * nested `Tag[]`, so Wails now generates it as a class with a converter, and
 * the class is what a real call hands back.
 */
function wire(overrides: Partial<filesystem.FileItem> = {}): filesystem.FileItem {
  return filesystem.FileItem.createFrom({
    path: '/Users/dev/notes.txt',
    name: 'notes.txt',
    size: 120,
    isDirectory: false,
    createdAt: 1_700_000_000_000,
    modifiedAt: 1_700_000_500_000,
    permissions: '-rw-r--r--',
    hidden: false,
    symlink: false,
    symlinkTarget: '',
    mimeType: 'text/plain',
    broken: false,
    tags: [],
    ...overrides,
  })
}

describe('toFsError', () => {
  it('decodes the fs-error envelope Go sends', () => {
    const raw = `fs-error:${JSON.stringify({
      code: 'permission-denied',
      path: '/Users/dev/Documents',
      message: 'open /Users/dev/Documents: operation not permitted',
    })}`

    const error = toFsError(new Error(raw))
    expect(error.code).toBe('permission-denied')
    expect(error.path).toBe('/Users/dev/Documents')
    expect(error.isPrivacyBlock).toBe(true)
  })

  it('accepts a bare string, since Wails may reject with one', () => {
    const raw = `fs-error:${JSON.stringify({ code: 'not-found', path: '/x', message: 'gone' })}`
    expect(toFsError(raw).code).toBe('not-found')
  })

  it('falls back to unknown for an unrecognised code', () => {
    const raw = `fs-error:${JSON.stringify({ code: 'wat', path: '', message: 'odd' })}`
    const error = toFsError(raw)
    expect(error.code).toBe('unknown')
    expect(error.message).toBe('odd')
  })

  it('does not throw on a malformed envelope', () => {
    const error = toFsError('fs-error:{not json')
    expect(error.code).toBe('unknown')
  })

  it('passes through an unprefixed error unchanged', () => {
    const error = toFsError(new Error('the binding blew up'))
    expect(error.code).toBe('unknown')
    expect(error.message).toBe('the binding blew up')
  })

  it('preserves the original throwable as the cause', () => {
    const original = new Error('boom')
    expect(toFsError(original).cause).toBe(original)
  })
})

describe('toFileItem', () => {
  it('derives the fields Go deliberately omits', () => {
    const item = toFileItem(wire({ name: 'Report.PDF', path: '/Users/dev/Report.PDF' }))
    expect(item.id).toBe('/Users/dev/Report.PDF')
    expect(item.extension).toBe('pdf')
    expect(item.category).toBe('document')
  })

  it('gives directories no extension and the folder category', () => {
    const item = toFileItem(
      wire({ name: 'my.folder', path: '/Users/dev/my.folder', isDirectory: true }),
    )
    expect(item.extension).toBe('')
    expect(item.category).toBe('folder')
  })

  it('omits symlinkTarget rather than setting it to empty string', () => {
    expect('symlinkTarget' in toFileItem(wire())).toBe(false)

    const link = toFileItem(wire({ symlink: true, symlinkTarget: '/Users/dev/real.txt' }))
    expect(link.symlinkTarget).toBe('/Users/dev/real.txt')
  })

  it('carries the broken flag through', () => {
    expect(toFileItem(wire({ broken: true })).broken).toBe(true)
  })

  it('categorises an unknown extension as default', () => {
    expect(toFileItem(wire({ name: 'thing.qqq' })).category).toBe('default')
  })
})
