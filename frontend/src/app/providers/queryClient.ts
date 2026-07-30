import { QueryClient } from '@tanstack/react-query'

/**
 * React Query holds server state — and here the "server" is the filesystem
 * (PLAN.md §1, rule 2). Directory contents are cached under ['dir', path] so
 * two split panes showing the same folder share one entry and one read.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The watcher (M7) invalidates precisely; polling would be wasteful.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: 30_000,
        retry: false,
      },
    },
  })
}
