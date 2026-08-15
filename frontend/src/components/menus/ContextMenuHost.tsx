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
  const { run, isEnabled, isChecked, isVisible } = useMenuCommands()

  if (!request) return null

  const groups: ContextMenuAction[][] = CONTEXT_MENUS[request.kind].map((group) =>
    group.filter(isVisible).map((id) => {
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

  return (
    <ContextMenu x={request.x} y={request.y} groups={groups} onClose={closeContextMenu} />
  )
}
