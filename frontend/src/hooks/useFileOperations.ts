/**
 * Every file mutation the UI can perform, in one place (PLAN.md M6).
 *
 * Components call these and render the result; they never touch the bridge, the
 * query cache, the clipboard or the undo stack themselves. That keeps four
 * cross-cutting concerns — optimistic updates, error surfacing, undo recording
 * and selection repair — implemented once instead of at every call site.
 *
 * Three rules shape what is in here:
 *
 *  1. **Optimism only where the outcome is knowable.** Create, rename, trash and
 *     delete patch the cache immediately and roll back on failure. Copy and move
 *     do not: under 'keep-both' the backend chooses the final name, and a row
 *     that appears wrongly named and then corrects itself is worse than one that
 *     appears a moment later.
 *  2. **Conflicts are resolved here, applied in Go.** The first attempt always
 *     runs with the 'fail' policy; collisions come back as data, the user is
 *     asked once, and the chosen policy is replayed against the collisions only.
 *  3. **Only reversible work is recorded.** A permanent delete, or anything that
 *     overwrote under 'replace', pushes no undo entry — see historyStore.
 */

import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { bridge } from '@/services/bridge'
import { fsKeys } from '@/services/filesystem/queries'
import {
  parentDirectories,
  placeholderItem,
  untakenName,
  withItem,
  withRenamed,
  withoutPaths,
} from '@/services/operations/optimistic'
import { invert } from '@/services/operations/undo'
import { useClipboardStore } from '@/stores/clipboardStore'
import { useHistoryStore } from '@/stores/historyStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { toast, useToastStore } from '@/stores/toastStore'
import { useUiStore } from '@/stores/uiStore'
import { describeFsError, isFsError } from '@/types/errors'
import type { ConflictPolicy, FileItem, MovedItem } from '@/types/file'
import { basename, dirname } from '@/utils/path'
import { formatCount } from '@/utils/format'

/**
 * How long an operation may run before it earns a progress toast. Below this a
 * toast would flash in and out and read as a glitch.
 *
 * The toast reports which operation is running, not how far along it is:
 * byte-level progress needs the backend to emit events, which lands with the
 * watcher's event plumbing in M7 (PLAN.md M6).
 */
const PROGRESS_DELAY_MS = 600

type CacheSnapshot = [readonly unknown[], FileItem[] | undefined][]

export interface FileOperations {
  /** Creates "untitled folder" and opens its inline rename editor. */
  createFolder: (parent: string, paneId: string) => Promise<void>
  createFile: (parent: string, paneId: string) => Promise<void>
  /** Resolves true when the rename was applied. */
  rename: (path: string, newName: string) => Promise<boolean>
  duplicate: (paths: readonly string[]) => Promise<void>
  copy: (paths: readonly string[], sourceDir: string) => void
  cut: (paths: readonly string[], sourceDir: string) => void
  paste: (destDir: string) => Promise<void>
  /**
   * The shared path for paste, duplicate and, in M9, drag and drop.
   *
   * `startPolicy` is what the first attempt uses. It stays 'fail' for a normal
   * transfer so collisions come back as data to ask about; copying into the
   * folder an item already lives in passes 'keep-both', because there the
   * collision *is* the intent and prompting would be nonsense.
   */
  transfer: (
    sources: readonly string[],
    destDir: string,
    mode: 'copy' | 'move',
    startPolicy?: ConflictPolicy,
  ) => Promise<void>
  moveToTrash: (paths: readonly string[]) => Promise<void>
  deletePermanently: (paths: readonly string[]) => Promise<void>
  undo: () => Promise<void>
}

