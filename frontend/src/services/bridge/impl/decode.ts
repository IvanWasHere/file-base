/**
 * Translation between the Go wire format and the frontend data model.
 *
 * Two things happen here and nowhere else:
 *
 *  1. Go's error strings become typed `FsError`s. Wails v2 delivers a returned
 *     Go error to JS as its `Error()` string, so backend/filesystem/errors.go
 *     encodes a JSON payload behind an `fs-error:` sentinel and this module
 *     decodes it. Without that, the UI would be matching on English prose.
 *
 *  2. Go's `FileItem` gains the fields Go deliberately does not compute —
 *     `id`, `extension` and `category` are presentation concerns (PRD: no UI
 *     decisions in Go).
 */

import type {
  FileChangeKind,
  FileItem,
  FileSystemEvent,
  OperationResult,
  SearchBatch,
  SearchDone,
} from '@/types/file'
import type { HashDone, HashProgress, HashResult } from '@/types/hashing'
import type { ArchiveDone, ArchiveProgress } from '@/types/archive'
import type { FsErrorCode } from '@/types/errors'
import { FsError } from '@/types/errors'
import type { ExternalDrop } from '../types'
import { normaliseTags } from '@/constants/tags'
import { categorize } from '@/utils/fileCategory'
import { extname } from '@/utils/path'
import type { filesystem } from '../../../../wailsjs/go/models'

const ERROR_PREFIX = 'fs-error:'

const KNOWN_CODES = new Set<string>([
  'password-required',
  'permission-denied',
  'not-found',
  'already-exists',
  'not-a-directory',
  'directory-not-empty',
  'disk-unavailable',
  'broken-symlink',
  'no-space',
  'read-only',
  'invalid-name',
  'too-large',
  'cancelled',
  'unknown',
])

interface WirePayload {
  code?: unknown
  path?: unknown
  message?: unknown
}

/** Converts anything thrown by a Wails call into an `FsError`. */
export function toFsError(thrown: unknown): FsError {
  const raw =
    typeof thrown === 'string' ? thrown : thrown instanceof Error ? thrown.message : String(thrown)

  if (!raw.startsWith(ERROR_PREFIX)) {
    return new FsError('unknown', raw || 'Unknown filesystem error', undefined, thrown)
  }

  let payload: WirePayload
  try {
    payload = JSON.parse(raw.slice(ERROR_PREFIX.length)) as WirePayload
  } catch {
    return new FsError('unknown', raw, undefined, thrown)
  }

  const code =
    typeof payload.code === 'string' && KNOWN_CODES.has(payload.code)
      ? (payload.code as FsErrorCode)
      : 'unknown'
  const message = typeof payload.message === 'string' ? payload.message : raw
  const path = typeof payload.path === 'string' && payload.path ? payload.path : undefined

  return new FsError(code, message, path, thrown)
}

/** Wraps a binding call so every rejection surfaces as a typed `FsError`. */
export async function guard<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (thrown) {
    throw toFsError(thrown)
  }
}

/** Adds the fields Go leaves to TypeScript: id, extension, category. */
export function toFileItem(wire: filesystem.FileItem): FileItem {
  const extension = wire.isDirectory ? '' : extname(wire.name)
  return {
    id: wire.path,
    path: wire.path,
    name: wire.name,
    extension,
    size: wire.size,
    isDirectory: wire.isDirectory,
    createdAt: wire.createdAt,
    modifiedAt: wire.modifiedAt,
    permissions: wire.permissions,
    hidden: wire.hidden,
    symlink: wire.symlink,
    // `exactOptionalPropertyTypes` forbids an explicit undefined, and Go sends
    // "" rather than omitting the field.
    ...(wire.symlinkTarget ? { symlinkTarget: wire.symlinkTarget } : {}),
    mimeType: wire.mimeType,
    category: categorize(extension, wire.isDirectory),
    broken: wire.broken,
    // Repaired, not trusted: tags come from an extended attribute any
    // application on the machine can write, and Go sends a nil slice as null
    // (§M22 decision 4).
    tags: normaliseTags(wire.tags),
  }
}

/** The Wails event name the watcher emits on; must match backend/watcher. */
export const watcherEvent = 'fs:change'

/** Must match backend/search. */
export const searchBatchEvent = 'search:batch'
export const searchDoneEvent = 'search:done'

/** Must match the OnFileDrop bridge in main.go. */
export const fileDropEvent = 'files:dropped'

/** Must match backend/appmenu. */
export const menuCommandEvent = 'menu:command'

/** Validates a Finder drop. A payload with no paths is nothing to act on. */
export function toExternalDrop(payload: unknown): ExternalDrop | null {
  if (typeof payload !== 'object' || payload === null) return null
  const wire = payload as Record<string, unknown>

  const paths = Array.isArray(wire.paths)
    ? wire.paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
    : []
  if (paths.length === 0) return null

  return { x: numberOr(wire.x, 0), y: numberOr(wire.y, 0), paths }
}

/**
 * Validates a streamed result batch.
 *
 * As with watcher events, an event payload arrives untyped. A batch missing its
 * id would be routed to no search at all, so it is dropped rather than guessed.
 */
export function toSearchBatch(payload: unknown): SearchBatch | null {
  if (typeof payload !== 'object' || payload === null) return null
  const wire = payload as Record<string, unknown>
  if (typeof wire.id !== 'string' || !wire.id) return null

  const items = Array.isArray(wire.items)
    ? wire.items.map((item) => toFileItem(item as filesystem.FileItem))
    : []

  return { id: wire.id, items, scanned: numberOr(wire.scanned, 0) }
}

