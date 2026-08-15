/**
 * Window session: which tabs were open, where each pane was, and the split
 * layout — restored on relaunch.
 *
 * Stored as a single JSON row. It is opaque state restored wholesale and never
 * queried by field, so normalising it would buy nothing and would couple the
 * schema to the shape of the workspace store.
 */

import {
  SPLIT_GRIDS,
  evenLayout,
  isSplitMode,
  paneCount,
  splitModeForPaneCount,
} from '@/constants/splitModes'
import { isViewMode } from '@/constants/viewModes'
import { bridge } from '@/services/bridge'
import { DEFAULT_SORT } from '@/services/filesystem/sort'
import type { Pane, PaneLayout, SplitMode, Tab } from '@/types/workspace'

export interface SessionSnapshot {
  tabs: Tab[]
  panes: Record<string, Pane>
  activeTabId: string | null
}

export async function saveSession(snapshot: SessionSnapshot, now: number): Promise<void> {
  await bridge.db.exec(
    `insert into sessions (id, payload, updated_at) values (1, ?, ?)
     on conflict (id) do update set payload = excluded.payload, updated_at = excluded.updated_at`,
    [JSON.stringify(snapshot), now],
  )
}

/**
 * Reads the stored session, validating hard.
 *
 * A malformed or stale snapshot must never prevent the app from opening — every
 * failure path returns null so the caller falls back to a fresh tab at home.
 */
export async function loadSession(): Promise<SessionSnapshot | null> {
  const rows = await bridge.db.query<{ payload: string }>(
    'select payload from sessions where id = 1',
  )
  const payload = rows[0]?.payload
  if (!payload) return null

  try {
    return parseSnapshot(JSON.parse(payload))
  } catch {
    return null
  }
}

export async function clearSession(): Promise<void> {
  await bridge.db.exec('delete from sessions where id = 1')
}

function parseSnapshot(value: unknown): SessionSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>

  if (!Array.isArray(record.tabs) || typeof record.panes !== 'object' || record.panes === null) {
    return null
  }

  const panes: Record<string, Pane> = {}
  for (const [id, raw] of Object.entries(record.panes as Record<string, unknown>)) {
    const pane = parsePane(id, raw)
    if (pane) panes[id] = pane
  }

  const tabs: Tab[] = []
  for (const raw of record.tabs) {
    const tab = parseTab(raw, panes)
    if (tab) tabs.push(tab)
  }

  if (tabs.length === 0) return null

  const activeTabId =
    typeof record.activeTabId === 'string' && tabs.some((tab) => tab.id === record.activeTabId)
      ? record.activeTabId
      : (tabs[0]?.id ?? null)

  return { tabs, panes, activeTabId }
}

function parsePane(id: string, raw: unknown): Pane | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (typeof record.path !== 'string' || !record.path) return null

  const history = Array.isArray(record.history)
    ? record.history.filter((entry): entry is string => typeof entry === 'string')
    : [record.path]

  const rawIndex =
    typeof record.historyIndex === 'number' ? record.historyIndex : history.length - 1
  const historyIndex = Math.min(Math.max(rawIndex, 0), Math.max(history.length - 1, 0))

  return {
    id,
    path: record.path,
    history: history.length > 0 ? history : [record.path],
    historyIndex,
    // Through the shared guard rather than a chain written out here: this was
    // the second of the two places a new view mode has to be taught about, and
    // the one that would have dropped a pane restored into Photos back to
    // Details without saying anything (PLAN.md §M13 decision 9).
    viewMode: isViewMode(record.viewMode) ? record.viewMode : 'details',
    sort: parseSort(record.sort),
  }
}

function parseSort(raw: unknown) {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SORT
  const record = raw as Record<string, unknown>

  const key = record.key
  const direction = record.direction
  return {
    key:
      key === 'modified' || key === 'size' || key === 'type' || key === 'name'
        ? key
        : DEFAULT_SORT.key,
    direction: direction === 'desc' ? ('desc' as const) : ('asc' as const),
    foldersFirst: record.foldersFirst !== false,
  }
}

/** Positive numbers only, renormalised to sum to 1, or null if unusable. */
function parseFractions(raw: unknown, expected: number): number[] | null {
  if (!Array.isArray(raw)) return null
  const values = raw.filter((size): size is number => typeof size === 'number' && size > 0)
  if (values.length !== expected) return null

  const total = values.reduce((sum, size) => sum + size, 0)
  if (total <= 0) return null
  return values.map((size) => size / total)
}

/**
 * The layout, from either shape a stored tab can be in.
 *
 * §M16 replaced `paneSizes: number[]` — a flat list along one axis — with a
 * grid, and a persisted *shape* change is harder than M13's persisted value
 * change: there is no guard that can turn four column fractions into a 2 × 2,
 * because the four numbers never meant anything on a second axis. So a
 * single-row mode is lifted as-is and an old four-column tab starts even.
 *
 * The other direction needs no code here and is worth stating: an older build
 * reading a tab written by this one finds no `paneSizes`, and its existing
 * "sizes must match the pane count, or use even ones" fallback already handles
 * that. A downgrade loses a dragged split, not the session.
 */
function parseLayout(record: Record<string, unknown>, mode: SplitMode): PaneLayout {
  const grid = SPLIT_GRIDS[mode]

  const stored = record.layout
  if (typeof stored === 'object' && stored !== null) {
    const layout = stored as Record<string, unknown>
    const columns = parseFractions(layout.columns, grid.columns)
    const rows = parseFractions(layout.rows, grid.rows)
    if (columns && rows) return { columns, rows }
  }

  // The pre-§M16 shape. It only means anything where the grid is one row deep.
  if (grid.rows === 1) {
    const columns = parseFractions(record.paneSizes, grid.columns)
    if (columns) return { columns, rows: [1] }
  }

  return evenLayout(mode)
}

function parseTab(raw: unknown, panes: Record<string, Pane>): Tab | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (typeof record.id !== 'string') return null

  // Drop pane ids with no surviving pane, or the layout would render gaps.
  const found = Array.isArray(record.paneIds)
    ? record.paneIds.filter((id): id is string => typeof id === 'string' && id in panes)
    : []
  if (found.length === 0) return null

  // The mode and the pane count have to agree, or the grid renders an empty
  // cell — or worse, a pane with no cell to sit in. A stored mode is only kept
  // when it holds exactly the panes that survived; otherwise the count wins,
  // because the panes are the thing with content in them.
  const stored = isSplitMode(record.splitMode) ? record.splitMode : null
  const splitMode =
    stored !== null && paneCount(stored) === found.length
      ? stored
      : splitModeForPaneCount(Math.min(found.length, 4))
  const paneIds = found.slice(0, paneCount(splitMode))

  const activePaneId =
    typeof record.activePaneId === 'string' && paneIds.includes(record.activePaneId)
      ? record.activePaneId
      : paneIds[0]
  if (!activePaneId) return null

  return { id: record.id, paneIds, activePaneId, splitMode, layout: parseLayout(record, splitMode) }
}
