import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { CHUNK_SIZES } from '@/constants/chunkSizes'
import type { FileWindow } from '@/hooks/useFileWindow'
import { formatSize } from '@/utils/format'

/**
 * Everything under the text: where in the file this window is, and how to
 * choose a different one (PLAN.md §M31).
 *
 * Every number here is read back from the chunk rather than from what was
 * asked for, which is why the readout can be trusted: it is a statement about
 * bytes that have actually been read, not about a request that may have been
 * snapped to a line boundary or clamped against a file that shrank.
 */

interface ReaderControlsProps {
  reader: FileWindow
  chunkSize: number
  onChunkSize: (bytes: number) => void
  snapToLine: boolean
  onSnapToLine: (snap: boolean) => void
}

/**
 * Digits, however they were typed.
 *
 * Separators are stripped rather than rejected because the readout above the
 * field prints them — someone reading "184,320" off the screen and typing it
 * back has done nothing wrong. Anything left over makes the entry invalid, so
 * a typo is a field that refuses rather than a jump to byte 0.
 */
function parseOffset(text: string): number | undefined {
  const digits = text.replace(/[,_\s]/g, '')
  if (!/^\d+$/.test(digits)) return undefined
  return Number(digits)
}

export function ReaderControls({
  reader,
  chunkSize,
  onChunkSize,
  snapToLine,
  onSnapToLine,
}: ReaderControlsProps) {
  const { fileSize, offset, end, atStart, atEnd } = reader

  // The slider picks a *window*, not a byte: its range stops one chunk short of
  // the end, so dragging it fully right lands on the last full window rather
  // than on a window of nothing (decision 7).
  const furthest = Math.max(0, fileSize - chunkSize)

  // The field follows the window, so it always opens on where the reader
  // actually is — and after a jump it shows where the jump landed, which is
  // not always where it was aimed.
  //
  // Adjusted during render against the offset it was last set from, rather
  // than assigned in an effect: an effect that synchronously resets state
  // cascades a second render every time, and leaves one frame showing the
  // previous window's offset (the shape §M14 settled on).
  const [target, setTarget] = useState(String(offset))
  const [shownFor, setShownFor] = useState(offset)
  if (shownFor !== offset) {
    setShownFor(offset)
    setTarget(String(offset))
  }

  const typed = parseOffset(target)
  const invalid = target !== '' && typed === undefined

  return (
    <div className="border-edge shrink-0 border-t px-3 py-2">
      <input
        type="range"
        min={0}
        max={furthest}
        // Snapped to chunk boundaries, so a dragged slider asks for the same
        // offsets Next and Previous do — and asks for far fewer of them than
        // a byte-accurate range would, each one being a real read.
        step={chunkSize}
        value={Math.min(offset, furthest)}
        aria-label="Position in file"
        disabled={furthest === 0}
        onChange={(event) => reader.goTo(Number(event.target.value))}
        className="accent-accent h-1 w-full cursor-pointer disabled:cursor-default disabled:opacity-40"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Previous chunk"
          title="Previous chunk"
          onClick={reader.previous}
          disabled={atStart}
          className="border-edge text-secondary hover:bg-hover hover:text-primary flex size-7 items-center justify-center rounded-md border transition-colors disabled:cursor-default disabled:opacity-30"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          aria-label="Next chunk"
          title="Next chunk"
          onClick={reader.next}
          disabled={atEnd}
          className="border-edge text-secondary hover:bg-hover hover:text-primary flex size-7 items-center justify-center rounded-md border transition-colors disabled:cursor-default disabled:opacity-30"
        >
          <ChevronRight size={14} />
        </button>

        <label className="text-muted flex items-center gap-1.5 text-[11px]">
          Chunk
          <select
            aria-label="Chunk size"
            value={chunkSize}
            onChange={(event) => onChunkSize(Number(event.target.value))}
            className="border-edge bg-base text-primary rounded-md border px-1.5 py-1 text-[12px] outline-none focus:border-[var(--accent)]"
          >
            {CHUNK_SIZES.map((option) => (
              <option key={option.bytes} value={option.bytes}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-muted flex items-center gap-1.5 text-[11px]">
          <input
            type="checkbox"
            checked={snapToLine}
            onChange={(event) => onSnapToLine(event.target.checked)}
            className="accent-accent"
          />
          Whole lines
        </label>

        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (typed !== undefined) reader.goTo(typed)
          }}
        >
          <label className="text-muted text-[11px]" htmlFor="reader-offset">
            Offset
          </label>
          <input
            id="reader-offset"
            value={target}
            inputMode="numeric"
            aria-label="Go to offset"
            aria-invalid={invalid}
            onChange={(event) => setTarget(event.target.value)}
            // Escape and the arrows belong to the reader, not to a text field
            // that happens to have focus; Enter is the one key this owns.
            onKeyDown={(event) => event.stopPropagation()}
            className={`border-edge bg-base text-primary w-28 rounded-md border px-2 py-1 font-mono text-[12px] outline-none focus:border-[var(--accent)] ${
              invalid ? 'border-danger' : ''
            }`}
          />
          <button
            type="submit"
            disabled={typed === undefined}
            className="border-edge text-secondary hover:bg-hover hover:text-primary rounded-md border px-2 py-1 text-[12px] transition-colors disabled:cursor-default disabled:opacity-30"
          >
            Go
          </button>
        </form>

        <button
          type="button"
          aria-label="Re-read this chunk"
          title="Re-read this chunk"
          onClick={reader.refresh}
          className="border-edge text-secondary hover:bg-hover hover:text-primary flex size-7 items-center justify-center rounded-md border transition-colors"
        >
          <RefreshCw size={12} />
        </button>

        {/* Bytes rather than lines, and the file's size beside them: a line
            number here would be a lie about a file nobody has counted
            (decision 2). */}
        <span className="text-muted ml-auto font-mono text-[11px] whitespace-nowrap">
          {end > offset
            ? `${offset.toLocaleString()}–${(end - 1).toLocaleString()}`
            : offset.toLocaleString()}
          {' of '}
          {fileSize.toLocaleString()} bytes ({formatSize(fileSize, '0 B')})
        </span>
      </div>
    </div>
  )
}
