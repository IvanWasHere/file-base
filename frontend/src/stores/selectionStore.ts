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

  /**
   * Drops paths from every pane's selection, after a trash or delete.
   *
   * Pane-agnostic because two panes can show the same folder, and a selection
   * that outlives its item makes the status bar count rows nobody can see.
   */
  forgetPaths: (paths: readonly string[]) => void
  /** Follows an item through a rename so it stays selected under its new name. */
  replacePath: (from: string, to: string) => void
}

/** Rewrites one pane's selection, dropping the entry if nothing changed. */
function remap(
  selection: PaneSelection,
  change: (path: string) => string | null,
): PaneSelection | null {
  const selected = new Set<string>()
  let changed = false

  for (const path of selection.selected) {
    const next = change(path)
    if (next === null) {
      changed = true
      continue
    }
    if (next !== path) changed = true
    selected.add(next)
  }

  const anchor = selection.anchor === null ? null : change(selection.anchor)
  const lead = selection.lead === null ? null : change(selection.lead)
  if (!changed && anchor === selection.anchor && lead === selection.lead) return null

  return { selected, anchor, lead }
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

  forgetPaths: (paths) =>
    set((state) => {
      const gone = new Set(paths)
      return applyRemap(state, (path) => (gone.has(path) ? null : path))
    }),

  replacePath: (from, to) =>
    set((state) => applyRemap(state, (path) => (path === from ? to : path))),
}))

/**
 * Applies a path remapping to every pane, returning an unchanged `byPane` when
 * nothing matched — a fresh object would re-render every pane for an operation
 * that touched none of them.
 */
function applyRemap(
  state: SelectionState,
  change: (path: string) => string | null,
): Pick<SelectionState, 'byPane'> {
  let byPane = state.byPane
  let mutated = false

  for (const [paneId, selection] of Object.entries(state.byPane)) {
    const next = remap(selection, change)
    if (!next) continue
    if (!mutated) {
      byPane = { ...state.byPane }
      mutated = true
    }
    byPane[paneId] = next
  }

  return { byPane }
}

export function usePaneSelection(paneId: string): PaneSelection {
  return useSelectionStore((state) => state.byPane[paneId] ?? EMPTY)
}
