import { useCallback } from 'react'
import type { ContextKind } from '@/constants/contextMenus'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import type { FileItem } from '@/types/file'

/**
 * The right-click handler shared by every view.
 *
 * Lives on the scroll container rather than on rows, for the same reason the M9
 * drop handling does: a virtualized list recreates its rows constantly, and
 * hit-testing `data-file-path` with `closest` costs nothing per row.
 *
 * Right-clicking an item that is not selected selects it first, as Finder does.
 * That is what lets every context-menu command read the selection like any other
 * route into `useMenuCommands` — no menu-specific target has to be threaded
 * through. Right-clicking *inside* an existing multi-selection leaves it alone,
 * so "Move to Trash" acts on all six files rather than the one under the cursor.
 */
export function useContextMenu(paneId: string, items: readonly FileItem[]) {
  const openContextMenu = useUiStore((state) => state.openContextMenu)

  return useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()

      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-file-path]')
      const path = row?.dataset.filePath
      const item = path ? items.find((candidate) => candidate.path === path) : undefined

      let kind: ContextKind = 'background'

      if (item) {
        // Read rather than subscribe: this runs on a click, and subscribing
        // would rebuild the handler on every selection change.
        const selected = useSelectionStore.getState().byPane[paneId]?.selected
        if (!selected?.has(item.path)) useSelectionStore.getState().select(paneId, item.path)
        kind = item.isDirectory ? 'folder' : 'file'
      }

      openContextMenu({ kind, x: event.clientX, y: event.clientY })
    },
    [paneId, items, openContextMenu],
  )
}
