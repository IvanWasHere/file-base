import { describe, expect, it, vi } from 'vitest'
import {
  __resetDigestCache,
  cachedDigest,
  looksLikeDigest,
  normalizeChecksum,
  rememberDigest,
  startHashJob,
} from './hashService'
import { bridge } from '@/services/bridge'
import type { FileItem } from '@/types/file'
import type { HashDone, HashProgress, HashResult } from '@/types/hashing'

function file(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: '/Users/dev/a.txt',
    path: '/Users/dev/a.txt',
    name: 'a.txt',
    extension: 'txt',
    size: 100,
    isDirectory: false,
    createdAt: 1,
    modifiedAt: 2,
    permissions: '-rw-r--r--',
    hidden: false,
    symlink: false,
    mimeType: 'text/plain',
    category: 'document',
    broken: false,
    ...overrides,
  }
}

describe('the digest cache', () => {
  it('answers for the same file under the same algorithm', () => {
    __resetDigestCache()
    const item = file()
    rememberDigest(item, 'sha256', 'abc123')

    expect(cachedDigest(item, 'sha256')).toBe('abc123')
  })

  // Switching algorithm re-reads the file; the point of the cache is that
  // switching *back* does not.
  it('does not answer across algorithms', () => {
    __resetDigestCache()
    const item = file()
    rememberDigest(item, 'sha256', 'abc123')

    expect(cachedDigest(item, 'md5')).toBeUndefined()
  })

  // The whole reason the cache is keyed on size and mtime rather than path
  // alone: a file edited while the modal is open is a different file, and a
  // digest that outlived its bytes is a wrong answer to the only question this
  // feature exists to answer.
  it('does not answer for a file that has changed', () => {
    __resetDigestCache()
    rememberDigest(file(), 'sha256', 'abc123')

    expect(cachedDigest(file({ modifiedAt: 999 }), 'sha256')).toBeUndefined()
    expect(cachedDigest(file({ size: 101 }), 'sha256')).toBeUndefined()
  })
})

describe('normalizeChecksum', () => {
  // What is on the clipboard is rarely a bare digest.
  it.each([
    ['e3b0c44298fc1c14', 'e3b0c44298fc1c14'],
    ['  e3b0c44298fc1c14  ', 'e3b0c44298fc1c14'],
    ['E3B0C44298FC1C14', 'e3b0c44298fc1c14'],
    ['e3b0c44298fc1c14  installer.dmg', 'e3b0c44298fc1c14'],
    ['e3b0c44298fc1c14 *installer.dmg', 'e3b0c44298fc1c14'],
    ['', ''],
  ])('reads %o as %o', (pasted, expected) => {
    expect(normalizeChecksum(pasted)).toBe(expected)
  })
})

describe('looksLikeDigest', () => {
  it('accepts hex and rejects everything else', () => {
    expect(looksLikeDigest('deadbeef')).toBe(true)
    expect(looksLikeDigest('not a checksum')).toBe(false)
    expect(looksLikeDigest('')).toBe(false)
  })
})

/**
 * The mock delivers its first result on a microtask, before the promise
 * carrying the job id has resolved — deliberately, because that is the ordering
 * the real Wails IPC has. These tests are what makes that ordering safe.
 */
describe('startHashJob', () => {
  const collect = () => {
    const results: HashResult[] = []
    const progress: HashProgress[] = []
    const done: HashDone[] = []
    const failed: unknown[] = []
    return {
      results,
      progress,
      done,
      failed,
      handlers: {
        onResult: (result: HashResult) => results.push(result),
        onProgress: (event: HashProgress) => progress.push(event),
        onDone: (event: HashDone) => done.push(event),
        onFailed: (error: unknown) => failed.push(error),
      },
    }
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

  it('delivers every result, including any that arrive before the id does', async () => {
    const sink = collect()
    startHashJob(
      {
        paths: ['/Users/dev/Documents/Resume.pdf', '/Users/dev/Documents/Meeting Notes.docx'],
        algorithm: 'sha256',
      },
      sink.handlers,
    )
    await settle()

    expect(sink.results.map((result) => result.path)).toEqual([
      '/Users/dev/Documents/Resume.pdf',
      '/Users/dev/Documents/Meeting Notes.docx',
    ])
    expect(sink.done).toHaveLength(1)
    expect(sink.done[0]?.completed).toBe(2)
  })

  // Closing the modal means stop. Nothing must arrive afterwards, or a closed
  // window would still be writing into state nobody is looking at.
  it('stops delivering once cancelled, even before the id exists', async () => {
    const sink = collect()
    const cancel = startHashJob(
      {
        paths: ['/Users/dev/Documents/Resume.pdf', '/Users/dev/Documents/Meeting Notes.docx'],
        algorithm: 'sha256',
      },
      sink.handlers,
    )
    cancel()
    await settle()

    expect(sink.results).toHaveLength(0)
    expect(sink.done).toHaveLength(0)
  })

  // A job that never started has nothing to report through the result stream,
  // so the failure has to come back some other way or the modal spins forever.
  it('reports a job that could not start', async () => {
    const sink = collect()
    const hash = vi.spyOn(bridge.hashing, 'hash').mockRejectedValueOnce(new Error('no bridge'))

    startHashJob({ paths: ['/Users/dev/Documents/Resume.pdf'], algorithm: 'sha256' }, sink.handlers)
    await settle()

    expect(sink.failed).toHaveLength(1)
    hash.mockRestore()
  })

  // Equal content produces an equal digest — the property the match-grouping
  // and the verify field are written against (PLAN.md M14 decision 15).
  it('gives two identical mock files the same digest', async () => {
    await bridge.fs.copy(['/Users/dev/Documents/Resume.pdf'], '/Users/dev/Desktop', 'keep-both')

    const sink = collect()
    startHashJob(
      {
        paths: ['/Users/dev/Documents/Resume.pdf', '/Users/dev/Desktop/Resume.pdf'],
        algorithm: 'sha256',
      },
      sink.handlers,
    )
    await settle()

    expect(sink.results).toHaveLength(2)
    expect(sink.results[0]?.digest).toBe(sink.results[1]?.digest)
    // …and of the right shape, or nothing downstream is being exercised.
    expect(sink.results[0]?.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('gives different content different digests', async () => {
    const sink = collect()
    startHashJob(
      {
        paths: ['/Users/dev/Documents/Resume.pdf', '/Users/dev/Documents/Meeting Notes.docx'],
        algorithm: 'sha256',
      },
      sink.handlers,
    )
    await settle()

    expect(sink.results[0]?.digest).not.toBe(sink.results[1]?.digest)
  })

  it('gives each algorithm a digest of its own length', async () => {
    for (const [algorithm, length] of [
      ['crc32', 8],
      ['md5', 32],
      ['sha1', 40],
      ['sha512', 128],
    ] as const) {
      const sink = collect()
      startHashJob({ paths: ['/Users/dev/Documents/Resume.pdf'], algorithm }, sink.handlers)
      await settle()

      expect(sink.results[0]?.digest).toMatch(new RegExp(`^[0-9a-f]{${length}}$`))
    }
  })
})
