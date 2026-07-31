/**
 * The operations layer, driven directly rather than through the UI.
 *
 * Everything runs against the mock filesystem, so these exercise the real
 * optimistic-update, conflict and undo code paths — only the disk is fake.
 */

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileOperations } from './useFileOperations'
import { createQueryClient } from '@/app/providers/queryClient'
import { bridge } from '@/services/bridge'
import { fsKeys } from '@/services/filesystem/queries'
import { placeholderItem } from '@/services/operations/optimistic'
import { useClipboardStore } from '@/stores/clipboardStore'
import { useHistoryStore } from '@/stores/historyStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useToastStore } from '@/stores/toastStore'
import { useUiStore } from '@/stores/uiStore'
import { FsError } from '@/types/errors'
import type { FileItem } from '@/types/file'

const HOME = '/Users/dev'
const PANE = 'pane-1'

let queryClient: QueryClient
let scratch: string

function setup() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return renderHook(() => useFileOperations(), { wrapper }).result
}

/** Primes the query cache the way a rendered pane would. */
async function cacheDirectory(path: string): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: fsKeys.directory(path, false),
    queryFn: () => bridge.fs.readDirectory(path, { includeHidden: false }),
  })
}

const cached = (path: string): FileItem[] =>
  queryClient.getQueryData<FileItem[]>(fsKeys.directory(path, false)) ?? []

beforeEach(async () => {
  // First, before anything here touches the bridge: a spy left over from a
  // previous test would otherwise answer this file's own setup calls.
  vi.restoreAllMocks()

  queryClient = createQueryClient()
  useHistoryStore.setState({ entries: [] })
  useClipboardStore.setState({ paths: [], mode: null, sourceDir: null })
  useSelectionStore.setState({ byPane: {} })
  useUiStore.setState({ dialog: null, renaming: null })
  useToastStore.getState().clear()

  const created = await bridge.fs.createFolder(HOME, 'ops-scratch')
  scratch = created.path
})

describe('create', () => {
  it('creates a folder, selects it and opens its rename editor', async () => {
    const operations = setup()
    await act(() => operations.current.createFolder(scratch, PANE))

    const path = `${scratch}/untitled folder`
    expect(await bridge.fs.exists(path)).toBe(true)
    expect(useSelectionStore.getState().byPane[PANE]?.selected.has(path)).toBe(true)
    expect(useUiStore.getState().renaming).toEqual({ paneId: PANE, path })
  })

  it('does not collide with an existing untitled folder', async () => {
    const operations = setup()
    await cacheDirectory(scratch)

    await act(() => operations.current.createFolder(scratch, PANE))
    await cacheDirectory(scratch)
    await act(() => operations.current.createFolder(scratch, PANE))

    expect(await bridge.fs.exists(`${scratch}/untitled folder 2`)).toBe(true)
  })

  it('shows the new folder in the cache before the disk answers', async () => {
    const operations = setup()
    await cacheDirectory(scratch)

    // The bridge call is held open, so anything visible at this point can only
    // have come from the optimistic patch.
    let release: (value: FileItem) => void = () => {}
    vi.spyOn(bridge.fs, 'createFolder').mockReturnValue(
      new Promise<FileItem>((resolve) => {
        release = resolve
      }),
    )

    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = operations.current.createFolder(scratch, PANE)
    })

    await waitFor(() =>
      expect(cached(scratch).map((item) => item.name)).toContain('untitled folder'),
    )

    await act(async () => {
      release(placeholderItem(scratch, 'untitled folder', true))
      await pending
    })
  })

  it('rolls the cache back and reports when creation fails', async () => {
    const operations = setup()
    await cacheDirectory(scratch)
    const before = cached(scratch).length

    vi.spyOn(bridge.fs, 'createFolder').mockRejectedValueOnce(
      new FsError('permission-denied', 'nope', scratch),
    )

    await act(() => operations.current.createFolder(scratch, PANE))

    await waitFor(() => expect(cached(scratch)).toHaveLength(before))
    const toasts = useToastStore.getState().toasts
    expect(toasts[0]?.tone).toBe('error')
    expect(toasts[0]?.detail).toMatch(/Privacy & Security/)
    // A failed create leaves nothing to undo.
    expect(useHistoryStore.getState().entries).toHaveLength(0)
  })
})

