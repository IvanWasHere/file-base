/**
 * The hashing wire model (PLAN.md M14).
 *
 * Shaped like M8's search rather than like a file operation: a checksum over a
 * selection has unbounded duration, results that should appear as they land, and
 * a user who closes the window meaning *stop*. So the request resolves to an id
 * and everything else arrives as events.
 */

import type { FsError } from '@/types/errors'
import type { HashAlgorithm } from '@/constants/hashAlgorithms'

/** One job: a set of files and the single algorithm to run over them. */
export interface HashRequest {
  paths: string[]
  algorithm: HashAlgorithm
}

/**
 * One file's outcome. Exactly one arrives per path that was not cancelled — a
 * digest or an error, never both. A cancelled read produces neither: the job's
 * completion says what happened, once.
 */
export interface HashResult {
  id: string
  path: string
  /** Lowercase hex, exactly as a published checksum is written. */
  digest: string
  /** What was actually read, so a row's bar can finish on the same number. */
  bytes: number
  /** Present only on failure, decoded through the same path as every FsError. */
  error?: FsError
}

/** One file mid-read. Progress is bytes, not files — see M14 decision 5. */
export interface HashProgress {
  id: string
  path: string
  bytesRead: number
  /** The size when the file was opened; a file can grow while it is read. */
  total: number
}

/** Emitted exactly once per job. */
export interface HashDone {
  id: string
  completed: number
  failed: number
  cancelled: boolean
}
