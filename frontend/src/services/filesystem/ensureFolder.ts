/**
 * Creates a folder if it is not there, including any missing parents.
 *
 * Recursive because `createFolder` takes a parent that must already exist, and
 * on a fresh install the app-support folder may not — it is normally created by
 * whichever of the database, the templates folder (§M15) or the themes folder
 * (§M24) runs first.
 *
 * Failures are swallowed by design. Every caller wants a folder the *user*
 * maintains by hand, and not having one means "no custom templates" or "no
 * external themes" — both of which the callers already handle, and neither of
 * which is a reason to refuse to open a dialog.
 */

import { bridge } from '@/services/bridge'
import { basename, dirname } from '@/utils/path'

export async function ensureFolder(path: string): Promise<void> {
  if (!path) return
  try {
    if (await bridge.fs.exists(path)) return
  } catch {
    return
  }

  const parent = dirname(path)
  if (parent && parent !== path) await ensureFolder(parent)

  try {
    await bridge.fs.createFolder(parent, basename(path))
  } catch {
    // Already there, or not creatable. Either way the read that follows decides.
  }
}
