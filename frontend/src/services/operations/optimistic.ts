/**
 * Pure transforms over a cached directory listing.
 *
 * An operation applies one of these to the React Query cache immediately, so
 * the pane reacts at pointer speed instead of after a disk round-trip, and the
 * snapshot taken beforehand is restored if the call fails.
 *
 * Applied only where the outcome is knowable in advance. A copy or move under
 * the 'keep-both' policy has its final name chosen by the backend, so those
 * invalidate rather than guess — a row that appears with the wrong name and
 * then silently corrects itself is worse than one that appears a moment later.
 */

import type { FileItem } from '@/types/file'
import { categorize } from '@/utils/fileCategory'
import { basename, dirname, extname, join } from '@/utils/path'

/** Removes entries by path. Used by trash, delete and the source side of a move. */
export function withoutPaths(items: readonly FileItem[], paths: readonly string[]): FileItem[] {
  const removing = new Set(paths)
  return items.filter((item) => !removing.has(item.path))
}

/**
 * Inserts an item, replacing any existing entry at the same path.
 *
 * Ordering is not applied: `useDirectory` sorts the cached array on read, so a
 * placeholder lands in the right position without this needing to know the
 * pane's sort.
 */
export function withItem(items: readonly FileItem[], item: FileItem): FileItem[] {
  return [...items.filter((existing) => existing.path !== item.path), item]
}

/** Re-points an entry at its new path and name, for an in-place rename. */
export function withRenamed(
  items: readonly FileItem[],
  from: string,
  to: string,
): FileItem[] {
  return items.map((item) => {
    if (item.path !== from) return item
    const name = basename(to)
    const extension = item.isDirectory ? '' : extname(name)
    return {
      ...item,
      id: to,
      path: to,
      name,
      extension,
      category: categorize(extension, item.isDirectory),
    }
  })
}

/**
 * A stand-in for a file the backend has not created yet.
 *
 * `modifiedAt` uses the current clock rather than 0 so a listing sorted by date
 * puts the new item where the real one will land, avoiding a visible jump when
 * the true entry arrives.
 */
export function placeholderItem(parent: string, name: string, isDirectory: boolean): FileItem {
  const path = join(parent, name)
  const extension = isDirectory ? '' : extname(name)
  const now = Date.now()

  return {
    id: path,
    path,
    name,
    extension,
    size: 0,
    isDirectory,
    createdAt: now,
    modifiedAt: now,
    permissions: isDirectory ? 'drwxr-xr-x' : '-rw-r--r--',
    hidden: name.startsWith('.'),
    symlink: false,
    // A file that does not exist yet cannot be tagged, so the placeholder is
    // untagged — and the real entry replaces it moments later either way.
    tags: [],
    mimeType: isDirectory ? 'inode/directory' : 'application/octet-stream',
    category: categorize(extension, isDirectory),
    broken: false,
  }
}

/** The distinct parent directories a set of paths belongs to. */
export function parentDirectories(paths: readonly string[]): string[] {
  return [...new Set(paths.map(dirname))]
}

/**
 * A name that does not collide with anything currently in `items`.
 *
 * Used to pre-fill "untitled folder" the way Finder does. The backend applies
 * the same scheme when it resolves a keep-both conflict, so the name offered
 * here is the name the user ends up with.
 */
export function untakenName(items: readonly FileItem[], base: string): string {
  const taken = new Set(items.map((item) => item.name))
  if (!taken.has(base)) return base

  for (let counter = 2; counter < 1000; counter += 1) {
    const candidate = `${base} ${counter}`
    if (!taken.has(candidate)) return candidate
  }
  return base
}
