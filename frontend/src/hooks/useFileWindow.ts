/**
 * Where in a file the reader is looking (PLAN.md §M31).
 *
 * The whole model is three numbers — a path, an offset and a chunk size — and
 * the invariant that makes a 100GB file cost the same as a 10KB one is that
 * nothing here ever holds more than one chunk. There is no buffer, no
 * accumulated text, and no line index: a line number at offset 52,428,800,000
 * cannot be known without having read everything in front of it, which is the
 * one thing the reader must never do (decision 2).
 *
 * The offset asked for and the offset arrived at are two different numbers, and
 * only the second one is ever shown. Go snaps a window back to a line boundary
 * and clamps one that points past the end of a file that has since been
 * truncated, so every step is taken from where the last chunk actually landed.
 */

import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fileChunkQuery } from '@/services/textFile/queries'
import { describeFsError, isFsError } from '@/types/errors'
import type { FileChunk } from '@/types/textFile'

/** Which edge a newly arrived window should be read from. */
export type Landing = 'top' | 'bottom'

export interface FileWindow {
  chunk: FileChunk | undefined
  /** Bytes in the file, as of the last read. 0 until the first one lands. */
  fileSize: number
  /** Where the window on screen starts — Go's answer, not the request. */
  offset: number
  /** One past its last byte, which is also where Next goes. */
  end: number
  atStart: boolean
  atEnd: boolean
  /** True while the first window is being read; a step keeps the old one up. */
  isPending: boolean
  isFetching: boolean
  /** Empty when the read succeeded. */
  message: string
  /**
   * Which edge of the new window the reader should show. Part of the request
   * rather than a ref, so it arrives with the window it describes: paging
   * backwards lands at the bottom of the previous window rather than at the
   * top of it (decision 8).
   */
  landing: Landing
  next: () => void
  previous: () => void
  /** Clamped here as well as in Go, so the slider cannot ask for nonsense. */
  goTo: (offset: number) => void
  first: () => void
  last: () => void
  /** Re-reads the current window — what a file still being written to needs. */
  refresh: () => void
}

export function useFileWindow(path: string, chunkSize: number, snapToLine: boolean): FileWindow {
  // What was *asked for*, and which way the ask was going. Everything displayed
  // comes from the chunk, which says where the read actually landed.
  const [request, setRequest] = useState<{ offset: number; landing: Landing }>({
    offset: 0,
    landing: 'top',
  })

  const query = useQuery(fileChunkQuery(path, request.offset, chunkSize, snapToLine))
  const chunk = query.data

  const fileSize = chunk?.fileSize ?? 0
  const offset = chunk?.offset ?? request.offset
  const end = offset + (chunk?.length ?? 0)

  const move = useCallback((target: number, landing: Landing) => {
    setRequest({ offset: Math.max(0, Math.round(target)), landing })
  }, [])

  return {
    chunk,
    fileSize,
    offset,
    end,
    atStart: offset <= 0,
    // Only once a window has been read: before that, "at the end" and "at the
    // start" would both be true of a file nothing is known about, and the step
    // buttons would open disabled.
    atEnd: chunk !== undefined && end >= fileSize,
    isPending: query.isPending,
    isFetching: query.isFetching,
    message: query.error
      ? isFsError(query.error)
        ? describeFsError(query.error)
        : 'This file could not be read.'
      : '',
    landing: request.landing,
    // From the end of the window on screen, never from `requested + chunkSize`:
    // a snapped window is shorter than it was asked to be, and stepping by the
    // nominal size would skip the tail of every one of them.
    next: () => {
      if (chunk === undefined || end >= fileSize) return
      move(end, 'top')
    },
    previous: () => {
      if (offset <= 0) return
      move(offset - chunkSize, 'bottom')
    },
    goTo: (target) => move(Math.min(Math.max(target, 0), fileSize), 'top'),
    first: () => move(0, 'top'),
    // One chunk back from the end rather than the end itself, which would be a
    // window of nothing.
    last: () => move(Math.max(0, fileSize - chunkSize), 'bottom'),
    refresh: () => void query.refetch(),
  }
}
