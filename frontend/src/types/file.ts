/**
 * Core filesystem data model (PLAN.md §1).
 *
 * `id` is the absolute path: unlike the mockup's numeric `parentId` tree, a real
 * filesystem has no stable numeric identity, and paths are unique per-volume.
 */

export type FileCategory =
  'folder' | 'image' | 'document' | 'code' | 'music' | 'video' | 'archive' | 'data' | 'default'

export interface FileItem {
  /** Absolute path. Identity for React keys, selection sets and the DB. */
  id: string
  path: string
  name: string
  /** Lowercase, without the dot. Empty string for extensionless files. */
  extension: string
  size: number
  isDirectory: boolean
  /** Unix epoch milliseconds. */
  createdAt: number
  modifiedAt: number
  /** Unix mode string as rendered by Go, e.g. "-rw-r--r--". */
  permissions: string
  hidden: boolean
  symlink: boolean
  symlinkTarget?: string
  mimeType: string
  /** Derived in TypeScript from extension/mimeType — never sent by Go. */
  category: FileCategory
  /**
   * The entry exists but could not be stat'd — a dangling symlink, or a volume
   * that went away. Still listed, so the UI can show it as unavailable rather
   * than silently dropping it.
   */
  broken: boolean
}

/** A mounted volume, for the sidebar's Drives section. */
export interface Volume {
  name: string
  path: string
  totalBytes: number
  freeBytes: number
  removable: boolean
  /** True for the boot volume ("/"). */
  root: boolean
}

/** Well-known locations, resolved natively rather than string-built in TS. */
export interface StandardPaths {
  home: string
  desktop: string
  documents: string
  downloads: string
  applications: string
  movies: string
  music: string
  pictures: string
  trash: string
}

export interface ReadDirectoryOptions {
  includeHidden: boolean
  followSymlinks: boolean
}

/** How a copy/move resolves a name collision. Decided in TS, applied in Go. */
export type ConflictPolicy = 'replace' | 'skip' | 'keep-both' | 'fail'

export interface OperationResult {
  succeeded: string[]
  /** Paths that collided, when the policy was 'fail'. */
  conflicts: string[]
  failures: { path: string; message: string }[]
}

/** Emitted by the Go watcher; consumed by the React Query invalidator (M7). */
export interface FileSystemEvent {
  type: 'create' | 'write' | 'remove' | 'rename' | 'chmod'
  path: string
  /** Directory the change occurred in — the React Query key to invalidate. */
  dir: string
}