describe('rename', () => {
  it('renames and follows the item in the selection', async () => {
    const operations = setup()
    const file = await bridge.fs.createFile(scratch, 'draft.txt')
    useSelectionStore.getState().select(PANE, file.path)

    await act(async () => {
      await operations.current.rename(file.path, 'final.txt')
    })

    expect(await bridge.fs.exists(`${scratch}/final.txt`)).toBe(true)
    expect(useSelectionStore.getState().byPane[PANE]?.selected.has(`${scratch}/final.txt`)).toBe(
      true,
    )
  })

  it('ignores a no-op rename rather than recording one', async () => {
    const operations = setup()
    const file = await bridge.fs.createFile(scratch, 'draft.txt')

    await act(async () => {
      expect(await operations.current.rename(file.path, 'draft.txt')).toBe(false)
      expect(await operations.current.rename(file.path, '   ')).toBe(false)
    })

    expect(useHistoryStore.getState().entries).toHaveLength(0)
  })

  it('surfaces a name collision without losing either file', async () => {
    const operations = setup()
    const file = await bridge.fs.createFile(scratch, 'a.txt')
    await bridge.fs.createFile(scratch, 'b.txt')

    await act(async () => {
      expect(await operations.current.rename(file.path, 'b.txt')).toBe(false)
    })

    expect(useToastStore.getState().toasts[0]?.tone).toBe('error')
    expect(await bridge.fs.exists(file.path)).toBe(true)
    expect(await bridge.fs.exists(`${scratch}/b.txt`)).toBe(true)
  })
})

describe('clipboard', () => {
  it('copies and pastes into another folder', async () => {
    const operations = setup()
    const source = await bridge.fs.createFolder(scratch, 'Source')
    const dest = await bridge.fs.createFolder(scratch, 'Dest')
    const file = await bridge.fs.createFile(source.path, 'notes.txt')

    act(() => operations.current.copy([file.path], source.path))
    await act(() => operations.current.paste(dest.path))

    expect(await bridge.fs.exists(`${dest.path}/notes.txt`)).toBe(true)
    // A copy survives the paste so it can be pasted again.
    expect(useClipboardStore.getState().paths).toHaveLength(1)
  })

  it('a cut moves and then empties the clipboard', async () => {
    const operations = setup()
    const source = await bridge.fs.createFolder(scratch, 'Source')
    const dest = await bridge.fs.createFolder(scratch, 'Dest')
    const file = await bridge.fs.createFile(source.path, 'notes.txt')

    act(() => operations.current.cut([file.path], source.path))
    await act(() => operations.current.paste(dest.path))

    expect(await bridge.fs.exists(file.path)).toBe(false)
    expect(await bridge.fs.exists(`${dest.path}/notes.txt`)).toBe(true)
    expect(useClipboardStore.getState().paths).toHaveLength(0)
  })

  it('ignores a cut pasted back into its own folder', async () => {
    const operations = setup()
    const file = await bridge.fs.createFile(scratch, 'notes.txt')

    act(() => operations.current.cut([file.path], scratch))
    await act(() => operations.current.paste(scratch))

    expect(await bridge.fs.exists(file.path)).toBe(true)
    expect(useHistoryStore.getState().entries).toHaveLength(0)
  })
})

describe('conflicts', () => {
  /** Answers the next conflict dialog as soon as it opens. */
  function answerConflict(policy: 'keep-both' | 'replace' | 'skip' | false) {
    const unsubscribe = useUiStore.subscribe((state) => {
      if (state.dialog?.kind === 'conflict') {
        unsubscribe()
        useUiStore.getState().resolveDialog(policy)
      }
    })
    return unsubscribe
  }

  it('asks once and applies the answer to the collisions only', async () => {
    const operations = setup()
    const source = await bridge.fs.createFolder(scratch, 'Source')
    const dest = await bridge.fs.createFolder(scratch, 'Dest')
    await bridge.fs.createFile(source.path, 'clash.txt')
    await bridge.fs.createFile(source.path, 'unique.txt')
    await bridge.fs.createFile(dest.path, 'clash.txt')

    answerConflict('keep-both')
    await act(() =>
      operations.current.transfer(
        [`${source.path}/clash.txt`, `${source.path}/unique.txt`],
        dest.path,
        'copy',
      ),
    )

    const listing = await bridge.fs.readDirectory(dest.path)
    expect(listing.map((item) => item.name).sort()).toEqual([
      'clash copy.txt',
      'clash.txt',
      'unique.txt',
    ])
  })

  it('dismissing the dialog leaves the colliding item alone', async () => {
    const operations = setup()
    const source = await bridge.fs.createFolder(scratch, 'Source')
    const dest = await bridge.fs.createFolder(scratch, 'Dest')
    await bridge.fs.createFile(source.path, 'clash.txt')
    const original = await bridge.fs.createFile(dest.path, 'clash.txt')

    answerConflict(false)
    await act(() =>
      operations.current.transfer([`${source.path}/clash.txt`], dest.path, 'copy'),
    )

    const listing = await bridge.fs.readDirectory(dest.path)
    expect(listing).toHaveLength(1)
    expect(listing[0]?.path).toBe(original.path)
  })

  // Replacing destroys the previous contents, so there is nothing an undo could
  // restore; offering one would be a lie.
  it('records no undo entry after a replace', async () => {
    const operations = setup()
    const source = await bridge.fs.createFolder(scratch, 'Source')
    const dest = await bridge.fs.createFolder(scratch, 'Dest')
    await bridge.fs.createFile(source.path, 'clash.txt')
    await bridge.fs.createFile(dest.path, 'clash.txt')

    answerConflict('replace')
    await act(() =>
      operations.current.transfer([`${source.path}/clash.txt`], dest.path, 'copy'),
    )

    expect(useHistoryStore.getState().entries).toHaveLength(0)
  })
})

