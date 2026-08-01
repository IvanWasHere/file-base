import { Loader2 } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { DetailsView } from '@/components/explorer/DetailsView'
import { IconsView } from '@/components/explorer/IconsView'
import { DirectoryError } from '@/components/common/DirectoryError'
import { Breadcrumb } from '@/components/toolbar/Breadcrumb'
import { SearchBar } from '@/features/search/SearchBar'
import { SearchStatusBar } from '@/features/search/SearchStatusBar'
import { useDirectory } from '@/hooks/useDirectory'
import { useFileOperations } from '@/hooks/useFileOperations'
import { useOperationKeys } from '@/hooks/useOperationKeys'
import { useSearch } from '@/hooks/useSearch'
import { usePaneSearch } from '@/stores/searchStore'
import { bridge } from '@/services/bridge'
import { toast } from '@/stores/toastStore'
import { usePaneSelection, useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { describeFsError, isFsError } from '@/types/errors'
import type { FileItem } from '@/types/file'
import type { Pane } from '@/types/workspace'
import { formatCount } from '@/utils/format'

/** Panel letters, as in the mockup's `.panel-letter`. */
const LETTERS = ['A', 'B', 'C', 'D'] as const

interface ExplorerPaneProps {
  pane: Pane
  index: number
  isActive: boolean
  showLetter: boolean
  onFocus: () => void
}

export function ExplorerPane({ pane, index, isActive, showLetter, onFocus }: ExplorerPaneProps) {
  const navigate = useWorkspaceStore((state) => state.navigate)
  const setSort = useWorkspaceStore((state) => state.setSort)
  const showHiddenFiles = useUiStore((state) => state.showHiddenFiles)
  const setPreviewOpen = useUiStore((state) => state.setPreviewOpen)
  const previewOpen = useUiStore((state) => state.previewOpen)
  const clearSelection = useSelectionStore((state) => state.clear)
  const { selected } = usePaneSelection(pane.id)

  const search = usePaneSearch(pane.id)

  // A search asking for hidden files has to be given a listing that contains
  // them: in folder scope the filter runs over what was already read, so
  // reading without hidden entries would make the toggle silently do nothing.
  const { items, isLoading, isFetching, error, refetch } = useDirectory(pane.path, {
    includeHidden: showHiddenFiles || (search.open && search.filters.includeHidden),
    sort: pane.sort,
  })

  // Selection is scoped to a directory: leaving it must drop the selection, or
  // the status bar reports "1 selected" for an item no longer on screen while
  // the preview shows nothing. The mockup cleared `selectedId` on navigate for
  // the same reason.
  useEffect(() => {
    clearSelection(pane.id)
  }, [pane.path, pane.id, clearSelection])

  // Selecting reveals the preview if it was closed, as in the mockup. Driven by
  // the selection itself rather than the click handler, so keyboard and marquee
  // selection behave the same as a click.
  useEffect(() => {
    if (selected.size > 0 && !previewOpen) setPreviewOpen(true)
  }, [selected.size, previewOpen, setPreviewOpen])

  const operations = useFileOperations()

  const { active: searching, items: results, cancel: cancelSearch } = useSearch(
    pane.id,
    pane.path,
    items,
  )
  // Results replace the listing while a search is on. They are already ordered
  // by the backend's walk or the filter's input order; re-sorting a recursive
  // result set by name would scatter siblings across the list.
  const shown = searching ? results : items

  const handleActivate = (item: FileItem) => {
    if (item.broken) return
    onFocus()
    if (item.isDirectory) {
      navigate(pane.id, item.path)
    } else {
      void bridge.shell.openFile(item.path).catch((error: unknown) => {
        toast.error(
          `Could not open ${item.name}`,
          isFsError(error) ? describeFsError(error) : undefined,
        )
      })
    }
  }

  const handleRename = useCallback(
    (path: string, newName: string) => {
      void operations.rename(path, newName)
    },
    [operations],
  )

  const handleOperationKey = useOperationKeys({ paneId: pane.id, path: pane.path })

  return (
    <section
      aria-label={`Pane ${LETTERS[index] ?? index + 1}`}
      onMouseDown={onFocus}
      className="flex min-w-0 flex-col overflow-hidden"
    >
      <div
        className={`bg-elevated border-edge flex shrink-0 items-center gap-2 border-b px-2.5 py-1 text-[11px] ${
          isActive ? '' : 'opacity-60'
        }`}
      >
        {showLetter && (
          <span
            className={`font-display flex size-5 shrink-0 items-center justify-center rounded text-xs font-bold ${
              isActive ? 'text-accent bg-[var(--accent-glow)]' : 'text-muted bg-hover'
            }`}
          >
            {LETTERS[index] ?? index + 1}
          </span>
        )}

        <Breadcrumb path={pane.path} onNavigate={(path) => navigate(pane.id, path)} compact />

        {isFetching && !isLoading && <Loader2 size={11} className="text-muted animate-spin" />}
        <span className="text-muted shrink-0">{formatCount(items.length, 'item')}</span>
      </div>

      {search.open && <SearchBar paneId={pane.id} root={pane.path} />}
      {searching && (
        <SearchStatusBar search={search} resultCount={shown.length} onCancel={cancelSearch} />
      )}

      <div
        className="min-h-0 flex-1"
        // Bubble phase, deliberately: the inline rename editor stops
        // propagation, so Cmd+C and Delete reach the clipboard and the trash
        // only when the user is not in the middle of typing a name.
        onKeyDown={handleOperationKey}
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, var(--grid-dot) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      >
        {isLoading ? (
          <div className="text-muted flex h-full items-center justify-center gap-2 text-[13px]">
            <Loader2 size={16} className="animate-spin" />
            Reading folder…
          </div>
        ) : error ? (
          <DirectoryError error={error} onRetry={refetch} />
        ) : pane.viewMode === 'details' ? (
          <DetailsView
            paneId={pane.id}
            items={shown}
            sort={pane.sort}
            onSortChange={(sort) => setSort(pane.id, sort)}
            onActivate={handleActivate}
            onFocus={onFocus}
            onRename={handleRename}
          />
        ) : (
          <IconsView
            paneId={pane.id}
            mode={pane.viewMode}
            items={shown}
            onActivate={handleActivate}
            onFocus={onFocus}
            onRename={handleRename}
          />
        )}
      </div>
    </section>
  )
}
