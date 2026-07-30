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

import type { FileItem } from '@/types/file'
import type { FsErrorCode } from '@/types/errors'
import { FsError } from '@/types/errors'
import { categorize } from '@/utils/fileCategory'
import { extname } from '@/utils/path'
import type { filesystem } from '../../../../wailsjs/go/models'

const ERROR_PREFIX = 'fs-error:'

const KNOWN_CODES = new Set<string>([
  'permission-denied',
  'not-found',
  'already-exists',
  'not-a-directory',
  'directory-not-empty',
  'disk-unavailable',
  'broken-symlink',
  'no-space',
  'read-only',
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
  }
}
