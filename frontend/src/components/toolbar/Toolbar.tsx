import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Eye,
  FolderPlus,
  Hash,
  RefreshCw,
  Search,
  Star,
  StarOff,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Breadcrumb } from './Breadcrumb'
import { SplitMenu } from './SplitMenu'
import { ViewMenu } from './ViewMenu'
import { useFileOperations } from '@/hooks/useFileOperations'
import { useMenuCommands } from '@/hooks/useMenuCommands'
import { useSearchStore } from '@/stores/searchStore'
import {
  canGoBack,
  canGoForward,
  canGoUp,
  useActivePane,
  useActiveTab,
  useWorkspaceStore,
} from '@/stores/workspaceStore'
import { useFavorites } from '@/hooks/useFavorites'
import { useUiStore } from '@/stores/uiStore'
import { fsKeys } from '@/services/filesystem/queries'

/**
 * The mockup's `.toolbar`, ported.
 *
 * Only controls that actually work are here. Search (M8) and Settings arrive
 * with their milestones — a toolbar of dead buttons is worse than a short one.
 */

function ToolbarButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  active,
}: {
  label: string
  icon: typeof ArrowLeft
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex size-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-default disabled:opacity-30 ${
        active
          ? 'text-accent bg-[var(--accent-glow)]'
          : 'text-secondary enabled:hover:bg-hover enabled:hover:text-primary'
      }`}
    >
      <Icon size={15} />
    </button>
  )
}

export function Toolbar() {
  const tab = useActiveTab()
  const pane = useActivePane()
  const queryClient = useQueryClient()

  const goBack = useWorkspaceStore((state) => state.goBack)
  const goForward = useWorkspaceStore((state) => state.goForward)
  const goUp = useWorkspaceStore((state) => state.goUp)
  const navigate = useWorkspaceStore((state) => state.navigate)
  const setSplitMode = useWorkspaceStore((state) => state.setSplitMode)
  const setViewMode = useWorkspaceStore((state) => state.setViewMode)

  const previewOpen = useUiStore((state) => state.previewOpen)
  const togglePreview = useUiStore((state) => state.togglePreview)

  const { isPinned, pin, unpin } = useFavorites()
  const pinned = pane ? isPinned(pane.path) : false
  const operations = useFileOperations()
  // Through the command registry rather than the store directly: a toolbar
  // button is a fourth route to a command, never a fourth implementation of one
  // — which is also where its enablement rule already lives.
  const commands = useMenuCommands()
  const openSearch = useSearchStore((state) => state.open)
  const closeSearch = useSearchStore((state) => state.close)
  const searchOpen = useSearchStore((state) => state.byPane[pane?.id ?? '']?.open ?? false)

  if (!tab || !pane) return null

  return (
    <div className="bg-surface border-edge flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
      <ToolbarButton
        label="Back"
        icon={ArrowLeft}
        disabled={!canGoBack(pane)}
        onClick={() => goBack(pane.id)}
      />
      <ToolbarButton
        label="Forward"
        icon={ArrowRight}
        disabled={!canGoForward(pane)}
        onClick={() => goForward(pane.id)}
      />
      <ToolbarButton
        label="Up"
        icon={ArrowUp}
        disabled={!canGoUp(pane)}
        onClick={() => goUp(pane.id)}
      />
      <ToolbarButton
        label="Refresh"
        icon={RefreshCw}
        onClick={() => {
          // Invalidates every hidden-files variant of this directory at once.
          void queryClient.invalidateQueries({ queryKey: fsKeys.directoryRoot(pane.path) })
        }}
      />

      <ToolbarButton
        label="New Folder"
        icon={FolderPlus}
        onClick={() => void operations.createFolder(pane.path, pane.id)}
      />
      <ToolbarButton
        label="Search"
        icon={Search}
        active={searchOpen}
        onClick={() => (searchOpen ? closeSearch(pane.id) : openSearch(pane.id))}
      />
      <ToolbarButton
        label="Calculate Hashes"
        icon={Hash}
        disabled={!commands.isEnabled('file.calculateHashes')}
        onClick={() => commands.run('file.calculateHashes')}
      />

      <Breadcrumb path={pane.path} onNavigate={(path) => navigate(pane.id, path)} />

      <ToolbarButton
        label={pinned ? 'Remove from Favorites' : 'Add to Favorites'}
        icon={pinned ? Star : StarOff}
        active={pinned}
        onClick={() => (pinned ? unpin(pane.path) : pin(pane.path))}
      />

      <SplitMenu mode={tab.splitMode} onChange={(mode) => setSplitMode(tab.id, mode)} />

      <ViewMenu mode={pane.viewMode} onChange={(mode) => setViewMode(pane.id, mode)} />

      <ToolbarButton
        label="Toggle preview"
        icon={Eye}
        active={previewOpen}
        onClick={togglePreview}
      />
    </div>
  )
}
