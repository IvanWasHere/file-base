import { useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import type { MenuCommandId } from '@/constants/menus'
import { bridge } from '@/services/bridge'
import { fsKeys, standardPathsQuery } from '@/services/filesystem/queries'
import { usePaneSelection, useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import {
  canGoBack,
  canGoForward,
  canGoUp,
  useActivePane,
  useActiveTab,
  useWorkspaceStore,
} from '@/stores/workspaceStore'
import type { SplitMode, ViewMode } from '@/types/workspace'

export interface MenuCommandState {
  run: (id: MenuCommandId) => void
  isEnabled: (id: MenuCommandId) => boolean
  isChecked: (id: MenuCommandId) => boolean
}

/**
 * The single implementation of every application command.
 *
 * The in-window menu bar calls into this; M11's native macOS menu will emit the
 * same `MenuCommandId`s over the bridge and land here too, so a command is
 * never implemented twice.
 */
export function useMenuCommands(): MenuCommandState {
  const tab = useActiveTab()
  const pane = useActivePane()
  const queryClient = useQueryClient()
  const { data: paths } = useQuery(standardPathsQuery())

  const openTab = useWorkspaceStore((state) => state.openTab)
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const navigate = useWorkspaceStore((state) => state.navigate)
  const goBack = useWorkspaceStore((state) => state.goBack)
  const goForward = useWorkspaceStore((state) => state.goForward)
  const goUp = useWorkspaceStore((state) => state.goUp)
  const setViewMode = useWorkspaceStore((state) => state.setViewMode)
  const setSplitMode = useWorkspaceStore((state) => state.setSplitMode)

  const ui = useUiStore()
  const selectAll = useSelectionStore((state) => state.selectAll)
  const clearSelection = useSelectionStore((state) => state.clear)
  const { selected } = usePaneSelection(pane?.id ?? '')

  const viewModes: Partial<Record<MenuCommandId, ViewMode>> = {
    'view.details': 'details',
    'view.largeIcons': 'large-icons',
    'view.mediumIcons': 'medium-icons',
    'view.smallIcons': 'small-icons',
  }

  const splitModes: Partial<Record<MenuCommandId, SplitMode>> = {
    'view.splitSingle': 1,
    'view.splitTwo': 2,
    'view.splitThree': 3,
    'view.splitFour': 4,
  }

  const run = (id: MenuCommandId): void => {
    const viewMode = viewModes[id]
    if (viewMode && pane) {
      setViewMode(pane.id, viewMode)
      return
    }

    const splitMode = splitModes[id]
    if (splitMode && tab) {
      setSplitMode(tab.id, splitMode)
      return
    }

    switch (id) {
      case 'file.newTab':
        openTab(pane?.path ?? paths?.home ?? '/')
        return
      case 'file.closeTab':
        if (tab) closeTab(tab.id)
        return
      case 'file.revealInFinder': {
        const [target] = [...selected]
        const path = target ?? pane?.path
        if (path) void bridge.shell.revealInFinder(path).catch(() => undefined)
        return
      }

      case 'edit.selectAll':
        // The menu has no view of the current listing, so selection falls back
        // to the query cache — the same data the pane rendered from.
        if (pane) {
          const items = queryClient.getQueryData<{ path: string }[]>(
            fsKeys.directory(pane.path, ui.showHiddenFiles),
          )
          if (items)
            selectAll(
              pane.id,
              items.map((item) => item.path),
            )
        }
        return
      case 'edit.deselectAll':
        if (pane) clearSelection(pane.id)
        return

      case 'view.toggleHidden':
        ui.toggleHiddenFiles()
        return
      case 'view.toggleSidebar':
        ui.toggleSidebar()
        return
      case 'view.togglePreview':
        ui.togglePreview()
        return
      case 'view.refresh':
        if (pane) {
          void queryClient.invalidateQueries({ queryKey: fsKeys.directoryRoot(pane.path) })
        }
        return

      case 'go.back':
        if (pane) goBack(pane.id)
        return
      case 'go.forward':
        if (pane) goForward(pane.id)
        return
      case 'go.up':
        if (pane) goUp(pane.id)
        return
      case 'go.home':
        if (pane && paths) navigate(pane.id, paths.home)
        return
      case 'go.documents':
        if (pane && paths) navigate(pane.id, paths.documents)
        return
      case 'go.downloads':
        if (pane && paths) navigate(pane.id, paths.downloads)
        return
      case 'go.applications':
        if (pane && paths) navigate(pane.id, paths.applications)
        return
    }
  }

  const isEnabled = (id: MenuCommandId): boolean => {
    switch (id) {
      case 'go.back':
        return canGoBack(pane)
      case 'go.forward':
        return canGoForward(pane)
      case 'go.up':
        return canGoUp(pane)
      case 'edit.deselectAll':
        return selected.size > 0
      case 'go.home':
      case 'go.documents':
      case 'go.downloads':
      case 'go.applications':
        return paths !== undefined
      default:
        return true
    }
  }

  const isChecked = (id: MenuCommandId): boolean => {
    const viewMode = viewModes[id]
    if (viewMode) return pane?.viewMode === viewMode

    const splitMode = splitModes[id]
    if (splitMode) return tab?.splitMode === splitMode

    switch (id) {
      case 'view.toggleHidden':
        return ui.showHiddenFiles
      case 'view.toggleSidebar':
        return ui.sidebarOpen
      case 'view.togglePreview':
        return ui.previewOpen
      default:
        return false
    }
  }

  return { run, isEnabled, isChecked }
}
