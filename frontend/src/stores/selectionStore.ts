/**
 * Selection, keyed per pane — two panes each keep their own selection, and
 * closing a pane discards it.
 *
 * The set-based shape is already the multi-selection model; M4 adds the
 * Shift/Cmd interactions and marquee drag on top of it. M2/M3 only wire single
 * selection, but building the single-value version first would guarantee a
 * rewrite.
 */

import { create } from 'zustand'

interface PaneSelection {
  /** Selected paths. */
  selected: Set<string>
  /** Where a Shift-range starts (M4). */
  anchor: string | null
  /** Most recently touched item — the keyboard cursor (M4). */
  lead: string | null
}

const EMPTY: PaneSelection = { selected: new Set(), anchor: null, lead: null }

interface SelectionState {
  byPane: Record<string, PaneSelection>

  select: (paneId: string, path: string) => void
  clear: (paneId: string) => void
  selectAll: (paneId: string, paths: string[]) => void
  discardPane: (paneId: string) => void
}

export const useSelectionStore = create<SelectionState>()((set) => ({
  byPane: {},

  select: (paneId, path) =>
    set((state) => ({
      byPane: {
        ...state.byPane,
        [paneId]: { selected: new Set([path]), anchor: path, lead: path },
      },
    })),

  clear: (paneId) =>
    set((state) => ({
      byPane: { ...state.byPane, [paneId]: { selected: new Set(), anchor: null, lead: null } },
    })),

  selectAll: (paneId, paths) =>
    set((state) => ({
      byPane: {
        ...state.byPane,
        [paneId]: {
          selected: new Set(paths),
          anchor: paths[0] ?? null,
          lead: paths[paths.length - 1] ?? null,
        },
      },
    })),

  discardPane: (paneId) =>
    set((state) => {
      const byPane = { ...state.byPane }
      delete byPane[paneId]
      return { byPane }
    }),
}))

export function usePaneSelection(paneId: string): PaneSelection {
  return useSelectionStore((state) => state.byPane[paneId] ?? EMPTY)
}
