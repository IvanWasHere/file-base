/**
 * The archive wire model (PLAN.md §M18).
 *
 * Shaped like M8's search and M14's hashing: an id back immediately, progress
 * as events, and cancellation that stops the work rather than letting it
 * outlive the window that asked for it.
 */

import type { FsError } from '@/types/errors'

export interface ExtractRequest {
  path: string
  destination: string
  password: string
  /** Bounds a browse mount. Zero is unbounded, which is what Uncompress uses. */
  maxBytes: number
  maxEntries: number
  /** Strips the write bits, so a mount cannot be edited then reclaimed. */
  readOnly: boolean
  /** Moves a lone top-level entry up, so `report.pdf.zip` has no wrapper. */
  collapseRoot: boolean
}

export interface CreateRequest {
  sources: string[]
  destination: string
  format: string
  level: number
  /** WinZip AES-256, and refused for anything but zip. */
  password: string
  /** Rolls the output into `.001`, `.002`… past this many bytes. 0 = one file. */
  splitBytes: number
}

/** One job mid-flight. `total` is 0 when the format cannot know it yet. */
export interface ArchiveProgress {
  id: string
  entry: string
  done: number
  total: number
}

/** Emitted exactly once per job. */
export interface ArchiveDone {
  id: string
  /** Where the result landed — the extraction root, or the archive written. */
  path: string
  entries: number
  bytes: number
  cancelled: boolean
  /**
   * Present only on failure. `password-required` is the one the caller reacts
   * to by prompting rather than reporting.
   */
  error?: FsError
}
