/**
 * The single source of truth for tabs, panes and navigation (PLAN.md §1).
 *
 * This store deliberately merges the PRD's suggested ExplorerStore and
 * NavigationStore: once panes exist, per-pane navigation *is* the explorer
 * state, and splitting them across two stores creates a sync problem with no
 * upside.
 *
 * What is NOT here: directory contents. Those live in the React Query cache,
 * keyed by path, so two panes on the same folder share one read.
 */

import { create } from 'zustand'
import { evenLayout, paneCount } from '@/constants/splitModes'
import { DEFAULT_SORT, type SortSpec } from '@/services/filesystem/sort'
import type { Pane, PaneLayout, SplitMode, Tab, ViewMode } from '@/types/workspace'
import { dirname, normalize } from '@/utils/path'

/** Monotonic ids. A counter rather than random so tests stay deterministic. */
let counter = 0
const nextId = (prefix: string): string => `${prefix}-${++counter}`

/** Test-only: reset ids so snapshots do not drift between runs. */
export function __resetIdCounter(): void {
  counter = 0
}

/**
 * Moves the counter past every id in a restored session.
 *
 * Without this, a relaunch starts counting from 1 again and the next new tab
 * would collide with a restored one — React keys would clash and the wrong pane
 * would receive navigation.
 */
function adoptIds(ids: string[]): void {
  for (const id of ids) {
    const suffix = Number(id.slice(id.lastIndexOf('-') + 1))
    if (Number.isFinite(suffix) && suffix > counter) counter = suffix
  }
}

function createPane(path: string): Pane {
  return {
    id: nextId('pane'),
    path: normalize(path),
    history: [normalize(path)],
    historyIndex: 0,
    viewMode: 'details',
    sort: DEFAULT_SORT,
  }
}

interface WorkspaceState {
  tabs: Tab[]
  panes: Record<string, Pane>
  activeTabId: string | null

  /** Creates the first tab. Idempotent, so React StrictMode double-invoke is safe. */
  initialize: (homePath: string) => void
  /** Installs a session restored from SQLite (M5). */
  restore: (snapshot: {
    tabs: Tab[]
    panes: Record<string, Pane>
    activeTabId: string | null
  }) => void

  openTab: (path: string) => string
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void

  setActivePane: (tabId: string, paneId: string) => void
  setSplitMode: (tabId: string, mode: SplitMode) => void
  setLayout: (tabId: string, layout: PaneLayout) => void

  navigate: (paneId: string, path: string) => void
  goBack: (paneId: string) => void
  goForward: (paneId: string) => void
  goUp: (paneId: string) => void

  setViewMode: (paneId: string, mode: ViewMode) => void
  setSort: (paneId: string, sort: SortSpec) => void
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  tabs: [],
  panes: {},
  activeTabId: null,

  initialize: (homePath) => {
    if (get().tabs.length > 0) return
    get().openTab(homePath)
  },

  restore: (snapshot) => {
    // Advance the counter past restored ids before anything can mint a new one.
    adoptIds([...Object.keys(snapshot.panes), ...snapshot.tabs.map((tab) => tab.id)])
    set({
      tabs: snapshot.tabs,
      panes: snapshot.panes,
      activeTabId: snapshot.activeTabId ?? snapshot.tabs[0]?.id ?? null,
    })
  },

  openTab: (path) => {
    const pane = createPane(path)
    const tab: Tab = {
      id: nextId('tab'),
      paneIds: [pane.id],
      activePaneId: pane.id,
      splitMode: 'single',
      layout: evenLayout('single'),
    }
    set((state) => ({
      tabs: [...state.tabs, tab],
      panes: { ...state.panes, [pane.id]: pane },
      activeTabId: tab.id,
    }))
    return tab.id
  },