export function useFileOperations(): FileOperations {
  const queryClient = useQueryClient()

  const invalidate = useCallback(
    (dirs: readonly string[]) => {
      for (const dir of new Set(dirs)) {
        void queryClient.invalidateQueries({ queryKey: fsKeys.directoryRoot(dir) })
      }
    },
    [queryClient],
  )

  /**
   * Runs `apply` against the cache, then `run` against the disk, restoring the
   * cache if the disk disagrees. Every hidden-files variant of a directory is
   * patched together, since two panes may be showing the same folder with
   * different settings.
   */
  const optimistically = useCallback(
    async <T>(
      dirs: readonly string[],
      apply: () => void,
      run: () => Promise<T>,
      failureMessage: string,
    ): Promise<T | null> => {
      // In-flight reads must be cancelled first: one resolving mid-operation
      // would overwrite the optimistic patch with pre-operation truth.
      await Promise.all(
        dirs.map((dir) => queryClient.cancelQueries({ queryKey: fsKeys.directoryRoot(dir) })),
      )

      const saved: CacheSnapshot = dirs.flatMap((dir) =>
        queryClient.getQueriesData<FileItem[]>({ queryKey: fsKeys.directoryRoot(dir) }),
      )
      apply()

      try {
        return await run()
      } catch (error) {
        for (const [key, data] of saved) queryClient.setQueryData(key, data)
        report(error, failureMessage)
        return null
      } finally {
        // Even on success: the placeholder carried a guessed mtime and size.
        invalidate(dirs)
      }
    },
    [queryClient, invalidate],
  )

  const createEntry = useCallback(
    async (parent: string, paneId: string, isDirectory: boolean): Promise<void> => {
      const existing =
        queryClient.getQueryData<FileItem[]>(fsKeys.directory(parent, true)) ??
        queryClient.getQueryData<FileItem[]>(fsKeys.directory(parent, false)) ??
        []
      const name = untakenName(existing, isDirectory ? 'untitled folder' : 'untitled file')

      const created = await optimistically(
        [parent],
        () => patchDirectory(queryClient, parent, (items) =>
          withItem(items, placeholderItem(parent, name, isDirectory)),
        ),
        () =>
          isDirectory ? bridge.fs.createFolder(parent, name) : bridge.fs.createFile(parent, name),
        isDirectory ? 'Could not create the folder' : 'Could not create the file',
      )

      if (!created) return

      useHistoryStore.getState().push({
        kind: 'create',
        label: isDirectory ? 'New Folder' : 'New File',
        path: created.path,
      })
      // Finder opens the name for editing straight away, which is what makes
      // "untitled folder" an acceptable default rather than a chore.
      useSelectionStore.getState().select(paneId, created.path)
      useUiStore.getState().beginRename(paneId, created.path)
    },
    [queryClient, optimistically],
  )

  const rename = useCallback(
    async (path: string, newName: string): Promise<boolean> => {
      const trimmed = newName.trim()
      if (!trimmed || trimmed === basename(path)) return false

      const parent = dirname(path)
      const target = `${parent === '/' ? '' : parent}/${trimmed}`

      const renamed = await optimistically(
        [parent],
        () => patchDirectory(queryClient, parent, (items) => withRenamed(items, path, target)),
        () => bridge.fs.rename(path, trimmed),
        'Could not rename',
      )

      if (!renamed) return false

      useSelectionStore.getState().replacePath(path, renamed.path)
      useHistoryStore.getState().push({
        kind: 'rename',
        label: `Rename to ${trimmed}`,
        from: path,
        to: renamed.path,
      })
      return true
    },
    [queryClient, optimistically],
  )

  const transfer = useCallback(
    async (
      sources: readonly string[],
      destDir: string,
      mode: 'copy' | 'move',
      startPolicy: ConflictPolicy = 'fail',
    ): Promise<void> => {
      if (sources.length === 0) return

      const paths = [...sources]
      const touched = [...new Set([...parentDirectories(paths), destDir])]
      // Called rather than referenced, so the bridge method keeps its receiver.
      const run = (batch: string[], policy: ConflictPolicy) =>
        mode === 'copy'
          ? bridge.fs.copy(batch, destDir, policy)
          : bridge.fs.move(batch, destDir, policy)
      const finish = withProgress(
        `${mode === 'copy' ? 'Copying' : 'Moving'} ${formatCount(paths.length, 'item')}…`,
      )

      try {
        // 'fail' by default: collisions come back as data rather than being
        // silently resolved, which is what lets the user decide (PLAN.md §1).
        const first = await run(paths, startPolicy)
        const succeeded: MovedItem[] = [...first.succeeded]
        const failures = [...first.failures]
        let overwrote = startPolicy === 'replace'

        if (first.conflicts.length > 0) {
          const policy = await useUiStore.getState().askConflict({
            operation: mode,
            names: first.conflicts.map(basename),
          })

          if (policy && policy !== 'fail') {
            overwrote = policy === 'replace'
            const second = await run(first.conflicts, policy)
            succeeded.push(...second.succeeded)
            failures.push(...second.failures)
          }
        }

        for (const failure of failures) {
          toast.error(`Could not ${mode} ${basename(failure.path)}`, failure.message)
        }

        // A source that was already at the destination is reported as a success
        // with source === target; recording it would make undo a no-op that
        // still consumed a Cmd+Z.
        const real = succeeded.filter((moved) => moved.source !== moved.target)

        if (mode === 'move') {
          useSelectionStore.getState().forgetPaths(real.map((moved) => moved.source))
        }

        // Replacing destroyed whatever was there; there is nothing to restore,
        // so no undo is offered rather than one that would quietly fail.
        if (real.length > 0 && !overwrote) {
          useHistoryStore.getState().push(
            mode === 'move'
              ? {
                  kind: 'move',
                  label: `Move ${formatCount(real.length, 'item')}`,
                  pairs: real.map((moved) => ({ from: moved.source, to: moved.target })),
                }
              : {
                  kind: 'copy',
                  label: `Copy ${formatCount(real.length, 'item')}`,
                  created: real.map((moved) => moved.target),
                },
          )
        }
      } catch (error) {
        report(error, `Could not ${mode} the ${paths.length === 1 ? 'item' : 'items'}`)
      } finally {
        finish()
        invalidate(touched)
      }
    },
    [invalidate],
  )

  const moveToTrash = useCallback(
    async (paths: readonly string[]): Promise<void> => {
      if (paths.length === 0) return
      const targets = [...paths]
      const dirs = parentDirectories(targets)

      const trashed = await optimistically(
        dirs,
        () => {
          for (const dir of dirs) {
            patchDirectory(queryClient, dir, (items) => withoutPaths(items, targets))
          }
        },
        () => bridge.fs.trash(targets),
        'Could not move to Trash',
      )

      if (!trashed || trashed.length === 0) return

      useSelectionStore.getState().forgetPaths(targets)
      useClipboardStore.getState().clear()
      useHistoryStore.getState().push({
        kind: 'trash',
        label: `Move ${formatCount(trashed.length, 'item')} to Trash`,
        items: trashed,
      })
    },
    [queryClient, optimistically],
  )

  const deletePermanently = useCallback(
    async (paths: readonly string[]): Promise<void> => {
      if (paths.length === 0) return
      const targets = [...paths]

      const confirmed = await useUiStore.getState().askConfirm({
        title: `Delete ${formatCount(targets.length, 'item')}?`,
        message:
          targets.length === 1
            ? `"${basename(targets[0] ?? '')}" will be deleted immediately.`
            : `${formatCount(targets.length, 'item')} will be deleted immediately.`,
        detail: 'This cannot be undone.',
        confirmLabel: 'Delete',
        destructive: true,
      })
      if (!confirmed) return

      const dirs = parentDirectories(targets)
      const done = await optimistically(
        dirs,
        () => {
          for (const dir of dirs) {
            patchDirectory(queryClient, dir, (items) => withoutPaths(items, targets))
          }
        },
        async () => {
          await bridge.fs.delete(targets)
          return true
        },
        'Could not delete',
      )

      if (!done) return
      useSelectionStore.getState().forgetPaths(targets)
      useClipboardStore.getState().clear()
      // No undo entry: nothing can put these back, and an entry that failed on
      // use would be worse than none at all.
    },
    [queryClient, optimistically],
  )

  const paste = useCallback(
    async (destDir: string): Promise<void> => {
      const { paths, mode, sourceDir } = useClipboardStore.getState()
      if (paths.length === 0 || !mode) return

      // Cutting and pasting into the same folder would be a no-op that still
      // consumed the clipboard; Finder simply ignores it.
      if (mode === 'cut' && sourceDir === destDir) return

      // Copying into the folder the items came from is a duplicate, so it goes
      // straight to keep-both rather than asking about a collision the user
      // clearly intended.
      const sameFolder = mode === 'copy' && sourceDir === destDir
      await transfer(
        paths,
        destDir,
        mode === 'cut' ? 'move' : 'copy',
        sameFolder ? 'keep-both' : 'fail',
      )
      // A cut is spent once pasted; a copy stays available for a second paste.
      if (mode === 'cut') useClipboardStore.getState().clear()
    },
    [transfer],
  )

  const undo = useCallback(async (): Promise<void> => {
    const entry = useHistoryStore.getState().pop()
    if (!entry) return

    const finish = withProgress(`Undoing ${entry.label.toLowerCase()}…`)
    try {
      const { touched, problems } = await invert(bridge, entry)
      invalidate(touched)

      if (problems.length > 0) {
        toast.error(`Could not fully undo ${entry.label.toLowerCase()}`, problems.join('. '))
      } else {
        toast.info(`Undid ${entry.label.toLowerCase()}`)
      }
    } catch (error) {
      report(error, `Could not undo ${entry.label.toLowerCase()}`)
    } finally {
      finish()
    }
  }, [invalidate])

  return {
    createFolder: useCallback(
      (parent, paneId) => createEntry(parent, paneId, true),
      [createEntry],
    ),
    createFile: useCallback((parent, paneId) => createEntry(parent, paneId, false), [createEntry]),
    rename,
    duplicate: useCallback(
      async (paths) => {
        // Duplicate is a copy into the folder the items already live in, which
        // collides by definition — so it starts at keep-both, and the backend's
        // naming produces Finder's "x copy" for free.
        const first = paths[0]
        if (!first) return
        await transfer(paths, dirname(first), 'copy', 'keep-both')
      },
      [transfer],
    ),
    copy: useCallback((paths, sourceDir) => {
      if (paths.length > 0) useClipboardStore.getState().copy(paths, sourceDir)
    }, []),
    cut: useCallback((paths, sourceDir) => {
      if (paths.length > 0) useClipboardStore.getState().cut(paths, sourceDir)
    }, []),
    paste,
    transfer,
    moveToTrash,
    deletePermanently,
    undo,
  }
}

/** Patches every hidden-files variant of one directory's cached listing. */
function patchDirectory(
  queryClient: QueryClient,
  dir: string,
  change: (items: FileItem[]) => FileItem[],
): void {
  queryClient.setQueriesData<FileItem[]>({ queryKey: fsKeys.directoryRoot(dir) }, (items) =>
    items ? change(items) : items,
  )
}

/**
 * Shows a progress toast if the operation outlives PROGRESS_DELAY_MS. Returns
 * the function that clears it, which must run in a `finally` — a progress toast
 * never expires on its own.
 */
function withProgress(message: string): () => void {
  let id: string | null = null
  const timer = setTimeout(() => {
    id = useToastStore.getState().push({ tone: 'progress', message })
  }, PROGRESS_DELAY_MS)

  return () => {
    clearTimeout(timer)
    if (id) useToastStore.getState().dismiss(id)
  }
}

/** Turns anything thrown into one error toast with usable copy. */
function report(error: unknown, fallback: string): void {
  if (isFsError(error)) {
    toast.error(fallback, describeFsError(error))
    return
  }
  toast.error(fallback, error instanceof Error ? error.message : String(error))
}

/** Re-exported so components can render the policy the dialog returns. */
export type { ConflictPolicy }