export function toSearchDone(payload: unknown): SearchDone | null {
  if (typeof payload !== 'object' || payload === null) return null
  const wire = payload as Record<string, unknown>
  if (typeof wire.id !== 'string' || !wire.id) return null

  return {
    id: wire.id,
    scanned: numberOr(wire.scanned, 0),
    matched: numberOr(wire.matched, 0),
    truncated: wire.truncated === true,
    cancelled: wire.cancelled === true,
    error: typeof wire.error === 'string' ? wire.error : '',
  }
}

/** Must match backend/hashing. */
export const hashResultEvent = 'hash:result'
export const hashProgressEvent = 'hash:progress'
export const hashDoneEvent = 'hash:done'

/**
 * Validates one file's digest.
 *
 * A failed row carries the same `fs-error:` envelope a rejected call would, so
 * it decodes through `toFsError` and reaches the UI as a typed error rather than
 * as Go's prose — which is the whole point of M14 decision 7: permission denied
 * on one file must be *that* failure on *that* row, not a dead batch.
 */
export function toHashResult(payload: unknown): HashResult | null {
  if (typeof payload !== 'object' || payload === null) return null
  const wire = payload as Record<string, unknown>
  if (typeof wire.id !== 'string' || !wire.id) return null
  if (typeof wire.path !== 'string' || !wire.path) return null

  const raw = typeof wire.error === 'string' ? wire.error : ''
  return {
    id: wire.id,
    path: wire.path,
    digest: typeof wire.digest === 'string' ? wire.digest : '',
    bytes: numberOr(wire.bytes, 0),
    // `exactOptionalPropertyTypes` forbids an explicit undefined here.
    ...(raw ? { error: toFsError(raw) } : {}),
  }
}

export function toHashProgress(payload: unknown): HashProgress | null {
  if (typeof payload !== 'object' || payload === null) return null
  const wire = payload as Record<string, unknown>
  if (typeof wire.id !== 'string' || !wire.id) return null
  if (typeof wire.path !== 'string' || !wire.path) return null

  return {
    id: wire.id,
    path: wire.path,
    bytesRead: numberOr(wire.bytesRead, 0),
    total: numberOr(wire.total, 0),
  }
}

export function toHashDone(payload: unknown): HashDone | null {
  if (typeof payload !== 'object' || payload === null) return null
  const wire = payload as Record<string, unknown>
  if (typeof wire.id !== 'string' || !wire.id) return null

  return {
    id: wire.id,
    completed: numberOr(wire.completed, 0),
    failed: numberOr(wire.failed, 0),
    cancelled: wire.cancelled === true,
  }
}

/** Must match backend/archive. */
export const archiveProgressEvent = 'archive:progress'
export const archiveDoneEvent = 'archive:done'

export function toArchiveProgress(payload: unknown): ArchiveProgress | null {
  if (typeof payload !== 'object' || payload === null) return null
  const wire = payload as Record<string, unknown>
  if (typeof wire.id !== 'string' || !wire.id) return null

  return {
    id: wire.id,
    entry: typeof wire.entry === 'string' ? wire.entry : '',
    done: numberOr(wire.done, 0),
    total: numberOr(wire.total, 0),
  }
}

/**
 * A failed job carries the same `fs-error:` envelope a rejected call would, so
 * `password-required` arrives as a typed code the caller can branch on rather
 * than as prose it would have to match against.
 */
export function toArchiveDone(payload: unknown): ArchiveDone | null {
  if (typeof payload !== 'object' || payload === null) return null
  const wire = payload as Record<string, unknown>
  if (typeof wire.id !== 'string' || !wire.id) return null

  const raw = typeof wire.error === 'string' ? wire.error : ''
  return {
    id: wire.id,
    path: typeof wire.path === 'string' ? wire.path : '',
    entries: numberOr(wire.entries, 0),
    bytes: numberOr(wire.bytes, 0),
    cancelled: wire.cancelled === true,
    ...(raw ? { error: toFsError(raw) } : {}),
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

const CHANGE_KINDS = new Set<string>(['create', 'write', 'remove', 'rename', 'chmod'])

/**
 * Validates a watcher payload.
 *
 * Unlike a bound method call, an event arrives untyped — Wails hands the
 * callback whatever was emitted. A malformed payload returns null and is
 * dropped rather than invalidating `undefined` and refetching the whole cache.
 */
export function toFileSystemEvent(payload: unknown): FileSystemEvent | null {
  if (typeof payload !== 'object' || payload === null) return null
  const wire = payload as Record<string, unknown>

  if (typeof wire.dir !== 'string' || !wire.dir) return null

  const kinds = Array.isArray(wire.kinds)
    ? wire.kinds.filter((kind): kind is FileChangeKind =>
        typeof kind === 'string' && CHANGE_KINDS.has(kind),
      )
    : []
  const paths = Array.isArray(wire.paths)
    ? wire.paths.filter((path): path is string => typeof path === 'string')
    : []

  return { dir: wire.dir, kinds, paths, gone: wire.gone === true }
}

/**
 * Flattens Go's `OpResult` into a plain `OperationResult`.
 *
 * The two are structurally identical, but Wails hands back class instances, and
 * a Zustand/React Query cache holding class instances compares and serialises
 * differently from the plain objects the mock bridge returns. The slice
 * defaults guard the null a nil Go slice would produce.
 */
export function toOperationResult(wire: filesystem.OpResult): OperationResult {
  return {
    succeeded: (wire.succeeded ?? []).map((moved) => ({
      source: moved.source,
      target: moved.target,
    })),
    conflicts: wire.conflicts ?? [],
    failures: (wire.failures ?? []).map((failure) => ({
      path: failure.path,
      message: failure.message,
    })),
  }
}
