/**
 * The bridge contract — the complete surface the frontend may use to reach
 * native capability. Both implementations under ./impl satisfy it:
 *
 *   impl/wails.ts  real Wails bindings (the app)
 *   impl/mock.ts   in-memory filesystem (Vitest, Playwright, browser dev)
 *
 * No file outside ./impl may import from `wailsjs/` — enforced by ESLint. That
 * keeps a future Wails v3 migration confined to one directory, and lets the
 * entire UI run without a Go process.
 *
 * Method signatures mirror PLAN.md §1. Note what is absent: no sort, no filter,
 * no search-result ranking, no navigation. Go decides nothing.
 */

import type {
  ConflictPolicy,
  FileItem,
  FileSystemEvent,
  OperationResult,
  ReadDirectoryOptions,
  SearchBatch,
  SearchCriteria,
  SearchDone,
  StandardPaths,
  TrashedItem,
  Volume,
} from '@/types/file'

export interface FilesystemApi {
  readDirectory(path: string, options?: Partial<ReadDirectoryOptions>): Promise<FileItem[]>
  readFileInfo(path: string): Promise<FileItem>
  /** Text preview. `maxBytes` guards against opening a 2GB log file. */
  readTextFile(path: string, maxBytes: number): Promise<string>
  /** Base64 image preview, same guard. */
  readFileBase64(path: string, maxBytes: number): Promise<string>
  listVolumes(): Promise<Volume[]>
  standardPaths(): Promise<StandardPaths>
  exists(path: string): Promise<boolean>
  /**
   * Describes many paths in one call. The search index stores paths, not
   * metadata, so its hits must be stat'd before they can be rendered.
   * Paths that no longer exist are omitted.
   */
  readFileInfos(paths: string[]): Promise<FileItem[]>

  createFolder(parent: string, name: string): Promise<FileItem>
  createFile(parent: string, name: string): Promise<FileItem>
  rename(path: string, newName: string): Promise<FileItem>
  move(sources: string[], destDir: string, policy: ConflictPolicy): Promise<OperationResult>
  copy(sources: string[], destDir: string, policy: ConflictPolicy): Promise<OperationResult>
  /** Resolves to where each item landed, which is what undo replays. */
  trash(paths: string[]): Promise<TrashedItem[]>
  /** Permanent, unrecoverable delete. Always confirmed in the UI first. */
  delete(paths: string[]): Promise<void>
}

export interface SearchHandlers {
  onBatch: (batch: SearchBatch) => void
  onDone: (done: SearchDone) => void
}

export interface SearchApi {
  /** Starts a walk and resolves to its id; results arrive on the subscription. */
  find(criteria: SearchCriteria): Promise<string>
  cancel(id: string): Promise<void>
  /** Returns an unsubscribe function. */
  subscribe(handlers: SearchHandlers): () => void
}

export interface WatcherApi {
  watch(path: string): Promise<void>
  unwatch(path: string): Promise<void>
  /** Returns an unsubscribe function. */
  subscribe(handler: (event: FileSystemEvent) => void): () => void
}

/** Files dragged in from Finder, with where they landed in the window. */
export interface ExternalDrop {
  /** Window coordinates, for finding which pane was under the pointer. */
  x: number
  y: number
  paths: string[]
}

export interface DesktopApi {
  /** Returns an unsubscribe function. */
  onFileDrop(handler: (drop: ExternalDrop) => void): () => void
}

export interface ShellApi {
  openFile(path: string): Promise<void>
  revealInFinder(path: string): Promise<void>
  openWith(path: string, appPath: string): Promise<void>
}

export interface DialogOptions {
  title: string
  message: string
  detail?: string
  buttons: string[]
  defaultButton?: string
  type?: 'info' | 'warning' | 'error' | 'question'
}

export interface DialogsApi {
  openDirectory(title: string, defaultDir?: string): Promise<string | null>
  save(title: string, defaultName?: string): Promise<string | null>
  /** Resolves to the label of the button the user pressed. */
  message(options: DialogOptions): Promise<string>
}

/** A single statement in a transaction batch. */
export interface Statement {
  sql: string
  args: SqlValue[]
}

export type SqlValue = string | number | boolean | null | Uint8Array

export interface ExecResult {
  rowsAffected: number
  lastInsertId: number
}

/**
 * Deliberately generic: Go owns the SQLite driver, TypeScript owns the schema,
 * migrations and every query (PLAN.md §0). Repositories live in services/db.
 */
export interface DatabaseApi {
  query<T = Record<string, SqlValue>>(sql: string, args?: SqlValue[]): Promise<T[]>
  exec(sql: string, args?: SqlValue[]): Promise<ExecResult>
  transaction(statements: Statement[]): Promise<void>
}

export interface ThumbsApi {
  /**
   * Renders a thumbnail and returns it as a `data:` URL, ready for an `img`
   * `src`. Caching by path + mtime is a TS concern (services/thumbs).
   *
   * A URL rather than bytes because Wails marshals a Go []byte to a JSON number
   * array — four times the size — and because the caller would otherwise have
   * to guess whether it received PNG or JPEG.
   */
  generate(path: string, size: number): Promise<string>
}

export interface Bridge {
  fs: FilesystemApi
  search: SearchApi
  watcher: WatcherApi
  desktop: DesktopApi
  shell: ShellApi
  dialogs: DialogsApi
  db: DatabaseApi
  thumbs: ThumbsApi
}
