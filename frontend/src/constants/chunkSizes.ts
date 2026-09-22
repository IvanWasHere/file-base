/**
 * How much of a file the reader holds at once (PLAN.md §M31).
 *
 * Five sizes rather than one, because the right answer depends on what the
 * machine is and what the file is. 10 KB is the size that makes the feature's
 * claim literally true — a 100GB file on a 512MB machine — and it is a
 * miserable way to read a log, because every screenful is another press of
 * Next. 64 KB fills a window, 1 MB scrolls, and none of them is a fraction of
 * a percent of what the file itself would cost.
 *
 * The ceiling is `maxChunkSize` in `backend/textfile`, which clamps anything
 * larger: a chunk crosses the bridge as a JSON string, and past a few megabytes
 * it is the transfer and the rendering, not the disk, that makes the reader
 * feel slow.
 */

export interface ChunkSizeOption {
  bytes: number
  label: string
}

/** Ascending, which is the order the picker lists them in. */
export const CHUNK_SIZES: ChunkSizeOption[] = [
  { bytes: 10 * 1024, label: '10 KB' },
  { bytes: 64 * 1024, label: '64 KB' },
  { bytes: 256 * 1024, label: '256 KB' },
  { bytes: 1024 * 1024, label: '1 MB' },
  { bytes: 4 * 1024 * 1024, label: '4 MB' },
]

/**
 * What the reader opens on, and what a persisted value falls back to.
 *
 * 64 KB rather than the smallest: the default should be the one that reads
 * well, and someone who needs 10 KB is someone who knows why they need it.
 */
export const DEFAULT_CHUNK_SIZE = 64 * 1024

/** Whether a stored number is still one of the offered sizes. */
export function isChunkSize(bytes: number): boolean {
  return CHUNK_SIZES.some((option) => option.bytes === bytes)
}
