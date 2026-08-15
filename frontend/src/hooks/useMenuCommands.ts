import { useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import type { MenuCommandId } from '@/constants/menus'
import { useFavorites } from '@/hooks/useFavorites'
import { useArchive } from '@/hooks/useArchive'
import { useFileOperations } from '@/hooks/useFileOperations'
import { bridge } from '@/services/bridge'
import { fsKeys, standardPathsQuery } from '@/services/filesystem/queries'
import { useClipboardStore } from '@/stores/clipboardStore'
import { useHistoryStore } from '@/stores/historyStore'
import { useSearchStore } from '@/stores/searchStore'
import { toast } from '@/stores/toastStore'
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
import { describeFsError, isFsError } from '@/types/errors'
import type { FileItem } from '@/types/file'
import type { SplitMode, ViewMode } from '@/types/workspace'

export interface MenuCommandState {
  run: (id: MenuCommandId) => void
  isEnabled: (id: MenuCommandId) => boolean
  isChecked: (id: MenuCommandId) => boolean
  /**
   * Whether the command should appear at all. Only the Add/Remove Favorites
   * pair uses it: they are two spellings of one toggle, and showing both — one
   * of them always dead — is worse than showing the one that applies.
   */
  isVisible: (id: MenuCommandId) => boolean
}

/**
 * The single implementation of every application command.
 *
 * Four routes reach it and none of them owns a command: the in-window menu bar,
 * the native macOS menu (`backend/appmenu`, over `menu:command`), the context
 * menus, and the keyboard registry in `constants/shortcuts.ts`.
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
  const { selected, lead } = usePaneSelection(pane?.id ?? '')
  const operations = useFileOperations()
  const archives = useArchive()
  const openSearch = useSearchStore((state) => state.open)
  const clipboardCount = useClipboardStore((state) => state.paths.length)
  const undoDepth = useHistoryStore((state) => state.entries.length)
  const { isPinned, pin, unpin } = useFavorites()

  /** The selection as an array — what every file operation acts on. */
  const targets = [...selected]

  /**
   * What the listing already knows about a path. Search results and the icon
   * grids render from the same cache entry the pane read, so this answers for
   * anything on screen; `file.open` falls back to a stat for the rest.
   */
  const cachedItem = (path: string): FileItem | undefined =>
    queryClient
      .getQueryData<FileItem[]>(fsKeys.directory(pane?.path ?? '', ui.showHiddenFiles))
      ?.find((item) => item.path === path)

  const openPath = (path: string, isDirectory: boolean): void => {
    if (isDirectory) {
      if (pane) navigate(pane.id, path)
      return
    }
    void bridge.shell.openFile(path).catch((error: unknown) => {
      toast.error(
        'Could not open the file',
        isFsError(error) ? describeFsError(error) : undefined,
      )
    })
  }

  /**
   * Favourites act on a folder: the selected one, or — with nothing selected,
   * which is the background context menu's case — the folder being shown.
   */
  const favoriteTarget = (): string | undefined => {
    const selectedFolder = targets.find((path) => cachedItem(path)?.isDirectory)
    return selectedFolder ?? (targets.length === 0 ? pane?.path : undefined)
  }

  const viewModes: Partial<Record<MenuCommandId, ViewMode>> = {
    'view.details': 'details',
    'view.largeIcons': 'large-icons',
    'view.mediumIcons': 'medium-icons',
    'view.smallIcons': 'small-icons',
    'view.photos': 'photos',
  }

  const splitModes: Partial<Record<MenuCommandId, SplitMode>> = {
    'view.splitSingle': 'single',
    'view.splitTwo': 'columns-2',
    'view.splitRows': 'rows-2',
    'view.splitThree': 'columns-3',
    'view.splitTop': 'split-top',
    'view.splitBottom': 'split-bottom',
    'view.splitLeft': 'split-left',
    'view.splitRight': 'split-right',
    'view.splitFour': 'grid-2x2',
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
      case 'file.open': {
        const target = lead ?? targets[0]
        if (!target) return
        const item = cachedItem(target)
        if (item) {
          if (!item.broken) openPath(item.path, item.isDirectory)
          return
        }
        // Not in the listing the pane rendered — a stat is one round trip and
        // the alternative is a menu item that silently does nothing.
        void bridge.fs
          .readFileInfo(target)
          .then((info) => openPath(info.path, info.isDirectory))
          .catch(() => toast.error('Could not open the item'))
        return
      }
      case 'file.openInNewTab': {
        const target = targets.find((path) => cachedItem(path)?.isDirectory)
        if (target) openTab(target)
        return
      }

      case 'file.addToFavorites': {
        const target = favoriteTarget()
        if (target) pin(target)
        return
      }
      case 'file.removeFromFavorites': {
        const target = favoriteTarget()
        if (target) unpin(target)
        return
      }

      case 'file.newFolder':
        if (pane) void operations.createFolder(pane.path, pane.id)
        return
      case 'file.newFile':
        if (pane) void operations.createFile(pane.path, pane.id)
        return
      case 'file.newFromTemplate':
        if (pane) ui.openNewFile(pane.path, pane.id)
        return
      case 'file.newTab':
        openTab(pane?.path ?? paths?.home ?? '/')
        return
      case 'file.closeTab':
        if (tab) closeTab(tab.id)
        return
      case 'file.rename': {
        // The lead is the item the keyboard cursor is on, so a multi-selection
        // renames the one the user was last pointing at.
        const target = lead ?? targets[0]
        if (pane && target) ui.beginRename(pane.id, target)
        return
      }
      case 'file.duplicate':
        void operations.duplicate(targets)
        return
      // The whole selection goes across, folders included. Deciding what is a
      // folder means stat'ing it, and the modal has to do that anyway for the
      // names and sizes it shows — so it drops them there and reports how many
      // (PLAN.md M14 decision 8).
      case 'file.calculateHashes':
        ui.openHashes(targets)
        return

      case 'file.compress':
        if (pane) ui.openCompress(targets, pane.path)
        return
      // Permanent, unlike browsing: what it extracts stays where it lands.
      case 'file.uncompress':
        void archives.uncompress(targets)
        return
      case 'file.moveToTrash':
        void operations.moveToTrash(targets)
        return
      case 'file.delete':
        void operations.deletePermanently(targets)
        return
      case 'file.revealInFinder': {
        const path = targets[0] ?? pane?.path
        if (path) void bridge.shell.revealInFinder(path).catch(() => undefined)
        return
      }

      // Dragging *out* to Finder is not something the webview can do
      // (PLAN.md §3). Reveal in Finder and this are the way across.
      case 'file.copyPath': {
        const path = targets[0] ?? pane?.path
        if (!path) return
        void navigator.clipboard.writeText(targets.length > 1 ? targets.join('\n') : path).then(
          () => toast.info(targets.length > 1 ? `Copied ${targets.length} paths` : 'Copied path'),
          () => toast.error('Could not copy the path'),
        )
        return
      }

      case 'edit.undo':
        void operations.undo()
        return
      case 'edit.copy':
        if (pane) operations.copy(targets, pane.path)
        return
      case 'edit.cut':
        if (pane) operations.cut(targets, pane.path)
        return
      case 'edit.paste':
        if (pane) void operations.paste(pane.path)
        return

      case 'edit.find':
        if (pane) openSearch(pane.id)
        return

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

      // Every command that acts on the selection is greyed out without one,
      // rather than being clickable and silently doing nothing.
      case 'edit.deselectAll':
      case 'edit.copy':
      case 'edit.cut':
      case 'file.rename':
      case 'file.duplicate':
      case 'file.moveToTrash':
      case 'file.delete':
      case 'file.open':
        return selected.size > 0
      // Enabled when the selection could hold a file. An item the pane's cache
      // cannot classify counts as one: the alternative is a dead button
      // wherever the selection came from somewhere the cache does not cover,
      // and the modal reports an empty result honestly.
      case 'file.calculateHashes':
        return targets.some((path) => cachedItem(path)?.isDirectory !== true)
      case 'file.compress':
        return targets.length > 0
      // Only offered for something that looks like an archive, so the menu row
      // is not present-and-dead on every ordinary file.
      case 'file.uncompress':
        return targets.some((path) => {
          const item = cachedItem(path)
          return item !== undefined && archives.isArchive(item)
        })
      // Only a folder can be opened in a tab, and only a folder can be pinned.
      case 'file.openInNewTab':
        return targets.some((path) => cachedItem(path)?.isDirectory === true)
      case 'file.addToFavorites':
      case 'file.removeFromFavorites':
        return favoriteTarget() !== undefined
      case 'edit.paste':
        return clipboardCount > 0
      case 'edit.undo':
        return undoDepth > 0
      case 'file.newFolder':
      case 'file.newFile':
      case 'file.newFromTemplate':
        return pane !== undefined
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

  const isVisible = (id: MenuCommandId): boolean => {
    const target = favoriteTarget()
    if (id === 'file.addToFavorites') return target === undefined || !isPinned(target)
    if (id === 'file.removeFromFavorites') return target !== undefined && isPinned(target)
    return true
  }

  return { run, isEnabled, isChecked, isVisible }
}
