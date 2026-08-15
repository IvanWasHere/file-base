/**
 * Connects the stores to SQLite.
 *
 * Two rules keep this from becoming a tangle:
 *
 *  1. Nothing here runs during render. Hydration happens once at startup, and
 *     writes happen in store subscriptions.
 *  2. Writes are debounced and fire-and-forget. Persistence is a side effect of
 *     using the app; a failed write must never block or break the UI, so it is
 *     logged and dropped rather than surfaced.
 */

import { migrate } from './migrate'
import { loadSettings, saveSettings, type AppSettings } from './repositories/settings'
import { loadAllFolderPrefs, saveFolderPrefs, type FolderPrefs } from './repositories/folderPrefs'
import { recordVisit } from './repositories/recents'
import { loadSession, saveSession } from './repositories/session'
import { evictOldThumbnails } from '@/services/thumbs/thumbCache'
import { useUiStore } from '@/stores/uiStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

const SESSION_DEBOUNCE_MS = 500
const PREFS_DEBOUNCE_MS = 300

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: T) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

/** Persistence failures are logged, never thrown at the UI. */
function detach(promise: Promise<unknown>, what: string): void {
  void promise.catch((error: unknown) => {
    console.warn(`[db] ${what} failed:`, error)
  })
}

/**
 * Folder preferences, loaded once at startup and kept in memory, so navigating
 * into a folder applies its remembered view instantly rather than after a query.
 */
let folderPrefs = new Map<string, FolderPrefs>()

export interface HydrationResult {
  settings: AppSettings
  restoredSession: boolean
}

/**
 * Runs migrations and loads persisted state into the stores.
 *
 * `homePath` is the fallback when there is no session to restore.
 */
export async function hydrate(homePath: string): Promise<HydrationResult> {
  await migrate()

  const settings = await loadSettings()
  useUiStore.setState({
    showHiddenFiles: settings.showHiddenFiles,
    sidebarOpen: settings.sidebarOpen,
    previewOpen: settings.previewOpen,
    theme: settings.theme,
    columnLayout: settings.columnLayout,
    hashAlgorithm: settings.hashAlgorithm,
    lastTemplate: settings.lastTemplate,
  })

  folderPrefs = await loadAllFolderPrefs()

  // Trimming the thumbnail cache once at startup rather than on every write:
  // the check is a count, the deletion is rare, and doing it while the user
  // scrolls would put a query on the hot path to solve a problem that develops
  // over months.
  detach(evictOldThumbnails(), 'thumbnail cache eviction')

  const session = await loadSession()
  if (session) {
    useWorkspaceStore.getState().restore(session)
  } else {
    useWorkspaceStore.getState().initialize(homePath)
  }

  return { settings, restoredSession: session !== null }
}

/**
 * Starts persisting store changes. Returns a teardown function.
 *
 * `now` is injected rather than read from the clock inline so tests stay
 * deterministic.
 */
export function startPersistence(now: () => number = Date.now): () => void {
  const persistSession = debounce(() => {
    const { tabs, panes, activeTabId } = useWorkspaceStore.getState()
    if (tabs.length === 0) return
    detach(saveSession({ tabs, panes, activeTabId }, now()), 'session save')
  }, SESSION_DEBOUNCE_MS)

  const persistPrefs = debounce((paneId: string) => {
    const pane = useWorkspaceStore.getState().panes[paneId]
    if (!pane) return
    const prefs: FolderPrefs = { viewMode: pane.viewMode, sort: pane.sort }
    folderPrefs.set(pane.path, prefs)
    detach(saveFolderPrefs(pane.path, pane.viewMode, pane.sort), 'folder prefs save')
  }, PREFS_DEBOUNCE_MS)

  const visited = new Set<string>()
  /** Paths whose prefs were just applied, so the write-back is not re-triggered. */
  const justApplied = new Set<string>()

  const unsubscribeWorkspace = useWorkspaceStore.subscribe((state, previous) => {
    persistSession()

    for (const pane of Object.values(state.panes)) {
      const before = previous.panes[pane.id]
      const arrived = !before || before.path !== pane.path

      if (arrived) {
        if (!visited.has(pane.path)) {
          visited.add(pane.path)
          detach(recordVisit(pane.path, now()), 'recent visit')
        }

        // Restore how this folder was last viewed.
        const remembered = folderPrefs.get(pane.path)
        if (remembered) {
          const store = useWorkspaceStore.getState()
          if (remembered.viewMode !== pane.viewMode || remembered.sort !== pane.sort) {
            justApplied.add(pane.path)
            store.setViewMode(pane.id, remembered.viewMode)
            store.setSort(pane.id, remembered.sort)
          }
        }
        continue
      }

      const changed = before.viewMode !== pane.viewMode || before.sort !== pane.sort
      if (!changed) continue

      // Writing back what we just restored would be a pointless round trip.
      if (justApplied.has(pane.path)) {
        justApplied.delete(pane.path)
        folderPrefs.set(pane.path, { viewMode: pane.viewMode, sort: pane.sort })
        continue
      }

      persistPrefs(pane.id)
    }
  })

  const unsubscribeUi = useUiStore.subscribe((state, previous) => {
    const changed: Partial<AppSettings> = {}
    if (state.showHiddenFiles !== previous.showHiddenFiles) {
      changed.showHiddenFiles = state.showHiddenFiles
    }
    if (state.sidebarOpen !== previous.sidebarOpen) changed.sidebarOpen = state.sidebarOpen
    if (state.previewOpen !== previous.previewOpen) changed.previewOpen = state.previewOpen
    if (state.theme !== previous.theme) changed.theme = state.theme
    // Reference comparison is enough because the store replaces the layout
    // wholesale; a mutated one would be missed here and by React alike.
    if (state.columnLayout !== previous.columnLayout) changed.columnLayout = state.columnLayout
    if (state.hashAlgorithm !== previous.hashAlgorithm) changed.hashAlgorithm = state.hashAlgorithm
    if (state.lastTemplate !== previous.lastTemplate) changed.lastTemplate = state.lastTemplate

    if (Object.keys(changed).length > 0) detach(saveSettings(changed), 'settings save')
  })

  return () => {
    unsubscribeWorkspace()
    unsubscribeUi()
  }
}

/** Test hook: clears the in-memory folder-preference cache. */
export function __resetFolderPrefsCache(): void {
  folderPrefs = new Map()
}
