import { ContextMenu, type ContextMenuAction } from '@/components/menus/ContextMenu'
import { CONTEXT_MENUS } from '@/constants/contextMenus'
import { findMenuItem } from '@/constants/menus'
import { acceleratorFor } from '@/constants/shortcuts'
import { useMenuCommands } from '@/hooks/useMenuCommands'
import { useUiStore } from '@/stores/uiStore'

/**
 * Turns the open context-menu request into rows.
 *
 * Mounted once for the window rather than per pane: only one context menu can
 * be open, it is positioned in viewport coordinates, and a menu rendered inside
 * a pane would be clipped by the pane's own `overflow: hidden`.
 *
 * Every row is a `MenuCommandId` resolved through `useMenuCommands` — the same
 * label, the same enablement and the same handler the menu bar uses.
 */
export function ContextMenuHost() {
  const request = useUiStore((state) => state.contextMenu)
  const closeContextMenu = useUiStore((state) => state.closeContextMenu)
  const hiddenCommands = useUiStore((state) => state.hiddenContextCommands)
  const { run, isEnabled, isChecked, isVisible } = useMenuCommands()

  if (!request) return null

  const groups: ContextMenuAction[][] = CONTEXT_MENUS[request.kind].map((group) =>
    // Two filters, deliberately not merged: `isVisible` is about the moment —
    // a folder is pinned, so Remove replaces Add — and this one is about what
    // the user asked for in Settings (§M22 decision 8). Empty groups drop out
    // in the renderer, so hiding a row never leaves a doubled rule behind.
    group
      .filter((id) => !hiddenCommands.includes(id))
      .filter(isVisible)
      .map((id) => {
        const item = findMenuItem(id)
        return {
          key: id,
          label: item?.label ?? id,
          accelerator: acceleratorFor(id),
          checkable: item?.checkable,
          checked: item?.checkable ? isChecked(id) : undefined,
          disabled: !isEnabled(id),
          onSelect: () => run(id),
        }
      }),
  )

  // Every row switched off is a menu with nothing in it. An empty panel that
  // has to be dismissed is worse than no menu at all, so the right-click simply
  // does nothing — which is also what it does over a pane with no view.
  if (groups.every((group) => group.length === 0)) return null

  return (
    <ContextMenu x={request.x} y={request.y} groups={groups} onClose={closeContextMenu} />
  )
}
