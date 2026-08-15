import { beforeEach, describe, expect, it, vi } from 'vitest'
import { archiveStem, looksLikeArchive, startCreate, startExtract } from './archiveService'
import {
  __mountState,
  __releaseAllMounts,
  MOUNT_GRACE_MS,
  acquireMount,
  existingMount,
  mountForPath,
  registerMount,
  releaseMount,
} from './mountRegistry'
import { isInsideAnyMount, MOUNT_PREFIX } from './mountPaths'
import { bridge } from '@/services/bridge'

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

beforeEach(() => {
  __releaseAllMounts()
})

describe('looksLikeArchive', () => {
  it('recognises the extensions worth double-clicking', () => {
    for (const name of ['a.zip', 'a.7z', 'a.rar', 'a.tar.gz', 'a.tgz', 'a.xz', 'book.cbz']) {
      expect(looksLikeArchive(name), name).toBe(true)
    }
  })

  // A hint, not the answer: the backend detects by content. Getting this wrong
  // costs a double-click that opens instead of browsing, never a wrong extraction.
  it('leaves ordinary files alone', () => {
    for (const name of ['notes.txt', 'photo.jpg', 'README', 'app.js']) {
      expect(looksLikeArchive(name), name).toBe(false)
    }
  })
})

describe('the mount registry', () => {
  it('counts panes and reclaims only when the last one leaves', () => {
    vi.useFakeTimers()
    const release = vi.spyOn(bridge.archives, 'releaseMount')

    // Registering holds nothing: the panes are the visitors, and counting the
    // registration too meant leaving could never reach zero.
    registerMount('/archives/photos.zip', '/tmp/m-1/photos.zip')
    acquireMount('/tmp/m-1/photos.zip')
    acquireMount('/tmp/m-1/photos.zip')
    expect(__mountState()[0]?.refs).toBe(2)

    releaseMount('/tmp/m-1/photos.zip')
    vi.advanceTimersByTime(MOUNT_GRACE_MS * 2)
    expect(release).not.toHaveBeenCalled()

    releaseMount('/tmp/m-1/photos.zip')
    vi.advanceTimersByTime(MOUNT_GRACE_MS * 2)
    expect(release).toHaveBeenCalledWith('/tmp/m-1/photos.zip')

    release.mockRestore()
    vi.useRealTimers()
  })

  // Back, Forward and a mis-click all drop the count to zero for a moment, and
  // re-extracting a 4GB archive because someone pressed Back is the feature at
  // its worst.
  it('cancels the reclaim when someone returns within the grace period', () => {
    vi.useFakeTimers()
    const release = vi.spyOn(bridge.archives, 'releaseMount')

    registerMount('/archives/photos.zip', '/tmp/m-2/photos.zip')
    acquireMount('/tmp/m-2/photos.zip')
    releaseMount('/tmp/m-2/photos.zip')
    vi.advanceTimersByTime(MOUNT_GRACE_MS / 2)

    acquireMount('/tmp/m-2/photos.zip')
    vi.advanceTimersByTime(MOUNT_GRACE_MS * 2)

    expect(release).not.toHaveBeenCalled()
    expect(existingMount('/archives/photos.zip')).toBe('/tmp/m-2/photos.zip')

    release.mockRestore()
    vi.useRealTimers()
  })

  // React invokes effect cleanups twice under StrictMode, and a double
  // decrement would reclaim a folder another pane is still showing — the same
  // guard M7's watch counts needed.
  it('floors the count at zero so a double release cannot over-decrement', () => {
    registerMount('/archives/a.zip', '/tmp/m-3/a.zip')
    acquireMount('/tmp/m-3/a.zip')
    acquireMount('/tmp/m-3/a.zip')
    releaseMount('/tmp/m-3/a.zip')
    releaseMount('/tmp/m-3/a.zip')
    releaseMount('/tmp/m-3/a.zip')
    expect(__mountState()[0]?.refs).toBe(0)
  })

  it('traces a path inside a mount back to its archive', () => {
    registerMount('/archives/photos.zip', '/tmp/m-4/photos.zip')
    expect(mountForPath('/tmp/m-4/photos.zip/holiday')?.archivePath).toBe('/archives/photos.zip')
    expect(mountForPath('/Users/dev/Documents')).toBeNull()
  })

  it('shares one extraction between two panes on the same archive', () => {
    registerMount('/archives/photos.zip', '/tmp/m-5/photos.zip')
    acquireMount('/tmp/m-5/photos.zip')
    acquireMount('/tmp/m-5/photos.zip')
    expect(__mountState()).toHaveLength(1)
    expect(__mountState()[0]?.refs).toBe(2)
  })

  // An extraction the user never reaches — navigation failed, or the pane
  // closed in between — is reclaimed on the same clock as one they left.
  it('reclaims a mount nobody ever entered', () => {
    vi.useFakeTimers()
    const release = vi.spyOn(bridge.archives, 'releaseMount')

    registerMount('/archives/never.zip', '/tmp/m-6/never.zip')
    vi.advanceTimersByTime(MOUNT_GRACE_MS * 2)

    expect(release).toHaveBeenCalledWith('/tmp/m-6/never.zip')
    release.mockRestore()
    vi.useRealTimers()
  })
})

