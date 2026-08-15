/**
 * The browse-mount lifecycle (PLAN.md §M18 decisions 4, 5, 8).
 *
 * One temp folder per archive, reference-counted by the panes inside it —
 * exactly M7's watch registry, and for the same reason: the backend takes
 * idempotent primitives (`newMount` / `releaseMount`) and knows nothing about
 * panes, so the counting belongs on this side.
 *
 * "The user leaves" is that count reaching zero, which covers navigating away,
 * closing the tab and closing the pane without needing three rules. The mount
 * is not reclaimed the instant it does: Back, Forward and a mis-click all drop
 * it to zero for a moment, and re-extracting a 4GB archive because someone
 * pressed Back is the feature at its worst.
 */

import { bridge } from '@/services/bridge'

/**
 * Long enough that Back-then-Forward is free, short enough that a browsed
 * archive is not still on disk when you have moved on. Everything is reclaimed
 * at quit regardless, and orphans from a crash are swept at startup.
 */
export const MOUNT_GRACE_MS = 60_000

interface Mount {
  /** The archive this was extracted from. */
  archivePath: string
  /** The temp folder its contents are in. */
  mountPath: string
  /** How many panes are currently inside it. */
  refs: number
  /** Pending reclaim, cancelled if someone returns within the grace period. */
  timer: ReturnType<typeof setTimeout> | undefined
}

/** Keyed by archive path: two panes on one archive share one extraction. */
const mounts = new Map<string, Mount>()

/** Reverse lookup, so a pane's path can be traced back to its archive. */
const byMountPath = new Map<string, Mount>()

/** Whether a path is inside a live mount — used by the session guard. */
export function mountForPath(path: string): { archivePath: string; mountPath: string } | null {
  for (const mount of mounts.values()) {
    if (path === mount.mountPath || path.startsWith(mount.mountPath + '/')) {
      return { archivePath: mount.archivePath, mountPath: mount.mountPath }
    }
  }
  return null
}

/** An existing extraction for this archive, if one is still around. */
export function existingMount(archivePath: string): string | null {
  return mounts.get(archivePath)?.mountPath ?? null
}

/**
 * Registers a mount that has just been extracted, holding *no* reference.
 *
 * Registering is not visiting: the pane's own effect takes the reference when
 * it navigates in, and counting one here as well meant leaving could never
 * reach zero — the mount would survive until quit however long ago the user
 * walked away.
 *
 * The reclaim timer starts immediately for that reason. An extraction the user
 * never reaches — navigation failed, or the pane closed in between — is then
 * cleaned up on the same clock as one they left, rather than lingering.
 *
 * Called after the job succeeds rather than before it starts: a failed
 * extraction has already been cleaned up by the backend.
 */
export function registerMount(archivePath: string, mountPath: string): void {
  const existing = mounts.get(archivePath)
  if (existing) return

  const mount: Mount = { archivePath, mountPath, refs: 0, timer: undefined }
  mounts.set(archivePath, mount)
  byMountPath.set(mountPath, mount)

  mount.timer = setTimeout(() => {
    void reclaim(mount)
  }, MOUNT_GRACE_MS)
}

/** Another pane entered a mount that already exists. */
export function acquireMount(mountPath: string): void {
  const mount = byMountPath.get(mountPath)
  if (!mount) return
  mount.refs += 1
  clearReclaim(mount)
}

/**
 * A pane left. At zero the reclaim timer starts.
 *
 * The floor at zero matters for the reason M7's did: React invokes effect
 * cleanups twice under StrictMode, and a double decrement would reclaim a
 * folder another pane is still showing.
 */
export function releaseMount(mountPath: string): void {
  const mount = byMountPath.get(mountPath)
  if (!mount) return

  mount.refs = Math.max(0, mount.refs - 1)
  if (mount.refs > 0) return

  clearReclaim(mount)
  mount.timer = setTimeout(() => {
    void reclaim(mount)
  }, MOUNT_GRACE_MS)
}

function clearReclaim(mount: Mount): void {
  if (mount.timer !== undefined) {
    clearTimeout(mount.timer)
    mount.timer = undefined
  }
}

async function reclaim(mount: Mount): Promise<void> {
  // Someone may have returned between the timer firing and this running.
  if (mount.refs > 0) return

  mounts.delete(mount.archivePath)
  byMountPath.delete(mount.mountPath)
  try {
    await bridge.archives.releaseMount(mount.mountPath)
  } catch {
    // The backend refuses anything it did not create, and a mount that is
    // already gone is not a failure worth telling anyone about.
  }
}

/** Test hook, and the teardown for a window that is closing. */
export function __releaseAllMounts(): void {
  for (const mount of mounts.values()) {
    clearReclaim(mount)
    void bridge.archives.releaseMount(mount.mountPath).catch(() => undefined)
  }
  mounts.clear()
  byMountPath.clear()
}

/** Test hook: how many mounts are live, and what each holds. */
export function __mountState(): { archivePath: string; mountPath: string; refs: number }[] {
  return [...mounts.values()].map(({ archivePath, mountPath, refs }) => ({
    archivePath,
    mountPath,
    refs,
  }))
}
