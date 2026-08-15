/**
 * Archive job orchestration (PLAN.md §M18).
 *
 * The subscribe-before-you-ask sequencing is M8's lesson for the third time:
 * the event stream and the call response are independent messages, so the
 * backend can emit progress — or finish outright, for a small archive — before
 * the promise carrying the id has resolved here. Everything that arrives early
 * is buffered and replayed once the id is known.
 */

import { bridge } from '@/services/bridge'
import type { ArchiveDone, ArchiveProgress, CreateRequest, ExtractRequest } from '@/types/archive'
import { FsError, isFsError } from '@/types/errors'
import { extname } from '@/utils/path'

/**
 * Extensions that make a file worth double-clicking as a folder.
 *
 * A hint, not the answer: the backend detects by content, and this only decides
 * whether to *ask* it. Getting this list wrong costs a double-click that opens
 * the file instead of browsing it, never a wrong extraction.
 */
const ARCHIVE_EXTENSIONS = new Set([
  'zip',
  '7z',
  'rar',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'tbz',
  'tbz2',
  'xz',
  'txz',
  'lzma',
  'lz4',
  'zst',
  'tzst',
  'br',
  'tbr',
  'sz',
  'z',
  'jar',
  'war',
  'apk',
  'ipa',
  'cbz',
  'cbr',
  'epub',
])

export function looksLikeArchive(name: string): boolean {
  return ARCHIVE_EXTENSIONS.has(extname(name))
}

/**
 * Compound suffixes, longest first, so `.tar.gz` is stripped whole.
 *
 * `utils/path.stem` removes one extension, which is right for `notes.txt` and
 * wrong for every `tar.*`: uncompressing `tree.tar.gz` with it produced a folder
 * called `tree.tar`, which is the name of a file that was never written. Mirrors
 * `StripArchiveExtension` in `backend/archive`.
 */
const ARCHIVE_SUFFIXES = [
  '.tar.gz',
  '.tar.bz2',
  '.tar.xz',
  '.tar.lzma',
  '.tar.lz4',
  '.tar.zst',
  '.tar.br',
  '.tar.sz',
  '.tar.z',
  '.tgz',
  '.tbz',
  '.tbz2',
  '.txz',
  '.tzst',
  '.tlz4',
  '.tbr',
  '.zip',
  '.7z',
  '.rar',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.lzma',
  '.lz4',
  '.zst',
  '.br',
  '.sz',
  '.z',
  '.jar',
  '.war',
  '.apk',
  '.ipa',
  '.cbz',
  '.cbr',
  '.epub',
]

/** The name an archive's contents should be extracted under. */
export function archiveStem(name: string): string {
  const lower = name.toLowerCase()
  for (const suffix of ARCHIVE_SUFFIXES) {
    if (lower.endsWith(suffix) && name.length > suffix.length) {
      return name.slice(0, name.length - suffix.length)
    }
  }
  return name
}

export interface ArchiveJobHandlers {
  onProgress: (progress: ArchiveProgress) => void
  onDone: (done: ArchiveDone) => void
  /** The job could not be started at all — a bad request or a dead bridge. */
  onFailed: (error: unknown) => void
}

type Starter = () => Promise<string>

/**
 * Runs one job and returns the function that cancels it.
 *
 * Safe to cancel before the id exists: a job cancelled that early is stopped
 * the moment it can be, rather than left extracting into a folder for a window
 * that has already closed.
 */
function runJob(start: Starter, handlers: ArchiveJobHandlers): () => void {
  let id: string | null = null
  let stopped = false

  const buffered: { progress: ArchiveProgress[]; done: ArchiveDone[] } = { progress: [], done: [] }

  const finish = (): void => {
    if (stopped) return
    stopped = true
    unsubscribe()
  }

  const deliverDone = (done: ArchiveDone): void => {
    handlers.onDone(done)
    // Nothing follows a Done, so the listeners come down with it rather than
    // accumulating one set per archive the user opens.
    finish()
  }

  const unsubscribe = bridge.archives.subscribe({
    onProgress: (progress) => {
      if (stopped) return
      if (id === null) buffered.progress.push(progress)
      else if (progress.id === id) handlers.onProgress(progress)
    },
    onDone: (done) => {
      if (stopped) return
      if (id === null) buffered.done.push(done)
      else if (done.id === id) deliverDone(done)
    },
  })

  void start().then(
    (started) => {
      if (stopped) {
        void bridge.archives.cancel(started)
        return
      }
      id = started
      for (const progress of buffered.progress) {
        if (progress.id === id) handlers.onProgress(progress)
      }
      for (const done of buffered.done) {
        if (done.id === id) deliverDone(done)
      }
    },
    (error: unknown) => {
      finish()
      handlers.onFailed(error)
    },
  )

  return () => {
    const hadId = id
    finish()
    if (hadId) void bridge.archives.cancel(hadId)
  }
}

export function startExtract(request: ExtractRequest, handlers: ArchiveJobHandlers): () => void {
  return runJob(() => bridge.archives.extract(request), handlers)
}

export function startCreate(request: CreateRequest, handlers: ArchiveJobHandlers): () => void {
  return runJob(() => bridge.archives.create(request), handlers)
}

/** A promise-shaped job, for callers that only care about the outcome. */
export function extractOnce(request: ExtractRequest): Promise<ArchiveDone> {
  return new Promise((resolve, reject) => {
    startExtract(request, {
      onProgress: () => undefined,
      onDone: (done) => {
        if (done.error) reject(done.error)
        else resolve(done)
      },
      onFailed: (error) => reject(isFsError(error) ? error : new FsError('unknown', String(error))),
    })
  })
}
