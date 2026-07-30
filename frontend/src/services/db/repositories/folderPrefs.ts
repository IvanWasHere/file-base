/**
 * Per-folder view mode and sort — the "this folder was left in Large Icons,
 * sorted by date" memory that Finder has.
 */

import { bridge } from '@/services/bridge'
import {
  DEFAULT_SORT,
  type SortDirection,
  type SortKey,
  type SortSpec,
} from '@/services/filesystem/sort'
import type { ViewMode } from '@/types/workspace'

export interface FolderPrefs {
  viewMode: ViewMode
  sort: SortSpec
}

interface FolderPrefsRow {
  path: string
  view_mode: string
  sort_key: string
  sort_dir: string
  folders_first: number
}

const VIEW_MODES: ViewMode[] = ['details', 'large-icons', 'medium-icons', 'small-icons']
const SORT_KEYS: SortKey[] = ['name', 'modified', 'size', 'type']

/**
 * Values are validated on the way out, not trusted. The database outlives any
 * given build, so a row written by an older version can hold a view mode this
 * one no longer has — falling back beats rendering nothing.
 */
function toPrefs(row: FolderPrefsRow): FolderPrefs {
  const viewMode = VIEW_MODES.includes(row.view_mode as ViewMode)
    ? (row.view_mode as ViewMode)
    : 'details'

  const key = SORT_KEYS.includes(row.sort_key as SortKey) ? (row.sort_key as SortKey) : 'name'
  const direction: SortDirection = row.sort_dir === 'desc' ? 'desc' : 'asc'

  return {
    viewMode,
    sort: { key, direction, foldersFirst: row.folders_first !== 0 },
  }
}

export async function getFolderPrefs(path: string): Promise<FolderPrefs | null> {
  const rows = await bridge.db.query<FolderPrefsRow>(
    'select path, view_mode, sort_key, sort_dir, folders_first from folder_prefs where path = ?',
    [path],
  )
  const row = rows[0]
  return row ? toPrefs(row) : null
}

/** Loads every stored preference at once, for warming the workspace at launch. */
export async function loadAllFolderPrefs(): Promise<Map<string, FolderPrefs>> {
  const rows = await bridge.db.query<FolderPrefsRow>(
    'select path, view_mode, sort_key, sort_dir, folders_first from folder_prefs',
  )
  return new Map(rows.map((row) => [row.path, toPrefs(row)]))
}

export async function saveFolderPrefs(
  path: string,
  viewMode: ViewMode,
  sort: SortSpec = DEFAULT_SORT,
): Promise<void> {
  await bridge.db.exec(
    `insert into folder_prefs (path, view_mode, sort_key, sort_dir, folders_first)
     values (?, ?, ?, ?, ?)
     on conflict (path) do update set
       view_mode = excluded.view_mode,
       sort_key = excluded.sort_key,
       sort_dir = excluded.sort_dir,
       folders_first = excluded.folders_first`,
    [path, viewMode, sort.key, sort.direction, sort.foldersFirst ? 1 : 0],
  )
}

export async function forgetFolderPrefs(path: string): Promise<void> {
  await bridge.db.exec('delete from folder_prefs where path = ?', [path])
}