  closeTab: (tabId) => {
    const { tabs, panes, activeTabId } = get()
    const index = tabs.findIndex((tab) => tab.id === tabId)
    if (index === -1) return

    const closing = tabs[index]
    if (!closing) return

    const remainingPanes = { ...panes }
    for (const paneId of closing.paneIds) delete remainingPanes[paneId]

    const remaining = tabs.filter((tab) => tab.id !== tabId)

    // Closing the last tab would leave nothing to render, so reopen at the
    // closed tab's location — the mockup did the same.
    if (remaining.length === 0) {
      const fallbackPath = panes[closing.activePaneId]?.path ?? '/'
      set({ tabs: [], panes: {}, activeTabId: null })
      get().openTab(fallbackPath)
      return
    }

    set({
      tabs: remaining,
      panes: remainingPanes,
      activeTabId:
        activeTabId === tabId
          ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? null)
          : activeTabId,
    })
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  setActivePane: (tabId, paneId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId && tab.paneIds.includes(paneId) ? { ...tab, activePaneId: paneId } : tab,
      ),
    })),

  setSplitMode: (tabId, mode) => {
    const { tabs, panes } = get()
    const tab = tabs.find((candidate) => candidate.id === tabId)
    if (!tab || tab.splitMode === mode) return

    // How many panes the mode holds comes from its grid, not from the mode's
    // own number. They agree today for all four; asking the grid is what keeps
    // them agreeing when a 3 × 2 is added.
    const wanted = paneCount(mode)
    const current = tab.paneIds.length
    const nextPanes = { ...panes }
    let paneIds = [...tab.paneIds]

    if (wanted > current) {
      // New panes open at the active pane's location, which is what makes
      // "split to compare" useful — you get two views of where you already are.
      const source = panes[tab.activePaneId]
      for (let index = current; index < wanted; index += 1) {
        const pane = createPane(source?.path ?? '/')
        nextPanes[pane.id] = pane
        paneIds.push(pane.id)
      }
    } else {
      for (const paneId of paneIds.slice(wanted)) delete nextPanes[paneId]
      paneIds = paneIds.slice(0, wanted)
    }

    set({
      panes: nextPanes,
      tabs: tabs.map((candidate) =>
        candidate.id === tabId
          ? {
              ...candidate,
              splitMode: mode,
              paneIds,
              // Sizes reset on every mode change. Restoring a 20/20/60 split
              // someone set up for three columns, into two, is not obviously a
              // kindness — and remembering one layout per mode is more state
              // than the feature earns (§M16 decision 10).
              layout: evenLayout(mode),
              activePaneId: paneIds.includes(candidate.activePaneId)
                ? candidate.activePaneId
                : (paneIds[0] ?? candidate.activePaneId),
            }
          : candidate,
      ),
    })
  },

  setLayout: (tabId, layout) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, layout } : tab)),
    })),

  navigate: (paneId, path) =>
    set((state) => {
      const pane = state.panes[paneId]
      const target = normalize(path)
      if (!pane || pane.path === target) return state

      // Navigating after going back truncates the forward entries, matching
      // browser and Finder behaviour.
      const history = [...pane.history.slice(0, pane.historyIndex + 1), target]
      return {
        panes: {
          ...state.panes,
          [paneId]: { ...pane, path: target, history, historyIndex: history.length - 1 },
        },
      }
    }),

  goBack: (paneId) =>
    set((state) => {
      const pane = state.panes[paneId]
      if (!pane || pane.historyIndex === 0) return state
      const index = pane.historyIndex - 1
      const path = pane.history[index]
      if (path === undefined) return state
      return { panes: { ...state.panes, [paneId]: { ...pane, path, historyIndex: index } } }
    }),

  goForward: (paneId) =>
    set((state) => {
      const pane = state.panes[paneId]
      if (!pane || pane.historyIndex >= pane.history.length - 1) return state
      const index = pane.historyIndex + 1
      const path = pane.history[index]
      if (path === undefined) return state
      return { panes: { ...state.panes, [paneId]: { ...pane, path, historyIndex: index } } }
    }),

  goUp: (paneId) => {
    const pane = get().panes[paneId]
    if (!pane) return
    const parent = dirname(pane.path)
    if (parent !== pane.path) get().navigate(paneId, parent)
  },

  setViewMode: (paneId, mode) =>
    set((state) => {
      const pane = state.panes[paneId]
      if (!pane) return state
      return { panes: { ...state.panes, [paneId]: { ...pane, viewMode: mode } } }
    }),

  setSort: (paneId, sort) =>
    set((state) => {
      const pane = state.panes[paneId]
      if (!pane) return state
      return { panes: { ...state.panes, [paneId]: { ...pane, sort } } }
    }),
}))

/* ---------- selectors ---------- */

export const canGoBack = (pane: Pane | undefined): boolean => !!pane && pane.historyIndex > 0

export const canGoForward = (pane: Pane | undefined): boolean =>
  !!pane && pane.historyIndex < pane.history.length - 1

export const canGoUp = (pane: Pane | undefined): boolean =>
  !!pane && dirname(pane.path) !== pane.path

export function useActiveTab(): Tab | undefined {
  return useWorkspaceStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId))
}

export function useActivePane(): Pane | undefined {
  return useWorkspaceStore((state) => {
    const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
    return tab ? state.panes[tab.activePaneId] : undefined
  })
}
