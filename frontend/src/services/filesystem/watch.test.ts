import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fsKeys } from './queries'
import { __watchCount, acquireWatch, invalidateFor, startWatchInvalidation } from './watch'
import { bridge } from '@/services/bridge'
import type { FileSystemEvent } from '@/types/file'

const DIR = '/Users/dev/Documents'

function event(overrides: Partial<FileSystemEvent> = {}): FileSystemEvent {
  return { dir: DIR, kinds: ['create'], paths: [], gone: false, ...overrides }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('reference counting', () => {
  // A single pane reads its directory three times — listing, preview and status
  // bar — and two split panes on the same folder make six.
  it('watches once however many consumers there are', () => {
    const watch = vi.spyOn(bridge.watcher, 'watch')

    const first = acquireWatch(DIR)
    const second = acquireWatch(DIR)
    const third = acquireWatch(DIR)

    expect(watch).toHaveBeenCalledTimes(1)
    expect(__watchCount(DIR)).toBe(3)

    const unwatch = vi.spyOn(bridge.watcher, 'unwatch')
    first()
    second()
    expect(unwatch).not.toHaveBeenCalled()

    third()
    expect(unwatch).toHaveBeenCalledExactlyOnceWith(DIR)
    expect(__watchCount(DIR)).toBe(0)
  })

  // React invokes cleanups twice under StrictMode; a double decrement would
  // drop a watch another pane still depends on.
  it('ignores a release that runs twice', () => {
    const unwatch = vi.spyOn(bridge.watcher, 'unwatch')

    const first = acquireWatch(DIR)
    const second = acquireWatch(DIR)

    first()
    first()
    expect(unwatch).not.toHaveBeenCalled()
    expect(__watchCount(DIR)).toBe(1)

    second()
    expect(unwatch).toHaveBeenCalledTimes(1)
  })

  it('normalises paths so trailing slashes share one watch', () => {
    const watch = vi.spyOn(bridge.watcher, 'watch')

    acquireWatch(DIR)
    acquireWatch(`${DIR}/`)

    expect(watch).toHaveBeenCalledTimes(1)
    expect(__watchCount(DIR)).toBe(2)
  })

  // Watching is an optimisation. A folder the backend declines — too large,
  // permission denied, unmounted — must still be browsable.
  it('survives a backend that refuses to watch', () => {
    vi.spyOn(bridge.watcher, 'watch').mockRejectedValueOnce(new Error('too large'))
    expect(() => acquireWatch(DIR)()).not.toThrow()
  })
})

describe('invalidation', () => {
  it('invalidates the changed directory', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateFor(queryClient, event())

    expect(invalidate).toHaveBeenCalledWith({ queryKey: fsKeys.directoryRoot(DIR) })
  })

  // The refetch of a vanished directory is what puts the pane into its error
  // state; its parent's listing is now wrong too.
  it('also invalidates the parent when the directory itself is gone', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateFor(queryClient, event({ gone: true, kinds: ['remove'] }))

    expect(invalidate).toHaveBeenCalledWith({ queryKey: fsKeys.directoryRoot(DIR) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: fsKeys.directoryRoot('/Users/dev') })
  })

  it('refreshes the volume list when /Volumes changes', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateFor(queryClient, event({ dir: '/Volumes' }))

    expect(invalidate).toHaveBeenCalledWith({ queryKey: fsKeys.volumes() })
  })

  it('invalidates per-item metadata for the paths that changed', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateFor(queryClient, event({ paths: [`${DIR}/notes.txt`] }))

    expect(invalidate).toHaveBeenCalledWith({ queryKey: fsKeys.info(`${DIR}/notes.txt`) })
  })
})

describe('end to end through the bridge', () => {
  it('a change in a watched directory refreshes its cached listing', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const stop = startWatchInvalidation(queryClient)
    const release = acquireWatch(DIR)

    await queryClient.prefetchQuery({
      queryKey: fsKeys.directory(DIR, false),
      queryFn: () => bridge.fs.readDirectory(DIR, { includeHidden: false }),
    })
    const before = queryClient.getQueryState(fsKeys.directory(DIR, false))

    // An external change — nothing in the UI initiated this.
    await bridge.fs.createFile(DIR, 'appeared.txt')

    const after = queryClient.getQueryState(fsKeys.directory(DIR, false))
    expect(after?.isInvalidated).toBe(true)
    expect(before?.isInvalidated).toBe(false)

    release()
    stop()
  })
})
