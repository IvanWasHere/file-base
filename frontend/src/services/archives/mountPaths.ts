/**
 * Recognising a temp mount by its path alone (PLAN.md §M18 decision 9).
 *
 * Separate from `mountRegistry` on purpose: the session is parsed at startup,
 * before any mount exists, so the registry has nothing to say. What is left is
 * the shape of the path itself — a path segment carrying the app's own prefix —
 * which is enough to know that a stored pane pointed inside an extraction that
 * has since been reclaimed.
 *
 * The prefix must match `mountPrefix` in `backend/archive`, and
 * `TestMountPrefixMatchesFrontend` reads this file to make sure it does.
 */

export const MOUNT_PREFIX = '.file-base-mount-'

/**
 * If `path` is inside a mount, the folder to restore to instead: the archive's
 * own directory, which is the closest real place the user was.
 *
 * The mount looks like `…/.file-base-mount-<hash>/Photos.zip/inner/dir`, so the
 * *parent of the mount root* is the answer. Since §M21 that is exactly the
 * folder the archive is in, rather than an approximation of it — a mount is
 * made beside its archive, so restoring lands the pane where the user actually
 * was. The system temp directory is still the fallback location, and there the
 * parent is all there is to go on, which is what it always was.
 */
export function isInsideAnyMount(path: string): string | null {
  const segments = path.split('/')
  const index = segments.findIndex((segment) => segment.startsWith(MOUNT_PREFIX))
  if (index === -1) return null

  const above = segments.slice(0, index).join('/')
  return above || '/'
}
