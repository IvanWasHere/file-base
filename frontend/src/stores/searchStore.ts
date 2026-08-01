/**
 * Per-pane search state (PLAN.md §1).
 *
 * Keyed by pane, like selection: two split panes can be searching different
 * things at once, and closing a pane discards its search.
 *
 * Results live here rather than in React Query because a search is not a
 * cacheable read of a stable key — it is a stream that arrives in pieces, can
 * be cancelled, and is invalidated by the next keystroke. React Query holds
 * *what is at a path*; this holds *what a question found*.
 */

import { create } from 'zustand'
import { DEFAULT_FILTERS, type SearchFilters } from '@/services/search/criteria'
import type { FileItem } from '@/types/file'

/** Where a search looks. */
export type SearchScope = 'folder' | 'recursive'

export type SearchStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error'

export interface PaneSearch {
  /** Whether the search bar is open at all. */
  open: boolean
  query: string
  scope: SearchScope
  filters: SearchFilters
  status: SearchStatus
  /** Recursive results only; folder scope filters the cached listing instead. */
  results: FileItem[]
  scanned: number
  matched: number
  truncated: boolean
  /** True when the results came from the FTS5 index rather than a fresh walk. */
  fromIndex: boolean
  /** The backend search this pane is currently listening for. */
  activeId: string | null
  /** The folder the running search started from. */
  root: string
  message: string
}

const EMPTY: PaneSearch = {
  open: false,
  query: '',
  scope: 'folder',
  filters: DEFAULT_FILTERS,
  status: 'idle',
  results: [],
  scanned: 0,
  matched: 0,
  truncated: false,
  fromIndex: false,
  activeId: null,
  root: '',
  message: '',
}

interface SearchState {
  byPane: Record<string, PaneSearch>

  open: (paneId: string) => void
  close: (paneId: string) => void
  setQuery: (paneId: string, query: string) => void
  setScope: (paneId: string, scope: SearchScope) => void
  setFilters: (paneId: string, filters: SearchFilters) => void

  /** Marks a recursive search as started, clearing whatever the last one found. */
  begin: (paneId: string, id: string, root: string, fromIndex: boolean) => void
  /** Appends a streamed batch, ignoring batches from superseded searches. */
  append: (paneId: string, id: string, items: readonly FileItem[], scanned: number) => void
  finish: (
    paneId: string,
    id: string,
    outcome: { status: SearchStatus; matched: number; truncated: boolean; message?: string },
  ) => void

  discardPane: (paneId: string) => void
}

function patch(
  state: SearchState,
  paneId: string,
  changes: Partial<PaneSearch>,
): Pick<SearchState, 'byPane'> {
  const current = state.byPane[paneId] ?? EMPTY
  return { byPane: { ...state.byPane, [paneId]: { ...current, ...changes } } }
}

export const useSearchStore = create<SearchState>()((set) => ({
  byPane: {},

  open: (paneId) => set((state) => patch(state, paneId, { open: true })),

  // Closing clears the query as well as the results: reopening the bar with a
  // stale query would silently re-run a search the user has moved on from.
  close: (paneId) =>
    set((state) =>
      patch(state, paneId, {
        ...EMPTY,
        // Filters and scope are preferences and survive; the question does not.
        filters: state.byPane[paneId]?.filters ?? DEFAULT_FILTERS,
        scope: state.byPane[paneId]?.scope ?? 'folder',
      }),
    ),

  setQuery: (paneId, query) => set((state) => patch(state, paneId, { query })),
  setScope: (paneId, scope) =>
    // Results belong to the scope that produced them.
    set((state) => patch(state, paneId, { scope, results: [], status: 'idle', activeId: null })),
  setFilters: (paneId, filters) => set((state) => patch(state, paneId, { filters })),

  begin: (paneId, id, root, fromIndex) =>
    set((state) =>
      patch(state, paneId, {
        activeId: id,
        root,
        fromIndex,
        status: 'running',
        results: [],
        scanned: 0,
        matched: 0,
        truncated: false,
        message: '',
      }),
    ),

  append: (paneId, id, items, scanned) =>
    set((state) => {
      const current = state.byPane[paneId]
      // A batch from a search the user has already replaced must not be shown;
      // the walk is still winding down when the next keystroke starts one.
      if (!current || current.activeId !== id) return { byPane: state.byPane }
      return patch(state, paneId, { results: [...current.results, ...items], scanned })
    }),

  finish: (paneId, id, outcome) =>
    set((state) => {
      const current = state.byPane[paneId]
      if (!current || current.activeId !== id) return { byPane: state.byPane }
      return patch(state, paneId, {
        status: outcome.status,
        matched: outcome.matched,
        truncated: outcome.truncated,
        message: outcome.message ?? '',
        activeId: null,
      })
    }),

  discardPane: (paneId) =>
    set((state) => {
      const byPane = { ...state.byPane }
      delete byPane[paneId]
      return { byPane }
    }),
}))

export function usePaneSearch(paneId: string): PaneSearch {
  return useSearchStore((state) => state.byPane[paneId] ?? EMPTY)
}

export { EMPTY as EMPTY_SEARCH }
