/**
 * Browsing and extracting archives from a pane (PLAN.md §M18).
 *
 * The whole payoff of decision 3 sits here: a mount is a real folder, so
 * `navigate` is all "open an archive" means. Preview, thumbnails, search,
 * hashing and drag-out then work inside it with no idea they are in one.
 */

import { useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { archiveStem, extractOnce, looksLikeArchive } from '@/services/archives/archiveService'
import {
  acquireMount,
  existingMount,
  mountForPath,
  registerMount,
  releaseMount,
} from '@/services/archives/mountRegistry'
import { bridge } from '@/services/bridge'
import { fsKeys } from '@/services/filesystem/queries'
import { toast } from '@/stores/toastStore'
import { useUiStore } from '@/stores/uiStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { describeFsError, isFsError } from '@/types/errors'
import type { FileItem } from '@/types/file'
import { dirname } from '@/utils/path'

/**
 * A browse mount is bounded; Uncompress is not.
 *
 * A megabyte can expand to terabytes, and browsing is something the user does
 * by double-clicking rather than by deciding. Past these the backend stops and
 * says so, offering Uncompress — which is an explicit decision, and uncapped
 * beyond the disk saying no (decision 12).
 */
const BROWSE_MAX_BYTES = 2 * 1024 * 1024 * 1024
const BROWSE_MAX_ENTRIES = 20_000

export interface ArchiveActions {
  /** True when double-clicking this item should browse it rather than open it. */
  isArchive: (item: FileItem) => boolean
  /** Extracts to a temp folder and navigates the pane into it. */
  browse: (item: FileItem, paneId: string) => Promise<void>
  /** Extracts beside the archive, permanently. */
  uncompress: (paths: readonly string[]) => Promise<void>
}

export function useArchive(): ArchiveActions {
  const navigate = useWorkspaceStore((state) => state.navigate)
  const queryClient = useQueryClient()

  const isArchive = useCallback((item: FileItem) => {
    return !item.isDirectory && !item.broken && looksLikeArchive(item.name)
  }, [])

  /**
   * Runs an extraction, prompting for a password and retrying while the archive
   * keeps asking. `password-required` is the one failure the caller reacts to
   * rather than reports — and a wrong password says so rather than silently
   * asking again (decision 18).
   */
  const extractWithPassword = useCallback(
    async (
      request: Parameters<typeof extractOnce>[0],
      archiveName: string,
    ): Promise<string | null> => {
      let password = ''
      // Three tries, then stop asking: a prompt that reappears forever is worse
      // than one that gives up and lets the user start again.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const done = await extractOnce({ ...request, password })
          return done.path
        } catch (error) {
          if (!isFsError(error) || error.code !== 'password-required') {
            toast.error(
              `Could not open ${archiveName}`,
              isFsError(error) ? describeFsError(error) : undefined,
            )
            return null
          }
          const entered = await useUiStore
            .getState()
            .askPassword({ name: archiveName, retry: attempt > 0 })
          if (entered === null) return null
          password = entered
        }
      }
      toast.error(`Could not open ${archiveName}`, 'The password did not work.')
      return null
    },
    [],
  )

  const browse = useCallback(
    async (item: FileItem, paneId: string): Promise<void> => {
      // Already extracted, and still within its grace period: instant.
      const existing = existingMount(item.path)
      if (existing) {
        acquireMount(existing)
        navigate(paneId, existing)
        return
      }

      let mount: string
      try {
        mount = await bridge.archives.newMount(item.path)
      } catch (error) {
        toast.error(
          `Could not open ${item.name}`,
          isFsError(error) ? describeFsError(error) : undefined,
        )
        return
      }

      const landed = await extractWithPassword(
        {
          path: item.path,
          destination: mount,
          password: '',
          maxBytes: BROWSE_MAX_BYTES,
          maxEntries: BROWSE_MAX_ENTRIES,
          // The write bits come off, so nothing inside can be edited and then
          // silently reclaimed (decision 6).
          readOnly: true,
          collapseRoot: false,
        },
        item.name,
      )

      if (landed === null) {
        // The backend has already removed a failed extraction; this drops the
        // empty mount that was made for it.
        void bridge.archives.releaseMount(mount).catch(() => undefined)
        return
      }

      registerMount(item.path, mount)
      navigate(paneId, mount)
    },
    [navigate, extractWithPassword],
  )

  const uncompress = useCallback(
    async (paths: readonly string[]): Promise<void> => {
      for (const path of paths) {
        const parent = dirname(path)
        const name = archiveStem(path.slice(parent.length + 1))

        const landed = await extractWithPassword(
          {
            path,
            // Into a folder named after the archive — unless it holds exactly
            // one thing, which `collapseRoot` then lifts out (decision 10).
            destination: `${parent}/${name}`,
            password: '',
            maxBytes: 0,
            maxEntries: 0,
            readOnly: false,
            collapseRoot: true,
          },
          path.slice(parent.length + 1),
        )

        if (landed !== null) {
          toast.success(`Extracted to ${landed.slice(parent.length + 1)}`)
          void queryClient.invalidateQueries({ queryKey: fsKeys.directoryRoot(parent) })
        }
      }
    },
    [extractWithPassword, queryClient],
  )

  return { isArchive, browse, uncompress }
}

/**
 * Holds a reference while a pane is inside a mount, and drops it on the way
 * out.
 *
 * Driven by the pane's path rather than by the click that opened it, so leaving
 * counts however it happened — Back, a breadcrumb, the sidebar, or the tab
 * closing and taking the pane with it.
 */
export function useMountReference(path: string): void {
  useEffect(() => {
    const mount = mountForPath(path)
    if (!mount) return

    acquireMount(mount.mountPath)
    return () => releaseMount(mount.mountPath)
  }, [path])
}
