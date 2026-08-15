/**
 * Recognising a temp mount by its path alone (PLAN.md §M18 decision 9).
 *
 * Separate from `mountRegistry` on purpose: the session is parsed at startup,
 * before any mount exists, so the registry has nothing to say. What is left is
 * the shape of the path itself — the app's own prefix inside a temp directory —
 * which is enough to know that a stored pane pointed inside an extraction that
 * has since been swept.
 *
 * The prefix must match `mountPrefix` in `backend/archive`, and
 * `TestMountPrefixMatchesFrontend` reads this file to make sure it does.
 */

export const MOUNT_PREFIX = 'file-base-mount-'

/**
 * If `path` is inside a mount, the folder to restore to instead: the archive's
 * own directory, which is the closest real place the user was.
 *
 * The mount looks like `…/file-base-mount-XXXX/Photos.zip/inner/dir`, and the
 * archive it came from is not knowable from the temp path — so this returns the
 * *parent of the mount root*, which is a real directory that still exists.
 */
export function isInsideAnyMount(path: string): string | null {
  const segments = path.split('/')
  const index = segments.findIndex((segment) => segment.startsWith(MOUNT_PREFIX))
  if (index === -1) return null

  const above = segments.slice(0, index).join('/')
  return above || '/'
}
