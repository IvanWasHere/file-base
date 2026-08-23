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

import type { FileTag } from '@/constants/tags'
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
import type { HashDone, HashProgress, HashRequest, HashResult } from '@/types/hashing'
import type {
  ArchiveDone,
  ArchiveProgress,
  CreateRequest,
  ExtractRequest,
} from '@/types/archive'

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
  /**
   * Creates a file, optionally with content.
   *
   * The only way anything here puts bytes on disk, and deliberately not a write
   * API: it creates or it fails, and can never truncate a file that already
   * exists (M15 decision 3). `executable` is passed in the same call rather than
   * chmod'd afterwards, so a shell script is never briefly unrunnable.
   */
  createFile(
    parent: string,
    name: string,
    content?: string,
    executable?: boolean,
  ): Promise<FileItem>
  rename(path: string, newName: string): Promise<FileItem>
  move(sources: string[], destDir: string, policy: ConflictPolicy): Promise<OperationResult>
  copy(sources: string[], destDir: string, policy: ConflictPolicy): Promise<OperationResult>
  /** Resolves to where each item landed, which is what undo replays. */
  trash(paths: string[]): Promise<TrashedItem[]>
  /** Permanent, unrecoverable delete. Always confirmed in the UI first. */
  delete(paths: string[]): Promise<void>
  /**
   * Replaces the Finder tags on every path with `tags` (§M22).
   *
   * Replaces rather than merges, because the picker shows the union of the
   * selection and lets it be edited — a merge would make unticking impossible.
   * Reading them needs no method: every `FileItem` already carries its tags.
   */
  setTags(paths: string[], tags: FileTag[]): Promise<void>
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
  /**
   * Picks from the native macOS menu, as raw command-id strings.
   *
   * Deliberately untyped here: `MenuCommandId` is a UI constant, and the bridge
   * describes the wire, not the vocabulary. The consumer validates before
   * dispatching, which is also what protects against an id from a stale build.
   * Returns an unsubscribe function.
   */
  onMenuCommand(handler: (id: string) => void): () => void
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

export interface HashHandlers {
  onResult: (result: HashResult) => void
  onProgress: (progress: HashProgress) => void
  onDone: (done: HashDone) => void
}

/**
 * Checksums (M14), shaped like `SearchApi` for the same reasons: the work is
 * unbounded, the answers should appear as they land, and closing the window has
 * to stop it rather than leave it reading a disk image nobody is waiting for.
 *
 * Digests cross as hex strings. A Go []byte marshals to a JSON array of numbers,
 * which M10 learned the hard way, and hex is the form a published checksum is
 * written in anyway.
 */
export interface HashApi {
  /** Starts a job and resolves to its id; digests arrive on the subscription. */
  hash(request: HashRequest): Promise<string>
  cancel(id: string): Promise<void>
  /** Returns an unsubscribe function. */
  subscribe(handlers: HashHandlers): () => void
}

export interface ArchiveHandlers {
  onProgress: (progress: ArchiveProgress) => void
  onDone: (done: ArchiveDone) => void
}

/**
 * Archives (M18), shaped like `SearchApi` and `HashApi` for the same reasons:
 * unbounded work, answers that should appear as they land, and a window that
 * can be closed meaning stop.
 *
 * `newMount` and `releaseMount` are the temp-folder half. Reference counting
 * lives in TypeScript, as M7's watch counts do — Go takes idempotent primitives
 * and knows nothing about panes.
 */
export interface ArchiveApi {
  /** Starts an extraction and resolves to its id. */
  extract(request: ExtractRequest): Promise<string>
  /** Starts a compression and resolves to its id. */
  create(request: CreateRequest): Promise<string>
  cancel(id: string): Promise<void>
  /** Creates the temp folder a browsed archive is extracted into. */
  newMount(archivePath: string): Promise<string>
  /** Removes one. Refuses any path it did not create. */
  releaseMount(mountPath: string): Promise<void>
  /** Returns an unsubscribe function. */
  subscribe(handlers: ArchiveHandlers): () => void
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
  hashing: HashApi
  archives: ArchiveApi
}
