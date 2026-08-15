import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { PaneGroup } from '@/features/explorer/PaneGroup'
import { PreviewPanel } from '@/features/preview/PreviewPanel'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { StatusBar } from '@/components/common/StatusBar'
import { Toaster } from '@/components/common/Toaster'
import { DialogHost } from '@/components/dialogs/DialogHost'
import { HashModal } from '@/features/hashing/HashModal'
import { ContextMenuHost } from '@/components/menus/ContextMenuHost'
import { MenuBar } from '@/components/toolbar/MenuBar'
import { TabBar } from '@/components/toolbar/TabBar'
import { Toolbar } from '@/components/toolbar/Toolbar'
import { DirectoryError } from '@/components/common/DirectoryError'
import { useDirectory } from '@/hooks/useDirectory'
import { useExternalDrop } from '@/hooks/useExternalDrop'
import { useFileOperations } from '@/hooks/useFileOperations'
import { useKeyboard } from '@/hooks/useKeyboard'
import { useNativeMenu } from '@/hooks/useNativeMenu'
import { hydrate, startPersistence } from '@/services/db/persistence'
import { standardPathsQuery } from '@/services/filesystem/queries'
import { startWatchInvalidation } from '@/services/filesystem/watch'
import { usePaneSelection } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import { useActivePane, useActiveTab, useWorkspaceStore } from '@/stores/workspaceStore'
import { isFsError } from '@/types/errors'

/**
 * The full chrome from the mockup: tab bar → toolbar → sidebar / panes /
 * preview → status bar.
 */
export function ExplorerLayout() {
  const { data: paths, isLoading, error, refetch } = useQuery(standardPathsQuery())

  const initialize = useWorkspaceStore((state) => state.initialize)
  const queryClient = useQueryClient()
  const tab = useActiveTab()
  const pane = useActivePane()
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const previewOpen = useUiStore((state) => state.previewOpen)

  // Guards against React StrictMode's double-invoke, which would otherwise run
  // migrations and attach a second set of store subscriptions.
  const started = useRef(false)

  useEffect(() => {
    if (!paths || started.current) return
    started.current = true

    let stopPersistence: (() => void) | undefined

    void hydrate(paths.home)
      .catch((error: unknown) => {
        // A database problem must not stop the user browsing files; they lose
        // session restore and favorites, not the application.
        console.warn('[db] hydration failed, continuing without persistence:', error)
        initialize(paths.home)
      })
      .finally(() => {
        stopPersistence = startPersistence()
      })

    return () => stopPersistence?.()
  }, [paths, initialize])

  // Change events are subscribed to once for the whole app, not per pane: the
  // watcher reports directories, and which panes care is the query cache's
  // business (PLAN.md §1, rule 2).
  useEffect(() => startWatchInvalidation(queryClient), [queryClient])

  // Subscribed once for the window: a Finder drop arrives with coordinates and
  // is routed by hit-test, so no pane needs its own listener.
  useExternalDrop(useFileOperations())

  // Both resolve the active pane themselves, so they belong to the window
  // rather than to any pane (PLAN.md M11). Mounted above the early returns so
  // the hook order is stable while the app is still starting up.
  useKeyboard()
  useNativeMenu()

  // `!tab` covers hydration too: since M5, startup waits on migrations and the
  // session query, and rendering the chrome around an empty workspace would
  // flash a toolbar with nothing behind it.
  if (isLoading || (!tab && !error)) {
    return (
      <div className="text-muted flex h-screen items-center justify-center gap-2 text-[13px]">
        <Loader2 size={16} className="animate-spin" />
        Starting…
      </div>
    )
  }

  if (error || !paths) {
    return (
      <div className="flex h-screen items-center justify-center">
        {isFsError(error) ? (
          <DirectoryError error={error} onRetry={() => void refetch()} />
        ) : (
          <span className="text-muted text-[13px]">Could not resolve the home directory.</span>
        )}
      </div>
    )
  }

  return (
    <div className="bg-deep text-primary flex h-screen flex-col">
      <MenuBar />
      <TabBar />
      <Toolbar />

      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <Sidebar />}
        {tab && <PaneGroup tab={tab} />}
        {previewOpen && <ActivePreview />}
      </div>

      {tab && pane && <ActiveStatusBar />}

      <Toaster />
      <DialogHost />
      {/* Above the dialog host, so a confirmation raised from behind it — a
          delete started before the modal opened — is still readable. */}
      <HashModal />
      <ContextMenuHost />
    </div>
  )
}

/**
 * Split out so a selection change re-renders the preview alone rather than the
 * whole layout — the pane group is the expensive subtree.
 */
function ActivePreview() {
  const pane = useActivePane()
  const { selected } = usePaneSelection(pane?.id ?? '')
  const showHiddenFiles = useUiStore((state) => state.showHiddenFiles)

  const { items } = useDirectory(pane?.path ?? '', {
    includeHidden: showHiddenFiles,
    ...(pane ? { sort: pane.sort } : {}),
  })

  const item = useMemo(() => {
    if (selected.size !== 1) return null
    const [path] = [...selected]
    return items.find((candidate) => candidate.path === path) ?? null
  }, [selected, items])

  return <PreviewPanel item={item} />
}

function ActiveStatusBar() {
  const tab = useActiveTab()
  const pane = useActivePane()
  const { selected } = usePaneSelection(pane?.id ?? '')
  const showHiddenFiles = useUiStore((state) => state.showHiddenFiles)

  const { items } = useDirectory(pane?.path ?? '', {
    includeHidden: showHiddenFiles,
    ...(pane ? { sort: pane.sort } : {}),
  })

  const totalBytes = useMemo(
    () => items.reduce((sum, item) => sum + (item.isDirectory ? 0 : item.size), 0),
    [items],
  )

  if (!tab || !pane) return null

  return (
    <StatusBar
      itemCount={items.length}
      selectedCount={selected.size}
      totalBytes={totalBytes}
      splitMode={tab.splitMode}
      viewMode={pane.viewMode}
    />
  )
}
