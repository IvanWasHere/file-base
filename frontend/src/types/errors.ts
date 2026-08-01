/**
 * Typed filesystem errors (PRD "Error Handling").
 *
 * Go returns plain error strings; the bridge maps them to these codes so the UI
 * can react meaningfully — notably `permission-denied`, which on macOS usually
 * means a TCC consent prompt was declined rather than a real Unix permission
 * problem, and needs an "Open Privacy & Security" affordance, not a red toast.
 */

export type FsErrorCode =
  | 'permission-denied'
  | 'not-found'
  | 'already-exists'
  | 'not-a-directory'
  | 'directory-not-empty'
  | 'disk-unavailable'
  | 'broken-symlink'
  | 'no-space'
  | 'read-only'
  /** Rejected before touching the disk: empty, "..", or containing a "/". */
  | 'invalid-name'
  /** A refusal, not a failure: the file is past what the operation will handle. */
  | 'too-large'
  | 'cancelled'
  | 'unknown'

export class FsError extends Error {
  readonly code: FsErrorCode
  readonly path: string | undefined
  override readonly cause: unknown

  constructor(code: FsErrorCode, message: string, path?: string, cause?: unknown) {
    super(message)
    this.name = 'FsError'
    this.code = code
    this.path = path
    this.cause = cause
  }

  /** True when macOS privacy settings are the likely cause, not file modes. */
  get isPrivacyBlock(): boolean {
    return this.code === 'permission-denied'
  }
}

export function isFsError(value: unknown): value is FsError {
  return value instanceof FsError
}

/** User-facing copy. Kept out of components so it stays consistent. */
export function describeFsError(error: FsError): string {
  switch (error.code) {
    case 'permission-denied':
      return 'macOS blocked access to this location. Grant permission in Privacy & Security settings.'
    case 'not-found':
      return 'This item no longer exists.'
    case 'already-exists':
      return 'An item with that name already exists here.'
    case 'not-a-directory':
      return 'That path is not a folder.'
    case 'directory-not-empty':
      return 'This folder is not empty.'
    case 'disk-unavailable':
      return 'The disk is unavailable. It may have been ejected.'
    case 'broken-symlink':
      return 'This alias points to something that no longer exists.'
    case 'no-space':
      return 'Not enough space on the destination disk.'
    case 'read-only':
      return 'This location is read-only.'
    case 'too-large':
      return 'This file is too large to preview.'
    case 'invalid-name':
      // Go's message names the specific problem ("A name cannot contain "/"),
      // which is more useful than anything generic written here.
      return error.message || 'That name cannot be used.'
    case 'cancelled':
      return 'Cancelled.'
    case 'unknown':
      return error.message || 'Something went wrong.'
  }
}
