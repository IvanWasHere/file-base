import { useVirtualizer } from '@tanstack/react-virtual'
import { Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlgorithmList } from './AlgorithmList'
import { HashRow } from './HashRow'
import { VerifyField } from './VerifyField'
import { algorithmSpec } from '@/constants/hashAlgorithms'
import { useHashes } from '@/hooks/useHashes'
import { normalizeChecksum } from '@/services/hashing/hashService'
import { toast } from '@/stores/toastStore'
import { useUiStore } from '@/stores/uiStore'
import { formatCount } from '@/utils/format'

/**
 * The hash modal (PLAN.md M14).
 *
 * Its own `uiStore` field rather than the dialog stack: `dialog` is a one-shot
 * question with a promise waiting on the answer, and this is a long-lived view
 * with internal state that resolves nothing (decision 12). It renders above the
 * dialog host, so a confirmation raised from underneath it is still visible.
 *
 * Closing cancels. So does switching algorithm — both fall out of `useHashes`
 * tearing its job down, which is why neither needed a code path of its own.
 */
export function HashModal() {
  const job = useUiStore((state) => state.hashJob)
  // Split so the hook only ever runs with a job to work on: mounting the panel
  // is what starts the work, and unmounting it is what cancels.
  if (!job) return null
  return <HashPanel paths={job.paths} />
}

/**
 * Rows are uniform within a run, because every row shows the same algorithm's
 * digest — so the height is one decision per algorithm rather than a measured
 * one per row. Anything past ~88 hex characters wraps to a second line in this
 * modal's width, which is SHA-384 and SHA-512.
 */
function rowHeight(digestLength: number): number {
  return digestLength > 88 ? 62 : 46
}

function HashPanel({ paths }: { paths: string[] }) {
  const algorithm = useUiStore((state) => state.hashAlgorithm)
  const setAlgorithm = useUiStore((state) => state.setHashAlgorithm)
  const close = useUiStore((state) => state.closeHashes)

  const { rows, status, skippedFolders, missing, matches, message } = useHashes(paths, algorithm)

  const [expected, setExpected] = useState('')
  const normalized = useMemo(() => normalizeChecksum(expected), [expected])

  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Focus moves into the modal so Escape and Tab work without a click.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  const size = rowHeight(algorithmSpec(algorithm).digestLength)

  // Selecting 5,000 files and hitting `#` is a thing people will do
  // (decision 14).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => size,
    overscan: 8,
  })

  const measure = virtualizer.measure
  useEffect(() => {
    measure()
  }, [size, measure])

  const completed = rows.filter((row) => row.status === 'done')
  const verifiedMatch = normalized.length > 0 && completed.some((row) => row.digest === normalized)

  const copy = (text: string, what: string): void => {
    void navigator.clipboard.writeText(text).then(
      () => toast.info(what),
      () => toast.error('Could not copy to the clipboard'),
    )
  }

  // `<hash>  <name>` lines, which is what `shasum -c` reads. Dragging out to
  // Finder remains impossible (PLAN.md §3), so the clipboard is the way across
  // — the same conclusion M9 reached with Copy Path.
  const copyAll = (): void => {
    const lines = completed.map((row) => `${row.digest}  ${row.item.name}`)
    if (lines.length === 0) return
    copy(lines.join('\n'), `Copied ${formatCount(lines.length, 'checksum')}`)
  }

  const notes = [
    skippedFolders > 0 ? `${formatCount(skippedFolders, 'folder')} skipped` : '',
    missing > 0 ? `${formatCount(missing, 'item')} no longer there` : '',
  ].filter(Boolean)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6"
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
        aria-label="Calculate Hashes"
        className="bg-elevated border-edge flex h-[70vh] max-h-[640px] w-[900px] max-w-[94vw] flex-col overflow-hidden rounded-xl border shadow-2xl"
      >
        <div className="border-edge flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <h2 className="font-display text-primary flex-1 text-[15px] font-semibold">
            Calculate Hashes
          </h2>
          {status === 'running' && <Loader2 size={14} className="text-muted animate-spin" />}
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

        <div className="flex min-h-0 flex-1">
          <AlgorithmList value={algorithm} onChange={setAlgorithm} />

          <div className="flex min-w-0 flex-1 flex-col p-3">
            <VerifyField
              value={expected}
              normalized={normalized}
              algorithm={algorithm}
              matched={verifiedMatch}
              onChange={setExpected}
            />

            <div
              ref={scrollRef}
              role="table"
              aria-label="Files and digests"
              className="mt-2 min-h-0 flex-1 overflow-auto"
            >
              {status === 'reading' ? (
                <p className="text-muted p-3 text-[13px]">Reading the selection…</p>
              ) : rows.length === 0 ? (
                <p className="text-muted p-3 text-[13px]">
                  {status === 'error'
                    ? message
                    : 'Nothing here can be hashed. Folders have no checksum.'}
                </p>
              ) : (
                <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                  {virtualizer.getVirtualItems().map((virtual) => {
                    const row = rows[virtual.index]
                    if (!row) return null
                    return (
                      <div
                        key={row.item.path}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: virtual.size,
                          transform: `translateY(${virtual.start}px)`,
                        }}
                      >
                        <HashRow
                          row={row}
                          matchCount={matches.get(row.digest)}
                          verified={
                            normalized.length > 0 &&
                            row.status === 'done' &&
                            row.digest === normalized
                          }
                          onCopy={(digest) => copy(digest, 'Copied digest')}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="mt-2 flex shrink-0 items-center gap-3">
              <span className="text-muted flex-1 truncate text-[11px]">
                {status === 'error' && message
                  ? message
                  : status === 'cancelled'
                    ? 'Stopped.'
                    : notes.join(' · ')}
              </span>
              <button
                type="button"
                onClick={copyAll}
                disabled={completed.length === 0}
                title="Copy as shasum lines"
                className="border-edge text-secondary hover:bg-hover hover:text-primary rounded-md border px-3 py-1.5 text-[13px] transition-colors disabled:cursor-default disabled:opacity-30"
              >
                Copy All
              </button>
              <button
                type="button"
                onClick={close}
                className="text-accent rounded-md bg-[var(--accent-glow)] px-3 py-1.5 text-[13px] transition-colors hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
