import { FileWarning, Loader2, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { ReaderControls } from './ReaderControls'
import { useFileWindow } from '@/hooks/useFileWindow'
import { useUiStore } from '@/stores/uiStore'
import { basename } from '@/utils/path'

/**
 * The built-in text reader (PLAN.md §M31).
 *
 * It opens a 100GB file on a machine that could not hold a hundredth of it,
 * because it never opens the file — it opens one window onto it. What is on
 * screen is a path, an offset and a chunk size, and the cost of showing it is
 * the chunk size, whatever the file happens to be.
 *
 * A modal rather than a view mode (decision 1). M13's Photos view earned its
 * place in the pane by being a way of *browsing a folder*; this is a way of
 * looking inside one file, with a keyboard of its own and nothing to say about
 * the folder it came from.
 *
 * Read-only (decision 9). Replacing a run of bytes with a different number of
 * bytes shifts everything after it, which for a file this size is a rewrite
 * wearing an edit's clothes.
 */
export function TextReaderModal() {
  const request = useUiStore((state) => state.textReader)
  // Split so the hook only ever runs with a file to read, and keyed on the path
  // so opening a second file starts at its beginning rather than at the last
  // one's offset — which, on a smaller file, is not even a position that exists.
  if (!request) return null
  return <ReaderPanel key={request.path} path={request.path} />
}

/** Whether a scroll container is showing its last line, within a pixel. */
function atBottom(view: HTMLElement): boolean {
  return view.scrollTop + view.clientHeight >= view.scrollHeight - 1
}

function ReaderPanel({ path }: { path: string }) {
  const close = useUiStore((state) => state.closeTextReader)
  const chunkSize = useUiStore((state) => state.readerChunkSize)
  const setChunkSize = useUiStore((state) => state.setReaderChunkSize)
  const snapToLine = useUiStore((state) => state.readerSnapToLine)
  const setSnapToLine = useUiStore((state) => state.setReaderSnapToLine)

  const reader = useFileWindow(path, chunkSize, snapToLine)
  const { chunk, landing, message, isPending, isFetching } = reader

  const panelRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLPreElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Focus moves into the modal so Escape and Tab work without a click.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // A new window is read from the edge the step came from: forwards lands at
  // the top, backwards at the bottom, so paging either way is continuous
  // (decision 8). Keyed on the chunk object, which is replaced only when a read
  // lands — `keepPreviousData` leaves it alone while the next one is in flight.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !chunk) return
    view.scrollTop = landing === 'bottom' ? view.scrollHeight : 0
  }, [chunk, landing])

  /**
   * PageDown and PageUp step the *file* once the window has been read through.
   *
   * Until then they scroll the window, which is what they do everywhere else —
   * at 1MB a chunk there can be thousands of lines on screen, and a key that
   * jumped the file from the first of them would make the larger chunk sizes
   * unusable. At the edge there is nothing left to scroll, so the same key
   * carries on into the next window and arrives at its first line.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLPreElement>) => {
    const view = viewRef.current
    if (!view || event.metaKey || event.ctrlKey || event.altKey) return

    if (event.key === 'PageDown' && atBottom(view) && !reader.atEnd) {
      event.preventDefault()
      reader.next()
    }
    if (event.key === 'PageUp' && view.scrollTop <= 0 && !reader.atStart) {
      event.preventDefault()
      reader.previous()
    }
  }

  return (
    <div
      className="bg-overlay fixed inset-0 z-[60] flex items-center justify-center p-6"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) close()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-label="Text Reader"
        className="bg-elevated border-edge flex h-[78vh] max-h-[760px] w-[980px] max-w-[94vw] flex-col overflow-hidden rounded-xl border shadow-2xl"
      >
        <div className="border-edge flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <h2 className="font-display text-primary min-w-0 flex-1 truncate text-[15px] font-semibold">
            {basename(path)}
          </h2>
          {isFetching && <Loader2 size={14} className="text-muted animate-spin" />}
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={close}
            className="text-muted hover:bg-hover hover:text-primary flex size-7 items-center justify-center rounded-md transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {message ? (
          <div className="text-muted flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <FileWarning size={22} strokeWidth={1.25} className="opacity-50" />
            <span className="text-[13px]">{message}</span>
          </div>
        ) : (
          <pre
            ref={viewRef}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            aria-label="File contents"
            aria-busy={isPending}
            className="text-secondary min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[12px] leading-[1.55] whitespace-pre outline-none"
          >
            {isPending
              ? ''
              : // An empty string is what an empty file looks like, and also
                // what the end of a file looks like. Neither is an error, and
                // neither should leave the reader looking broken.
                (chunk?.data ?? '') ||
                (reader.fileSize === 0 ? '(empty file)' : '(nothing at this offset)')}
          </pre>
        )}

        <ReaderControls
          reader={reader}
          chunkSize={chunkSize}
          onChunkSize={setChunkSize}
          snapToLine={snapToLine}
          onSnapToLine={setSnapToLine}
        />
      </div>
    </div>
  )
}
