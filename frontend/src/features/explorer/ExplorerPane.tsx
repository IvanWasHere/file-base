import { ChevronRight, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { DetailsView } from '@/components/explorer/DetailsView'
import { DirectoryError } from '@/components/common/DirectoryError'
import { useDirectory } from '@/hooks/useDirectory'
import { bridge } from '@/services/bridge'
import type { FileItem } from '@/types/file'
import { formatCount } from '@/utils/format'
import { toSegments } from '@/utils/path'

/**
 * M1 vertical slice: one pane, real filesystem, Details view.
 *
 * Path is local state here on purpose — history, tabs and splits arrive in M3
 * with `workspaceStore`, and inventing half of that now would only be undone.
 */
export function ExplorerPane({ initialPath }: { initialPath: string }) {
  const [path, setPath] = useState(initialPath)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const { items, isLoading, isFetching, error, refetch } = useDirectory(path)
  const segments = toSegments(path)

  const navigate = (next: string) => {
    setPath(next)
    setSelectedPath(null)
  }

  const activate = (item: FileItem) => {
    if (item.broken) return
    if (item.isDirectory) {
      navigate(item.path)
    } else {
      void bridge.shell.openFile(item.path).catch(() => {
        // M6 replaces this with the toast surface; a failed open must not throw
        // an unhandled rejection in the meantime.
      })
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="bg-elevated border-edge text-muted flex items-center gap-1 border-b px-3 py-1 text-[11px]">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1">
          {segments.map((segment, index) => (
            <span key={segment.path} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight size={10} className="shrink-0 opacity-60" />}
              <button
                type="button"
                onClick={() => navigate(segment.path)}
                className={`hover:text-accent truncate transition-colors ${
                  index === segments.length - 1 ? 'text-primary font-medium' : 'text-secondary'
                }`}
              >
                {segment.name}
              </button>
            </span>
          ))}
        </nav>

        {isFetching && !isLoading && <Loader2 size={11} className="animate-spin" />}
        <span className="shrink-0">{formatCount(items.length, 'item')}</span>
      </div>

      <div
        className="flex-1 overflow-auto"
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
        ) : (
          <DetailsView
            items={items}
            selectedPath={selectedPath}
            onSelect={(item) => setSelectedPath(item.path)}
            onActivate={activate}
          />
        )}
      </div>
    </div>
  )
}
