/**
 * Every application on the machine, for the Open With picker's second list
 * (PLAN.md §M25 decision 7).
 *
 * Read with `bridge.fs.readDirectory` rather than through a native open panel:
 * the read already exists, already reports permission errors the way the rest
 * of the app expects, and already works under the mock bridge — so the picker
 * is testable in Vitest without a Mac's application folder in the loop.
 */

import { queryOptions } from '@tanstack/react-query'
import { bridge, type Application } from '@/services/bridge'
import type { StandardPaths } from '@/types/file'
import { basename, extname, join } from '@/utils/path'

/**
 * Where applications live.
 *
 * `/System/Applications` is written out rather than resolved in Go, unlike
 * every other well-known location: it is a fixed path on a read-only volume
 * that has never moved, and `StandardPaths` describes places a *user* has
 * — a home, a Desktop, a Downloads — not the system's own read-only mount.
 */
export function applicationFolders(paths: StandardPaths | undefined): string[] {
  if (!paths) return []
  return [paths.applications, '/System/Applications', join(paths.home, 'Applications')]
}

/**
 * The bundles in a folder, descending one level into anything that is not one
 * — which is how Utilities is found, and any folder someone groups their own
 * applications into. One level only: this is a picker, not a search.
 */
async function bundlesIn(folder: string, descend: boolean): Promise<Application[]> {
  let entries
  try {
    entries = await bridge.fs.readDirectory(folder)
  } catch {
    // A folder that does not exist on this Mac — ~/Applications usually — is
    // not an error worth showing. The list is the union of what is there.
    return []
  }

  const found: Application[] = []
  const deeper: Promise<Application[]>[] = []

  for (const entry of entries) {
    if (!entry.isDirectory) continue
    if (extname(entry.name) === 'app') {
      found.push({
        path: entry.path,
        name: entry.name.slice(0, -'.app'.length),
        bundleId: '',
        isDefault: false,
      })
      continue
    }
    if (descend) deeper.push(bundlesIn(entry.path, false))
  }

  return found.concat(...(await Promise.all(deeper)))
}

export const installedKeys = {
  all: ['shell', 'installed'] as const,
  list: (folders: readonly string[]) => [...installedKeys.all, [...folders].sort()] as const,
}

export function installedApplicationsQuery(folders: string[]) {
  return queryOptions<Application[]>({
    queryKey: installedKeys.list(folders),
    queryFn: async () => {
      const lists = await Promise.all(folders.map((folder) => bundlesIn(folder, true)))

      // Deduplicated by path, then by name: a folder listed twice, and an
      // application present in both /Applications and ~/Applications, are both
      // one row as far as the person choosing is concerned.
      const byPath = new Map<string, Application>()
      for (const app of lists.flat()) {
        if (!byPath.has(app.path)) byPath.set(app.path, app)
      }
      return [...byPath.values()].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      )
    },
    enabled: folders.length > 0,
    // Installing an application while the picker is open is not a case worth
    // refetching for, and this is a three-folder directory read.
    staleTime: 60_000,
  })
}

/** What a row says when a bundle has no name left after its extension. */
export function applicationLabel(app: Application): string {
  return app.name || basename(app.path)
}
