import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { AppProviders } from '@/app/providers/AppProviders'
import { ExplorerPane } from '@/features/explorer/ExplorerPane'
import { standardPathsQuery } from '@/services/filesystem/queries'
import { DirectoryError } from '@/components/common/DirectoryError'
import { isFsError } from '@/types/errors'

/**
 * M1 shell. The tab bar, toolbar, sidebar, preview and status bar from the
 * mockup arrive in M2/M3; this is the vertical slice that proves the whole
 * stack — Go → bindings → bridge → React Query → view — actually works.
 */
function Explorer() {
  const { data: paths, isLoading, error, refetch } = useQuery(standardPathsQuery())

  if (isLoading) {
    return (
      <div className="text-muted flex h-full items-center justify-center gap-2 text-[13px]">
        <Loader2 size={16} className="animate-spin" />
        Starting…
      </div>
    )
  }

  if (error || !paths) {
    return isFsError(error) ? (
      <DirectoryError error={error} onRetry={() => void refetch()} />
    ) : (
      <div className="text-muted flex h-full items-center justify-center text-[13px]">
        Could not resolve the home directory.
      </div>
    )
  }

  return <ExplorerPane initialPath={paths.home} />
}

export function App() {
  return (
    <AppProviders>
      <div className="bg-deep text-primary flex h-screen flex-col">
        {/* Padded clear of the traffic lights — the window uses a hidden-inset
            title bar, and M2 puts the tab bar in this strip. */}
        <header
          className="border-edge bg-deep flex shrink-0 items-center border-b px-3"
          style={{ height: 40, paddingLeft: 78 }}
        >
          <span className="font-display text-secondary text-xs font-semibold tracking-tight">
            Files
          </span>
        </header>

        <main className="flex min-h-0 flex-1">
          <Explorer />
        </main>
      </div>
    </AppProviders>
  )
}
