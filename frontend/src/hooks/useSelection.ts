import { useCallback, useMemo } from 'react'
import { usePaneSelection, useSelectionStore } from '@/stores/selectionStore'
import type { FileItem } from '@/types/file'

/**
 * Turns a pointer event's modifier keys into the right selection action, once,
 * for every view. Details and the three icon grids share this so their
 * behaviour cannot drift apart.
 *
 * Conventions follow Finder: Cmd toggles one item, Shift selects the range from
 * the anchor, a plain click replaces the selection.
 */
export function useSelection(paneId: string, items: readonly FileItem[]) {
  const { selected, anchor, lead } = usePaneSelection(paneId)

  const select = useSelectionStore((state) => state.select)
  const toggle = useSelectionStore((state) => state.toggle)
  const extendTo = useSelectionStore((state) => state.extendTo)
  const selectAll = useSelectionStore((state) => state.selectAll)
  const clear = useSelectionStore((state) => state.clear)
  const setSelection = useSelectionStore((state) => state.setSelection)

  /** Display order — what a Shift-range spans. */
  const ordered = useMemo(() => items.map((item) => item.path), [items])

  const handlePointerSelect = useCallback(
    (item: FileItem, event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
      if (event.shiftKey) {
        extendTo(paneId, item.path, ordered)
        return
      }
      // ctrlKey as well as metaKey: Ctrl-click also raises the context menu on
      // macOS, but treating it as a toggle keeps external keyboards usable.
      if (event.metaKey || event.ctrlKey) {
        toggle(paneId, item.path)
        return
      }
      select(paneId, item.path)
    },
    [paneId, ordered, extendTo, toggle, select],
  )

  return {
    selected,
    anchor,
    lead,
    ordered,
    handlePointerSelect,
    select: useCallback((path: string) => select(paneId, path), [select, paneId]),
    extendTo: useCallback(
      (path: string) => extendTo(paneId, path, ordered),
      [extendTo, paneId, ordered],
    ),
    selectAll: useCallback(() => selectAll(paneId, ordered), [selectAll, paneId, ordered]),
    clear: useCallback(() => clear(paneId), [clear, paneId]),
    setSelection: useCallback(
      (paths: readonly string[], nextLead?: string | null) => setSelection(paneId, paths, nextLead),
      [setSelection, paneId],
    ),
  }
}
