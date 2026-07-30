/**
 * React Query bindings for the filesystem (PLAN.md §1, rule 2).
 *
 * Directory contents are server state, not UI state, so they live in the query
 * cache rather than Zustand. The payoff arrives with split panes: two panes
 * showing the same folder share one cache entry and one read, and the M7
 * watcher invalidates by key without knowing which panes are open.
 */

import { queryOptions } from '@tanstack/react-query'
import { bridge } from '@/services/bridge'
import type { FileItem, StandardPaths, Volume } from '@/types/file'

export const fsKeys = {
  all: ['fs'] as const,
  directory: (path: string, includeHidden: boolean) =>
    [...fsKeys.all, 'dir', path, { includeHidden }] as const,
  /** Matches every variant of a directory, whatever the hidden-files setting. */
  directoryRoot: (path: string) => [...fsKeys.all, 'dir', path] as const,
  info: (path: string) => [...fsKeys.all, 'info', path] as const,
  volumes: () => [...fsKeys.all, 'volumes'] as const,
  standardPaths: () => [...fsKeys.all, 'standardPaths'] as const,
}

export function directoryQuery(path: string, includeHidden: boolean) {
  return queryOptions<FileItem[]>({
    queryKey: fsKeys.directory(path, includeHidden),
    queryFn: () => bridge.fs.readDirectory(path, { includeHidden }),
    enabled: path.length > 0,
  })
}

export function fileInfoQuery(path: string) {
  return queryOptions<FileItem>({
    queryKey: fsKeys.info(path),
    queryFn: () => bridge.fs.readFileInfo(path),
    enabled: path.length > 0,
  })
}

export function volumesQuery() {
  return queryOptions<Volume[]>({
    queryKey: fsKeys.volumes(),
    queryFn: () => bridge.fs.listVolumes(),
    // Mounting and ejecting is rare; M7 refreshes this on watcher events.
    staleTime: 60_000,
  })
}

export function standardPathsQuery() {
  return queryOptions<StandardPaths>({
    queryKey: fsKeys.standardPaths(),
    queryFn: () => bridge.fs.standardPaths(),
    // Home, Desktop and friends cannot move while the app is running.
    staleTime: Infinity,
  })
}
