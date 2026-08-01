import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetThumbnailRequests,
  evictOldThumbnails,
  getThumbnail,
  isRenderable,
} from './thumbCache'
import { bridge } from '@/services/bridge'
import { migrate } from '@/services/db/migrate'
import type { FileItem } from '@/types/file'

/** Seeded images, so the mock renderer has something real to answer about. */
const PHOTOS = '/Users/dev/Pictures/Wallpapers'

function item(name: string, overrides: Partial<FileItem> = {}): FileItem {
  const extension = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  return {
    id: `${PHOTOS}/${name}`,
    path: `${PHOTOS}/${name}`,
    name,
    extension,
    size: 1000,
    isDirectory: false,
    createdAt: 0,
    modifiedAt: 1000,
    permissions: '-rw-r--r--',
    hidden: false,
    symlink: false,
    mimeType: 'image/png',
    category: 'image',
    broken: false,
    ...overrides,
  }
}

beforeEach(async () => {
  vi.restoreAllMocks()
  __resetThumbnailRequests()
  await migrate()
})

describe('isRenderable', () => {
  it('accepts the formats the backend decodes', () => {
    for (const name of ['a.png', 'b.jpg', 'c.jpeg', 'd.gif']) {
      expect(isRenderable(item(name))).toBe(true)
    }
  })

  // Asking for a thumbnail of every text file in a folder is a lot of pointless
  // traffic for a guaranteed failure.
  it('rejects everything else, plus folders and broken entries', () => {
    expect(isRenderable(item('notes.txt'))).toBe(false)
    expect(isRenderable(item('photo.heic'))).toBe(false)
    expect(isRenderable(item('Work', { isDirectory: true, extension: '' }))).toBe(false)
    expect(isRenderable(item('gone.png', { broken: true }))).toBe(false)
  })
})

describe('getThumbnail', () => {
  it('renders once and serves the rest from the database', async () => {
    const generate = vi.spyOn(bridge.thumbs, 'generate')

    const first = await getThumbnail(item('abstract-fractal.png'))
    expect(first).toMatch(/^data:image\//)
    expect(generate).toHaveBeenCalledTimes(1)

    __resetThumbnailRequests()
    const second = await getThumbnail(item('abstract-fractal.png'))

    expect(second).toBe(first)
    // Still once: the second answer came from SQLite.
    expect(generate).toHaveBeenCalledTimes(1)
  })

  // An edited image invalidates its own thumbnail, with no sweep and no
  // watcher involvement.
  it('re-renders when the file has been modified since', async () => {
    const generate = vi.spyOn(bridge.thumbs, 'generate')

    await getThumbnail(item('abstract-fractal.png', { modifiedAt: 1000 }))
    __resetThumbnailRequests()
    await getThumbnail(item('abstract-fractal.png', { modifiedAt: 2000 }))

    expect(generate).toHaveBeenCalledTimes(2)
  })

  // An IntersectionObserver firing for forty tiles at once would otherwise
  // start forty identical renders before the first row landed.
  it('shares one render between concurrent requests', async () => {
    const generate = vi.spyOn(bridge.thumbs, 'generate')
    const target = item('abstract-fractal.png')

    const results = await Promise.all([
      getThumbnail(target),
      getThumbnail(target),
      getThumbnail(target),
    ])

    expect(generate).toHaveBeenCalledTimes(1)
    expect(new Set(results).size).toBe(1)
  })

  it('returns null rather than throwing when rendering fails', async () => {
    vi.spyOn(bridge.thumbs, 'generate').mockRejectedValueOnce(new Error('not an image'))
    expect(await getThumbnail(item('abstract-fractal.png'))).toBeNull()
  })

  it('does not ask at all for files it cannot render', async () => {
    const generate = vi.spyOn(bridge.thumbs, 'generate')
    expect(await getThumbnail(item('notes.txt'))).toBeNull()
    expect(generate).not.toHaveBeenCalled()
  })

  // A thumbnail that could not be stored is still a good thumbnail.
  it('still returns the image when the cache write fails', async () => {
    vi.spyOn(bridge.db, 'exec').mockRejectedValue(new Error('database is locked'))
    expect(await getThumbnail(item('abstract-fractal.png'))).toMatch(/^data:image\//)
  })
})

describe('evictOldThumbnails', () => {
  it('does nothing while the cache is small', async () => {
    await getThumbnail(item('abstract-fractal.png'))
    expect(await evictOldThumbnails()).toBe(0)
  })

  it('drops the oldest rows past the cap', async () => {
    // Writing 20_001 rows through the mock would be slow; the count is stubbed
    // and the delete is checked against the real database instead.
    vi.spyOn(bridge.db, 'query').mockResolvedValueOnce([{ total: 20_005 }] as never)
    const exec = vi.spyOn(bridge.db, 'exec')

    await evictOldThumbnails()

    expect(exec).toHaveBeenCalledOnce()
    const [sql, args] = exec.mock.calls[0] ?? []
    expect(sql).toMatch(/delete from thumbs/)
    // Only the excess, ordered oldest first.
    expect(args).toEqual([5])
    expect(sql).toMatch(/order by mtime asc/)
  })
})
