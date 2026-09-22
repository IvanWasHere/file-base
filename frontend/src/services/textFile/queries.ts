/**
 * React Query bindings for the chunked reader (PLAN.md §M31).
 *
 * The bytes of a file are server state in exactly the sense
 * `services/filesystem/queries` means it: they live outside the app and are
 * read rather than decided. What is different here is that they must never
 * accumulate.
 */

import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { bridge } from '@/services/bridge'
import type { FileChunk } from '@/types/textFile'

export const textFileKeys = {
  all: ['textFile'] as const,
  chunk: (path: string, offset: number, size: number, snapToLine: boolean) =>
    [...textFileKeys.all, 'chunk', path, offset, size, { snapToLine }] as const,
}

/**
 * One window onto a file.
 *
 * `gcTime: 0` is the whole point, and the opposite of what a cache is usually
 * for: a reader stepping through a 100GB log would otherwise leave every window
 * it had visited in memory, and at 4MB a chunk it would take about twenty-five
 * pages to undo the entire feature. A window that nothing is looking at is
 * dropped immediately, and going back to it is one seek and one read — the
 * cheapest thing this app does.
 *
 * `staleTime: 0` for the reason the same file may be open in `tail -f`
 * somewhere: the reason to read a file this way is often that it is still being
 * written to, and a window re-read is a window re-read from disk.
 *
 * `keepPreviousData` is what stops all of that showing: the window on screen
 * stays put until the next one has landed, rather than blanking between
 * presses of Next.
 */
export function fileChunkQuery(path: string, offset: number, size: number, snapToLine: boolean) {
  return queryOptions<FileChunk>({
    queryKey: textFileKeys.chunk(path, offset, size, snapToLine),
    queryFn: () => bridge.textFile.readChunk(path, offset, size, snapToLine),
    enabled: path.length > 0,
    staleTime: 0,
    gcTime: 0,
    placeholderData: keepPreviousData,
    retry: false,
  })
}
