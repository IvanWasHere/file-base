/**
 * Keyboard shortcuts for file operations, scoped to a pane.
 *
 * Deliberately pane-scoped rather than a window-level listener: every one of
 * these acts on "the selection in the pane you are looking at", and a global
 * handler would have to reconstruct that from stores on each keystroke. It also
 * means the shortcuts are inert while focus is in the sidebar or a dialog.
 *
 * M11 hoists these into the central registry alongside navigation and view
 * shortcuts. Until then they live next to the only thing that uses them, rather
 * than in a registry with one client.
 *
 * Note what is absent: Enter. It opens the selected item here, as it has since
 * M4, where Finder uses it to rename. Changing a shipped binding belongs with
 * the shortcut registry that will own the whole set, not with this milestone.
 */

import { useCallback } from 'react'
import { useFileOperations } from '@/hooks/useFileOperations'
import { useClipboardStore } from '@/stores/clipboardStore'
import { useSearchStore } from '@/stores/searchStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'

interface UseOperationKeysOptions {
  paneId: string
  /** The directory the pane is showing — the paste destination. */
  path: string
}

export function useOperationKeys({ paneId, path }: UseOperationKeysOptions) {
  const operations = useFileOperations()

  return useCallback(
    (event: React.KeyboardEvent) => {
      // Reading selection here rather than subscribing keeps a keystroke from
      // re-creating this handler every time the selection changes.
      const selected = useSelectionStore.getState().byPane[paneId]?.selected
      const paths = selected ? [...selected] : []
      const accel = event.metaKey || event.ctrlKey

      // Backspace is the macOS binding; Delete is what an external PC keyboard
      // sends. Shift bypasses the trash, as it does in Finder.
      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (paths.length === 0) return
        event.preventDefault()
        void (event.shiftKey
          ? operations.deletePermanently(paths)
          : operations.moveToTrash(paths))
        return
      }

      if (!accel) return

      switch (event.key.toLowerCase()) {
        case 'c':
          if (paths.length === 0) return
          event.preventDefault()
          operations.copy(paths, path)
          return

        case 'x':
          if (paths.length === 0) return
          event.preventDefault()
          operations.cut(paths, path)
          return

        case 'v':
          if (useClipboardStore.getState().paths.length === 0) return
          event.preventDefault()
          void operations.paste(path)
          return

        case 'd':
          if (paths.length === 0) return
          event.preventDefault()
          void operations.duplicate(paths)
          return

        case 'z':
          event.preventDefault()
          void operations.undo()
          return

        case 'f':
          event.preventDefault()
          useSearchStore.getState().open(paneId)
          return

        case 'n':
          // Cmd+Shift+N is New Folder; plain Cmd+N is reserved for New Window,
          // which does not exist yet and must not silently do something else.
          if (!event.shiftKey) return
          event.preventDefault()
          void operations.createFolder(path, paneId)
          return

        case 'enter': {
          // Cmd+Enter renames, leaving plain Enter to open. The lead item is
          // preferred so a multi-selection renames the one the cursor is on.
          const lead = useSelectionStore.getState().byPane[paneId]?.lead
          const target = lead ?? paths[0]
          if (!target) return
          event.preventDefault()
          useUiStore.getState().beginRename(paneId, target)
          return
        }
      }
    },
    [paneId, path, operations],
  )
}
