/**
 * Watch lifecycle and change-driven cache invalidation (PLAN.md M7).
 *
 * Two responsibilities, both of which belong here rather than in Go:
 *
 *  1. **Reference counting.** A single pane already reads its directory three
 *     times — the listing, the preview and the status bar all call
 *     `useDirectory` — and two split panes on the same folder make six. The
 *     backend must not be asked to track that; it takes idempotent watch and
 *     unwatch primitives, and the count lives with the components that own the
 *     lifetime.
 *
 *  2. **Invalidation.** A change in a directory invalidates every cached
 *     variant of that directory's key, and nothing else. This is the payoff of
 *     PLAN.md §1's second rule: the watcher knows nothing about panes, and two
 *     panes showing one folder share the single refetch that follows.
 */

import type { QueryClient } from '@tanstack/react-query'
import { bridge } from '@/services/bridge'
import { fsKeys } from '@/services/filesystem/queries'
import type { FileSystemEvent } from '@/types/file'
import { dirname, normalize } from '@/utils/path'

/** Live watches, by path. */
const counts = new Map<string, number>()

/**
 * Registers interest in a path and returns the release function.
 *
 * Failures are logged, never thrown: watching is an optimisation, and a folder
 * the backend declines to watch (too large, permission denied, unmounted) must
 * still be browsable. Refresh and every operation re-read the disk regardless.
 */
export function acquireWatch(path: string): () => void {
  const target = normalize(path)
  if (!target || target === '/') return () => {}

  const previous = counts.get(target) ?? 0
  counts.set(target, previous + 1)

  if (previous === 0) {
    void bridge.watcher.watch(target).catch((error: unknown) => {
      console.info(`[watch] not watching ${target}:`, error)
    })
  }

  let released = false
  return () => {
    // Guarded: React can invoke a cleanup more than once under StrictMode, and
    // a double decrement would drop a watch another consumer still needs.
    if (released) return
    released = true

    const current = counts.get(target) ?? 0
    if (current <= 1) {
      counts.delete(target)
      void bridge.watcher.unwatch(target).catch(() => undefined)
      return
    }
    counts.set(target, current - 1)
  }
}

/**
 * Subscribes to backend change events and invalidates the matching keys.
 * Returns the unsubscribe function.
 */
export function startWatchInvalidation(queryClient: QueryClient): () => void {
  return bridge.watcher.subscribe((event) => invalidateFor(queryClient, event))
}

export function invalidateFor(queryClient: QueryClient, event: FileSystemEvent): void {
  const dir = normalize(event.dir)

  // Every hidden-files variant at once — a created dotfile matters to a pane
  // showing hidden files and to one that is not, which caches separately.
  void queryClient.invalidateQueries({ queryKey: fsKeys.directoryRoot(dir) })

  if (event.gone) {
    // The folder itself is gone: its parent's listing is now wrong too, and the
    // refetch of `dir` will fail, which is what puts the pane into its error
    // state rather than leaving a stale listing on screen.
    void queryClient.invalidateQueries({ queryKey: fsKeys.directoryRoot(dirname(dir)) })
  }

  // Mounting and ejecting a disk shows up as a change in /Volumes, and the
  // sidebar's capacity figures are read from a separate key.
  if (dir === '/Volumes') {
    void queryClient.invalidateQueries({ queryKey: fsKeys.volumes() })
  }

  // The preview reads single-item metadata under its own key, so a file being
  // written while it is open needs those invalidated by path.
  for (const path of event.paths) {
    void queryClient.invalidateQueries({ queryKey: fsKeys.info(path) })
  }
}

/** Test hook: drops all reference counts. */
export function __resetWatchCounts(): void {
  counts.clear()
}

/** Test hook: how many consumers hold a watch on a path. */
export function __watchCount(path: string): number {
  return counts.get(normalize(path)) ?? 0
}
