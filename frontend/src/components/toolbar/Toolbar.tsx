import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Columns2,
  Columns3,
  Eye,
  FolderPlus,
  Grid2x2,
  RefreshCw,
  Search,
  Square,
  Star,
  StarOff,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Breadcrumb } from './Breadcrumb'
import { ViewMenu } from './ViewMenu'
import { useFileOperations } from '@/hooks/useFileOperations'
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
import type { SplitMode } from '@/types/workspace'

/**
 * The mockup's `.toolbar`, ported.
 *
 * Only controls that actually work are here. Search (M8) and Settings arrive
 * with their milestones — a toolbar of dead buttons is worse than a short one.
 */

const SPLIT_OPTIONS: { mode: SplitMode; label: string; icon: typeof Square }[] = [
  { mode: 1, label: 'Single pane', icon: Square },
  { mode: 2, label: 'Two panes', icon: Columns2 },
  { mode: 3, label: 'Three panes', icon: Columns3 },
  { mode: 4, label: 'Four panes', icon: Grid2x2 },
]

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

      <Breadcrumb path={pane.path} onNavigate={(path) => navigate(pane.id, path)} />

      <ToolbarButton
        label={pinned ? 'Remove from Favorites' : 'Add to Favorites'}
        icon={pinned ? Star : StarOff}
        active={pinned}
        onClick={() => (pinned ? unpin(pane.path) : pin(pane.path))}
      />

      <div
        role="group"
        aria-label="Split layout"
        className="bg-base border-edge flex shrink-0 gap-0.5 rounded-md border p-0.5"
      >
        {SPLIT_OPTIONS.map((option) => {
          const Icon = option.icon
          const active = tab.splitMode === option.mode
          return (
            <button
              key={option.mode}
              type="button"
              aria-label={option.label}
              aria-pressed={active}
              title={option.label}
              onClick={() => setSplitMode(tab.id, option.mode)}
              className={`flex h-[26px] w-[30px] items-center justify-center rounded transition-colors ${
                active
                  ? 'text-accent bg-[var(--accent-glow)]'
                  : 'text-muted hover:bg-hover hover:text-primary'
              }`}
            >
              <Icon size={14} />
            </button>
          )
        })}
      </div>

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
