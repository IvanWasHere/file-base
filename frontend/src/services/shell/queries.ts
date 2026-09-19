/**
 * React Query bindings for Launch Services (PLAN.md §M25).
 *
 * Which applications can open a file is server state in exactly the sense
 * `services/filesystem/queries` means it: the answer lives outside the app, it
 * is read rather than decided, and two panes asking the same question should
 * share one read.
 */

import { queryOptions } from '@tanstack/react-query'
import { bridge, type Applications } from '@/services/bridge'
import { basename, extname, normalize } from '@/utils/path'

export const shellKeys = {
  all: ['shell'] as const,
  applications: (type: string) => [...shellKeys.all, 'applications', type] as const,
}

/**
 * What the cache treats as "the same question".
 *
 * Handlers are registered per *type*, not per file, so right-clicking the
 * two-hundredth photo in a folder must not be a two-hundredth trip through
 * Launch Services — the menu is already on screen when the answer arrives
 * (§M25 decision 3). The extension is the proxy the frontend can compute
 * before asking; Go returns the real UTI with the answer, which is what a row
 * would show if it ever needed to explain itself.
 *
 * A file with no extension falls back to its own path, because there is
 * nothing to share it with: macOS identifies those from their contents, and
 * two extensionless files are not the same type by virtue of both being
 * extensionless.
 */
export function applicationType(path: string): string {
  const extension = extname(basename(path))
  return extension ? `ext:${extension}` : `path:${normalize(path)}`
}

export function applicationsQuery(path: string) {
  return queryOptions<Applications>({
    queryKey: shellKeys.applications(applicationType(path)),
    queryFn: () => bridge.shell.applicationsFor(path),
    enabled: path.length > 0,
    // Installing an application while a context menu is open is not a case
    // worth refetching for; relaunching the app is how the list is refreshed.
    staleTime: Infinity,
  })
}
