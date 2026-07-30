/**
 * Window session: which tabs were open, where each pane was, and the split
 * layout — restored on relaunch.
 *
 * Stored as a single JSON row. It is opaque state restored wholesale and never
 * queried by field, so normalising it would buy nothing and would couple the
 * schema to the shape of the workspace store.
 */

import { bridge } from '@/services/bridge'
import { DEFAULT_SORT } from '@/services/filesystem/sort'
import type { Pane, SplitMode, Tab } from '@/types/workspace'

export interface SessionSnapshot {
  tabs: Tab[]
  panes: Record<string, Pane>
  activeTabId: string | null
}

const SPLIT_MODES: SplitMode[] = [1, 2, 3, 4]

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
    viewMode:
      record.viewMode === 'large-icons' ||
      record.viewMode === 'medium-icons' ||
      record.viewMode === 'small-icons'
        ? record.viewMode
        : 'details',
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

function parseTab(raw: unknown, panes: Record<string, Pane>): Tab | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (typeof record.id !== 'string') return null

  // Drop pane ids with no surviving pane, or the layout would render gaps.
  const paneIds = Array.isArray(record.paneIds)
    ? record.paneIds.filter((id): id is string => typeof id === 'string' && id in panes)
    : []
  if (paneIds.length === 0) return null

  const activePaneId =
    typeof record.activePaneId === 'string' && paneIds.includes(record.activePaneId)
      ? record.activePaneId
      : paneIds[0]
  if (!activePaneId) return null

  const splitMode = SPLIT_MODES.includes(record.splitMode as SplitMode)
    ? (record.splitMode as SplitMode)
    : (Math.min(paneIds.length, 4) as SplitMode)

  // Sizes must match the pane count and sum to 1, or flexGrow misbehaves.
  const rawSizes = Array.isArray(record.paneSizes)
    ? record.paneSizes.filter((size): size is number => typeof size === 'number' && size > 0)
    : []
  const total = rawSizes.reduce((sum, size) => sum + size, 0)
  const paneSizes =
    rawSizes.length === paneIds.length && total > 0
      ? rawSizes.map((size) => size / total)
      : paneIds.map(() => 1 / paneIds.length)

  return { id: record.id, paneIds, activePaneId, splitMode, paneSizes }
}
