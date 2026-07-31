import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { directoryQuery } from '@/services/filesystem/queries'
import { DEFAULT_SORT, sortItems, type SortSpec } from '@/services/filesystem/sort'
import { acquireWatch } from '@/services/filesystem/watch'
import type { FileItem } from '@/types/file'
import { isFsError, type FsError } from '@/types/errors'

export interface UseDirectoryOptions {
  includeHidden?: boolean
  sort?: SortSpec
  /**
   * Whether to keep a live watch on the directory. On by default: this hook is
   * the single read path, so hanging the watch here means every consumer is
   * counted and nothing has to remember to subscribe.
   */
  watch?: boolean
}

export interface UseDirectoryResult {
  items: FileItem[]
  isLoading: boolean
  isFetching: boolean
  error: FsError | null
  refetch: () => void
}

/**
 * Reads a directory and applies ordering.
 *
 * Sorting is memoised separately from fetching so changing the sort re-orders
 * the cached array without touching the disk.
 */
export function useDirectory(path: string, options: UseDirectoryOptions = {}): UseDirectoryResult {
  const { includeHidden = false, sort = DEFAULT_SORT, watch = true } = options

  const query = useQuery(directoryQuery(path, includeHidden))

  // Reference-counted, so the three hooks reading one pane's directory — and
  // two panes showing the same folder — share a single backend watch.
  useEffect(() => {
    if (!watch || !path) return
    return acquireWatch(path)
  }, [path, watch])

  const error = isFsError(query.error) ? query.error : null

  // An errored read reports no items, even though React Query still holds the
  // last successful listing. Callers replace the listing with an error panel in
  // that case, so keeping the old array alive only let the header and status
  // bar go on counting rows nobody can see — a folder deleted underneath a pane
  // read "803 items" beside "This item no longer exists".
  const items = useMemo(
    () => (query.data && !error ? sortItems(query.data, sort) : []),
    [query.data, sort, error],
  )

  return {
    items,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error,
    refetch: () => void query.refetch(),
  }
}
