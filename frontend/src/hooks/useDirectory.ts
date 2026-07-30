import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { directoryQuery } from '@/services/filesystem/queries'
import { DEFAULT_SORT, sortItems, type SortSpec } from '@/services/filesystem/sort'
import type { FileItem } from '@/types/file'
import { isFsError, type FsError } from '@/types/errors'

export interface UseDirectoryOptions {
  includeHidden?: boolean
  sort?: SortSpec
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
  const { includeHidden = false, sort = DEFAULT_SORT } = options

  const query = useQuery(directoryQuery(path, includeHidden))

  const items = useMemo(() => (query.data ? sortItems(query.data, sort) : []), [query.data, sort])

  return {
    items,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: isFsError(query.error) ? query.error : null,
    refetch: () => void query.refetch(),
  }
}