describe('the session guard', () => {
  // The session outlives the mount by definition, so a pane restored inside one
  // would land in "this item no longer exists" on every launch.
  it('recognises a path inside a swept mount and offers where to go instead', () => {
    const inside = `/var/folders/xy/T/${MOUNT_PREFIX}8f3k2/Photos.zip/holiday`
    expect(isInsideAnyMount(inside)).toBe('/var/folders/xy/T')
    expect(isInsideAnyMount('/Users/dev/Documents')).toBeNull()
  })
})

describe('archive jobs', () => {
  it('creates an archive and extracts it back', async () => {
    const created: string[] = []
    startCreate(
      {
        sources: ['/Users/dev/Documents/Resume.pdf'],
        destination: '/Users/dev/Desktop/bundle.zip',
        format: 'zip',
        level: 5,
        password: '',
        splitBytes: 0,
      },
      {
        onProgress: () => undefined,
        onDone: (done) => created.push(done.error ? `err:${done.error.message}` : done.path),
        onFailed: (error) => created.push(`failed:${String(error)}`),
      },
    )
    await settle()
    expect(created).toEqual(['/Users/dev/Desktop/bundle.zip'])

    const back: string[] = []
    startExtract(
      {
        path: '/Users/dev/Desktop/bundle.zip',
        destination: '/Users/dev/Desktop/out',
        password: '',
        maxBytes: 0,
        maxEntries: 0,
        readOnly: false,
        collapseRoot: false,
      },
      {
        onProgress: () => undefined,
        onDone: (done) => back.push(done.error ? `err:${done.error.code}` : done.path),
        onFailed: (error) => back.push(`failed:${String(error)}`),
      },
    )
    await settle()
    expect(back).toEqual(['/Users/dev/Desktop/out'])
    expect(await bridge.fs.exists('/Users/dev/Desktop/out/Resume.pdf')).toBe(true)
  })

  // The one failure the caller reacts to by prompting rather than reporting.
  it('reports password-required as a typed code', async () => {
    startCreate(
      {
        sources: ['/Users/dev/Documents/Resume.pdf'],
        destination: '/Users/dev/Desktop/secret.zip',
        format: 'zip',
        level: 5,
        password: 'hunter2',
        splitBytes: 0,
      },
      { onProgress: () => undefined, onDone: () => undefined, onFailed: () => undefined },
    )
    await settle()

    const outcomes: string[] = []
    for (const password of ['', 'wrong', 'hunter2']) {
      startExtract(
        {
          path: '/Users/dev/Desktop/secret.zip',
          destination: `/Users/dev/Desktop/try-${password || 'none'}`,
          password,
          maxBytes: 0,
          maxEntries: 0,
          readOnly: false,
          collapseRoot: false,
        },
        {
          onProgress: () => undefined,
          onDone: (done) => outcomes.push(done.error ? done.error.code : 'ok'),
          onFailed: () => outcomes.push('failed'),
        },
      )
      await settle()
    }
    expect(outcomes).toEqual(['password-required', 'password-required', 'ok'])
  })

  // Closing the window means stop. Nothing must arrive afterwards.
  it('stops delivering once cancelled, even before the id exists', async () => {
    const seen: string[] = []
    const cancel = startExtract(
      {
        path: '/Users/dev/Desktop/bundle.zip',
        destination: '/Users/dev/Desktop/cancelled',
        password: '',
        maxBytes: 0,
        maxEntries: 0,
        readOnly: false,
        collapseRoot: false,
      },
      {
        onProgress: () => seen.push('progress'),
        onDone: () => seen.push('done'),
        onFailed: () => seen.push('failed'),
      },
    )
    cancel()
    await settle()
    expect(seen).toEqual([])
  })
})

describe('archiveStem', () => {
  /**
   * Found by running the app: `utils/path.stem` strips one extension, which is
   * right for `notes.txt` and wrong for every `tar.*` — uncompressing
   * `tree.tar.gz` produced a folder named `tree.tar`, after a file that was
   * never written.
   */
  it('strips a compound archive suffix whole', () => {
    expect(archiveStem('tree.tar.gz')).toBe('tree')
    expect(archiveStem('backup.tar.zst')).toBe('backup')
    expect(archiveStem('photos.zip')).toBe('photos')
    expect(archiveStem('release.tgz')).toBe('release')
  })

  it('leaves a name with no archive suffix alone', () => {
    expect(archiveStem('README')).toBe('README')
    // The dots inside an ordinary name are not extensions to strip.
    expect(archiveStem('report.2026.final.zip')).toBe('report.2026.final')
  })
})
