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
  /** A batch stat of an arbitrary set — the selection, in M14's case. */
  infos: (paths: readonly string[]) => [...fsKeys.all, 'infos', [...paths].sort()] as const,
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

/**
 * Describes many paths in one call. Paths that no longer exist are omitted,
 * which is how a caller learns what went away while it was not looking.
 *
 * `staleTime: 0` on purpose: a checksum is about the bytes on disk right now,
 * and a cached size or mtime would key the digest cache to a file that has
 * since changed.
 */
export function fileInfosQuery(paths: readonly string[]) {
  return queryOptions<FileItem[]>({
    queryKey: fsKeys.infos(paths),
    queryFn: () => bridge.fs.readFileInfos([...paths]),
    enabled: paths.length > 0,
    staleTime: 0,
    gcTime: 0,
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
