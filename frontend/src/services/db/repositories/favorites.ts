/**
 * User-pinned locations for the sidebar. Distinct from the built-in Quick
 * Access entries, which come from the OS via `StandardPaths`.
 */

import { bridge } from '@/services/bridge'
import { basename } from '@/utils/path'

export interface Favorite {
  id: number
  path: string
  label: string
  icon: string | null
  sortOrder: number
}

interface FavoriteRow {
  id: number
  path: string
  label: string
  icon: string | null
  sort_order: number
}

const toFavorite = (row: FavoriteRow): Favorite => ({
  id: row.id,
  path: row.path,
  label: row.label,
  icon: row.icon,
  sortOrder: row.sort_order,
})

export async function listFavorites(): Promise<Favorite[]> {
  const rows = await bridge.db.query<FavoriteRow>(
    'select id, path, label, icon, sort_order from favorites order by sort_order, label',
  )
  return rows.map(toFavorite)
}

/**
 * Adds a favorite, or leaves the existing one untouched if the path is already
 * pinned — pinning twice is a no-op, not an error the UI has to handle.
 */
export async function addFavorite(path: string, label?: string): Promise<void> {
  const rows = await bridge.db.query<{ next: number }>(
    'select coalesce(max(sort_order), -1) + 1 as next from favorites',
  )
  const sortOrder = Number(rows[0]?.next ?? 0)

  await bridge.db.exec(
    'insert into favorites (path, label, sort_order) values (?, ?, ?) on conflict (path) do nothing',
    [path, label ?? basename(path), sortOrder],
  )
}

export async function removeFavorite(path: string): Promise<void> {
  await bridge.db.exec('delete from favorites where path = ?', [path])
}

export async function renameFavorite(path: string, label: string): Promise<void> {
  await bridge.db.exec('update favorites set label = ? where path = ?', [label, path])
}

/** Persists a drag-reorder as one transaction, so order can never half-apply. */
export async function reorderFavorites(pathsInOrder: string[]): Promise<void> {
  if (pathsInOrder.length === 0) return

  await bridge.db.transaction(
    pathsInOrder.map((path, index) => ({
      sql: 'update favorites set sort_order = ? where path = ?',
      args: [index, path],
    })),
  )
}

export async function isFavorite(path: string): Promise<boolean> {
  const rows = await bridge.db.query('select 1 from favorites where path = ?', [path])
  return rows.length > 0
}
