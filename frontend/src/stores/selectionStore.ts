/**
 * Selection, keyed per pane — two panes each keep their own selection, and
 * closing a pane discards it.
 *
 * `anchor` is where a Shift-range starts; `lead` is the keyboard cursor. They
 * diverge: Shift+Arrow moves the lead while the anchor stays put, which is what
 * makes a range grow and shrink from one end.
 */

import { create } from 'zustand'
import { rangeBetween } from '@/utils/selection'

interface PaneSelection {
  selected: Set<string>
  anchor: string | null
  lead: string | null
}

const EMPTY: PaneSelection = { selected: new Set(), anchor: null, lead: null }

interface SelectionState {
  byPane: Record<string, PaneSelection>

  /** Replace the selection with a single item; resets anchor and lead to it. */
  select: (paneId: string, path: string) => void
  /** Cmd-click: add or remove one item, leaving the rest alone. */
  toggle: (paneId: string, path: string) => void
  /** Shift-click / Shift+Arrow: select the range from the anchor to `path`. */
  extendTo: (paneId: string, path: string, ordered: readonly string[]) => void
  /** Marquee drag result. */
  setSelection: (paneId: string, paths: readonly string[], lead?: string | null) => void
  selectAll: (paneId: string, paths: readonly string[]) => void
  clear: (paneId: string) => void
  discardPane: (paneId: string) => void
}

function update(
  state: SelectionState,
  paneId: string,
  next: PaneSelection,
): Pick<SelectionState, 'byPane'> {
  return { byPane: { ...state.byPane, [paneId]: next } }
}

export const useSelectionStore = create<SelectionState>()((set) => ({
  byPane: {},

  select: (paneId, path) =>
    set((state) => update(state, paneId, { selected: new Set([path]), anchor: path, lead: path })),

  toggle: (paneId, path) =>
    set((state) => {
      const current = state.byPane[paneId] ?? EMPTY
      const selected = new Set(current.selected)

      if (selected.has(path)) {
        selected.delete(path)
        // Deselecting the anchor would strand a later Shift-click, so move the
        // anchor to whatever is still selected.
        const fallback = selected.size > 0 ? ([...selected].at(-1) ?? null) : null
        return update(state, paneId, { selected, anchor: fallback, lead: fallback })
      }

      selected.add(path)
      return update(state, paneId, { selected, anchor: path, lead: path })
    }),

  extendTo: (paneId, path, ordered) =>
    set((state) => {
      const current = state.byPane[paneId] ?? EMPTY
      const anchor = current.anchor ?? path
      const range = rangeBetween(ordered, anchor, path)
      // The anchor is preserved so the range can be re-dragged from the same end.
      return update(state, paneId, { selected: new Set(range), anchor, lead: path })
    }),

  setSelection: (paneId, paths, lead = null) =>
    set((state) => {
      const current = state.byPane[paneId] ?? EMPTY
      return update(state, paneId, {
        selected: new Set(paths),
        anchor: current.anchor ?? paths[0] ?? null,
        lead: lead ?? current.lead,
      })
    }),

  selectAll: (paneId, paths) =>
    set((state) =>
      update(state, paneId, {
        selected: new Set(paths),
        anchor: paths[0] ?? null,
        lead: paths.at(-1) ?? null,
      }),
    ),

  clear: (paneId) =>
    set((state) => update(state, paneId, { selected: new Set(), anchor: null, lead: null })),

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
