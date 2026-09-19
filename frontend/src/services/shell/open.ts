/**
 * Handing files to an application (PLAN.md §M25).
 *
 * A function rather than a method on `useMenuCommands`, because two unrelated
 * places call it: the context menu's Open With submenu, which has a command
 * handler behind it, and the picker dialog, which does not. Both need the same
 * failure to read the same way.
 */

import { bridge } from '@/services/bridge'
import { toast } from '@/stores/toastStore'
import { describeFsError, isFsError } from '@/types/errors'
import { formatCount } from '@/utils/format'
import { basename } from '@/utils/path'

export function openWith(paths: string[], appPath: string): void {
  if (paths.length === 0) return

  void bridge.shell.openWith(paths, appPath).catch((error: unknown) => {
    const what =
      paths.length === 1 && paths[0]
        ? `Could not open “${basename(paths[0])}”`
        : `Could not open ${formatCount(paths.length, 'item')}`
    toast.error(
      `${what} with ${basename(appPath).replace(/\.app$/, '')}`,
      isFsError(error) ? describeFsError(error) : undefined,
    )
  })
}