describe('trash and delete', () => {
  it('removes from the cache immediately and records an undo entry', async () => {
    const operations = setup()
    const file = await bridge.fs.createFile(scratch, 'notes.txt')
    await cacheDirectory(scratch)
    useSelectionStore.getState().select(PANE, file.path)

    await act(() => operations.current.moveToTrash([file.path]))

    await waitFor(() =>
      expect(cached(scratch).map((item) => item.name)).not.toContain('notes.txt'),
    )
    // A selection that outlived its item would make the status bar count a row
    // nobody can see.
    expect(useSelectionStore.getState().byPane[PANE]?.selected.size).toBe(0)
    expect(useHistoryStore.getState().entries.at(-1)?.kind).toBe('trash')
  })

  it('deletes permanently only after confirmation, and records nothing', async () => {
    const operations = setup()
    const file = await bridge.fs.createFile(scratch, 'notes.txt')

    const unsubscribe = useUiStore.subscribe((state) => {
      if (state.dialog?.kind === 'confirm') {
        unsubscribe()
        useUiStore.getState().resolveDialog(true)
      }
    })

    await act(() => operations.current.deletePermanently([file.path]))

    expect(await bridge.fs.exists(file.path)).toBe(false)
    expect(useHistoryStore.getState().entries).toHaveLength(0)
  })

  it('a declined confirmation deletes nothing', async () => {
    const operations = setup()
    const file = await bridge.fs.createFile(scratch, 'notes.txt')

    const unsubscribe = useUiStore.subscribe((state) => {
      if (state.dialog?.kind === 'confirm') {
        unsubscribe()
        useUiStore.getState().resolveDialog(false)
      }
    })

    await act(() => operations.current.deletePermanently([file.path]))
    expect(await bridge.fs.exists(file.path)).toBe(true)
  })
})

describe('undo', () => {
  it('restores a trashed file', async () => {
    const operations = setup()
    const file = await bridge.fs.createFile(scratch, 'notes.txt')

    await act(() => operations.current.moveToTrash([file.path]))
    expect(await bridge.fs.exists(file.path)).toBe(false)

    await act(() => operations.current.undo())

    expect(await bridge.fs.exists(file.path)).toBe(true)
    expect(useHistoryStore.getState().entries).toHaveLength(0)
  })

  it('reverses a rename', async () => {
    const operations = setup()
    const file = await bridge.fs.createFile(scratch, 'draft.txt')

    await act(async () => {
      await operations.current.rename(file.path, 'final.txt')
    })
    await act(() => operations.current.undo())

    expect(await bridge.fs.exists(file.path)).toBe(true)
    expect(await bridge.fs.exists(`${scratch}/final.txt`)).toBe(false)
  })

  it('removes the duplicates a paste created', async () => {
    const operations = setup()
    const source = await bridge.fs.createFolder(scratch, 'Source')
    const dest = await bridge.fs.createFolder(scratch, 'Dest')
    const file = await bridge.fs.createFile(source.path, 'notes.txt')

    act(() => operations.current.copy([file.path], source.path))
    await act(() => operations.current.paste(dest.path))
    expect(await bridge.fs.exists(`${dest.path}/notes.txt`)).toBe(true)

    await act(() => operations.current.undo())

    expect(await bridge.fs.exists(`${dest.path}/notes.txt`)).toBe(false)
    expect(await bridge.fs.exists(file.path)).toBe(true)
  })

  it('does nothing when there is nothing to undo', async () => {
    const operations = setup()
    await act(() => operations.current.undo())
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('reports when an item cannot be put back', async () => {
    const operations = setup()
    const file = await bridge.fs.createFile(scratch, 'notes.txt')
    await act(() => operations.current.moveToTrash([file.path]))
    // Something now occupies the path the undo wants to restore.
    await bridge.fs.createFile(scratch, 'notes.txt')

    await act(() => operations.current.undo())

    const toasts = useToastStore.getState().toasts
    expect(toasts.at(-1)?.tone).toBe('error')
    expect(toasts.at(-1)?.detail).toMatch(/already exists/)
  })
})
