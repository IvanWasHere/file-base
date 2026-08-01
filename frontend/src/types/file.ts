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

/**
 * Where one item ended up.
 *
 * Both halves are reported because neither can be derived from the other: a
 * keep-both resolution renames the item, and a batch containing skips cannot be
 * zipped back against its input. Undo replays this pairing.
 */
export interface MovedItem {
  source: string
  target: string
}

export interface OperationResult {
  succeeded: MovedItem[]
  /** Paths that collided, when the policy was 'fail'. */
  conflicts: string[]
  failures: { path: string; message: string }[]
}

/**
 * Where a trashed item came from and where it landed.
 *
 * macOS keeps its own Put Back mapping in metadata the backend does not write,
 * so the mapping is returned instead — it is what "Undo Move to Trash" replays.
 */
export interface TrashedItem {
  originalPath: string
  trashPath: string
}

/** What a search is looking for. Assembled in TS, applied during the Go walk. */
export interface SearchCriteria {
  /** Case-insensitive substring of the name. Empty matches everything. */
  query: string
  root: string
  /** Lowercase, without the dot. Empty means any. */
  extensions: string[]
  kind: 'any' | 'file' | 'folder'
  /** Zero means unbounded, on all four. */
  minSize: number
  maxSize: number
  modifiedAfter: number
  modifiedBefore: number
  includeHidden: boolean
  maxResults: number
}

/** Results as they stream in. */
export interface SearchBatch {
  id: string
  items: FileItem[]
  /** Entries visited so far — what makes a long search look alive. */
  scanned: number
}

/** Emitted exactly once per search. */
export interface SearchDone {
  id: string
  scanned: number
  matched: number
  /** The result cap was hit; there are more matches than were returned. */
  truncated: boolean
  cancelled: boolean
  /** Set only when the walk could not start at all. */
  error: string
}

export type FileChangeKind = 'create' | 'write' | 'remove' | 'rename' | 'chmod'

/**
 * A coalesced batch of changes in one directory, emitted by the Go watcher and
 * consumed by the React Query invalidator.
 *
 * Directory-level rather than per-file on purpose: the backend collapses a burst
 * — an archive extracting, a build writing output — into a single batch per
 * quiet window, because the frontend invalidates by directory and one event per
 * syscall would be thousands of refetches for one user action.
 */
export interface FileSystemEvent {
  /** The directory whose contents changed — the query key to invalidate. */
  dir: string
  /** The distinct operations seen in this window. */
  kinds: FileChangeKind[]
  /** Entries seen changing. Capped by the backend; diagnostic, not exhaustive. */
  paths: string[]
  /** `dir` itself was removed or renamed away. */
  gone: boolean
}
