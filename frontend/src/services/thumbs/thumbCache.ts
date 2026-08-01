/**
 * The thumbnail cache (PLAN.md M10).
 *
 * Rendering is cheap once and expensive every time. A folder of photographs
 * scrolled twice should decode nothing the second time, and reopened next week
 * should still decode nothing — so the cache is SQLite, not memory.
 *
 * Freshness is keyed on the source file's mtime rather than invalidated by the
 * watcher. An edited image invalidates its own thumbnail the next time anyone
 * looks at it, with no sweep, no subscription, and no way for the two to drift.
 *
 * There is an in-memory layer as well, but only for de-duplicating in-flight
 * work: an IntersectionObserver firing for forty tiles at once would otherwise
 * start forty identical renders before the first row landed.
 */

import { bridge } from '@/services/bridge'
import type { FileItem } from '@/types/file'

/** The size grids ask for. One size keeps the cache from multiplying by view. */
export const THUMB_SIZE = 128

/** Formats the Go decoder handles — asking for anything else only fails. */
const RENDERABLE = new Set(['jpg', 'jpeg', 'png', 'gif'])

/**
 * Cap on cached rows. A Pictures library can hold a hundred thousand images,
 * and an unbounded cache would quietly grow a database larger than the photos.
 */
const MAX_ROWS = 20_000

/** In-flight renders, so concurrent requests for one file share a single one. */
const pending = new Map<string, Promise<string | null>>()

function key(path: string, size: number): string {
  return `${size}:${path}`
}

/** Whether it is worth asking for a thumbnail at all. */
export function isRenderable(item: FileItem): boolean {
  return !item.isDirectory && !item.broken && RENDERABLE.has(item.extension)
}

async function readCached(path: string, size: number, mtime: number): Promise<string | null> {
  const rows = await bridge.db.query<{ image: string; mtime: number }>(
    'select image, mtime from thumbs where path = ? and size = ?',
    [path, size],
  )
  const row = rows[0]
  if (!row) return null

  // A changed file invalidates its own thumbnail. The stale row is left for
  // the write below to replace rather than deleted separately.
  if (Number(row.mtime) !== mtime) return null
  return row.image
}

async function writeCached(
  path: string,
  size: number,
  mtime: number,
  image: string,
): Promise<void> {
  await bridge.db.exec(
    `insert into thumbs (path, size, mtime, image) values (?, ?, ?, ?)
     on conflict(path, size) do update set mtime = excluded.mtime, image = excluded.image`,
    [path, size, mtime, image],
  )
}

/**
 * Returns a `data:` URL for an item's thumbnail, or null when there is none.
 *
 * Null is an ordinary answer, not a failure: most files are not images, and a
 * render can fail for reasons the user does not need to hear about while
 * scrolling. The caller falls back to the file-type icon.
 */
export async function getThumbnail(
  item: FileItem,
  size: number = THUMB_SIZE,
): Promise<string | null> {
  if (!isRenderable(item)) return null

  const cacheKey = key(item.path, size)
  const inFlight = pending.get(cacheKey)
  if (inFlight) return inFlight

  const work = (async (): Promise<string | null> => {
    try {
      const cached = await readCached(item.path, size, item.modifiedAt)
      if (cached) return cached
    } catch {
      // A cache miss and a broken cache are the same thing here: render it.
    }

    let image: string
    try {
      image = await bridge.thumbs.generate(item.path, size)
    } catch {
      // Not every JPEG is a JPEG. Falling back to the icon is the answer.
      return null
    }

    try {
      await writeCached(item.path, size, item.modifiedAt, image)
    } catch {
      // The thumbnail is still good even if it could not be stored.
    }
    return image
  })().finally(() => pending.delete(cacheKey))

  pending.set(cacheKey, work)
  return work
}

/**
 * Drops the oldest rows once the cache passes its cap.
 *
 * Called at startup rather than on every write: the check is a count, the
 * deletion is rare, and doing it while the user scrolls would add a query to
 * the hot path to solve a problem that develops over months.
 */
export async function evictOldThumbnails(): Promise<number> {
  const rows = await bridge.db.query<{ total: number }>('select count(*) as total from thumbs')
  const total = Number(rows[0]?.total ?? 0)
  if (total <= MAX_ROWS) return 0

  const excess = total - MAX_ROWS
  const result = await bridge.db.exec(
    `delete from thumbs where rowid in (
       select rowid from thumbs order by mtime asc limit ?
     )`,
    [excess],
  )
  return result.rowsAffected
}

/** Test hook: forgets in-flight work between tests. */
export function __resetThumbnailRequests(): void {
  pending.clear()
}
