import { useQuery } from '@tanstack/react-query'
import { ContextMenu, type ContextMenuAction } from '@/components/menus/ContextMenu'
import { CONTEXT_MENUS } from '@/constants/contextMenus'
import { findMenuItem, type MenuCommandId } from '@/constants/menus'
import { acceleratorFor } from '@/constants/shortcuts'
import { useMenuCommands } from '@/hooks/useMenuCommands'
import { applicationLabel } from '@/services/shell/installed'
import { openWith } from '@/services/shell/open'
import { applicationsQuery } from '@/services/shell/queries'
import { useUiStore } from '@/stores/uiStore'

/**
 * Turns the open context-menu request into rows.
 *
 * Mounted once for the window rather than per pane: only one context menu can
 * be open, it is positioned in viewport coordinates, and a menu rendered inside
 * a pane would be clipped by the pane's own `overflow: hidden`.
 *
 * Every row is a `MenuCommandId` resolved through `useMenuCommands` — the same
 * label, the same enablement and the same handler the menu bar uses. The one
 * exception is `file.openWith`, whose *children* are applications discovered
 * when the menu opens; this is the only place that fills them (§M25 decision 5).
 */
export function ContextMenuHost() {
  const request = useUiStore((state) => state.contextMenu)
  const closeContextMenu = useUiStore((state) => state.closeContextMenu)
  const hiddenCommands = useUiStore((state) => state.hiddenContextCommands)
  const openOpenWith = useUiStore((state) => state.openOpenWith)
  const { run, openWithTargets, isEnabled, isChecked, isVisible } = useMenuCommands()

  const targets = openWithTargets()
  const lead = targets[0] ?? ''
  // Asked for unconditionally rather than only when the row is on screen: a
  // hook cannot be called conditionally, and the query is disabled without a
  // lead and answered from cache for the second file of a type anyway.
  const { data: applications, isPending } = useQuery(applicationsQuery(lead))

  if (!request) return null

  /**
   * The Open With flyout: what Launch Services suggests, then a door to the
   * picker for the application it did not suggest.
   */
  const openWithSubmenu = (): ContextMenuAction[] => {
    const apps = applications?.apps ?? []

    const rows: ContextMenuAction[] =
      apps.length > 0
        ? apps.map((app) => ({
            key: app.path,
            // Finder marks the default this way, and a checkmark would read as
            // a setting rather than as a fact about the system.
            label: app.isDefault ? `${applicationLabel(app)} (default)` : applicationLabel(app),
            onSelect: () => openWith(targets, app.path),
          }))
        : [
            {
              // One disabled sentence rather than an empty flyout, for the
              // reason a menu with nothing in it does not open at all
              // (§M25 decision 10).
              key: 'none',
              label: isPending ? 'Looking for applications…' : 'No applications available',
              disabled: true,
              onSelect: () => undefined,
            },
          ]

    return [
      ...rows,
      {
        key: 'other',
        label: 'Other…',
        onSelect: () => openOpenWith(targets),
      },
    ]
  }

  const toAction = (id: MenuCommandId): ContextMenuAction => {
    const item = findMenuItem(id)
    return {
      key: id,
      label: item?.label ?? id,
      accelerator: acceleratorFor(id),
      checkable: item?.checkable,
      checked: item?.checkable ? isChecked(id) : undefined,
      disabled: !isEnabled(id),
      // The submenu replaces the label's trailing ellipsis: here the row leads
      // somewhere rather than opening a dialog.
      ...(id === 'file.openWith'
        ? { label: 'Open With', submenu: openWithSubmenu() }
        : {}),
      onSelect: () => run(id),
    }
  }

  const groups: ContextMenuAction[][] = CONTEXT_MENUS[request.kind].map((group) =>
    // Two filters, deliberately not merged: `isVisible` is about the moment —
    // a folder is pinned, so Remove replaces Add — and this one is about what
    // the user asked for in Settings (§M22 decision 8). Empty groups drop out
    // in the renderer, so hiding a row never leaves a doubled rule behind.
    group
      .filter((id) => !hiddenCommands.includes(id))
      .filter(isVisible)
      .map(toAction),
  )

  // Every row switched off is a menu with nothing in it. An empty panel that
  // has to be dismissed is worse than no menu at all, so the right-click simply
  // does nothing — which is also what it does over a pane with no view.
  if (groups.every((group) => group.length === 0)) return null

  return (
    <ContextMenu x={request.x} y={request.y} groups={groups} onClose={closeContextMenu} />
  )
}
