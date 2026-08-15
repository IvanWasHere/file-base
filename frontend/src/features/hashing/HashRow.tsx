import { Check, Copy } from 'lucide-react'
import { memo } from 'react'
import { FileIcon } from '@/components/common/FileIcon'
import type { HashRow as Row } from '@/hooks/useHashes'
import { describeFsError } from '@/types/errors'
import { formatCount, formatSize } from '@/utils/format'

/**
 * One file's row in the hash modal (PLAN.md M14).
 *
 * The digest is the point, so it gets the monospace column and the copy button.
 * Everything else on the row exists to answer a question the digest raises:
 * *is it done yet* (the byte bar), *is it the same as that one* (the match
 * badge), *is it the one I pasted* (the verified tick), *why is it not there*
 * (the error).
 */

function Bar({ read, total }: { read: number; total: number }) {
  // Byte-level, not file-level: the common case is one large file, where a
  // count-based bar reads 0/1 for four minutes and then finishes (decision 5).
  const fraction = total > 0 ? Math.min(read / total, 1) : 0
  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={read}
        className="bg-hover h-1 w-32 overflow-hidden rounded-full"
      >
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-150"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <span className="text-muted text-[11px] tabular-nums">
        {formatSize(read, '0 B')} of {formatSize(total, '0 B')}
      </span>
    </div>
  )
}

export const HashRow = memo(function HashRow({
  row,
  matchCount,
  verified,
  onCopy,
}: {
  row: Row
  /** How many rows share this digest, when more than one does. */
  matchCount: number | undefined
  /** This row's digest is the one pasted into the verify field. */
  verified: boolean
  onCopy: (digest: string) => void
}) {
  const { item } = row

  return (
    <div
      // A row is a row: the modal is a table of files and their digests, and
      // assistive technology should be able to say which is which.
      role="row"
      aria-label={item.name}
      className={`flex items-center gap-3 rounded-md px-2 py-1.5 ${
        verified ? 'bg-[var(--accent-glow)]' : ''
      }`}
    >
      <FileIcon category={item.category} size={16} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="text-primary truncate text-[13px]" title={item.path}>
            {item.name}
          </span>
          {matchCount !== undefined && (
            <span className="text-accent shrink-0 rounded bg-[var(--accent-glow)] px-1.5 py-0.5 text-[10px]">
              {formatCount(matchCount, 'file')} match
            </span>
          )}
          {verified && (
            <span className="text-accent flex shrink-0 items-center gap-0.5 text-[10px]">
              <Check size={11} /> verified
            </span>
          )}
        </div>

        {row.status === 'done' && (
          // `select-all` because the whole digest is what anyone wants, and a
          // double-click stops at the first non-word character otherwise.
          <span className="text-secondary font-mono text-[11px] leading-tight break-all select-all">
            {row.digest}
          </span>
        )}
        {row.status === 'error' && row.error && (
          <span className="text-[11px] leading-tight text-[var(--danger)]">
            {describeFsError(row.error)}
          </span>
        )}
        {row.status === 'running' && <Bar read={row.bytesRead} total={item.size} />}
        {row.status === 'queued' && <span className="text-muted text-[11px]">Waiting…</span>}
      </div>

      {row.status === 'done' && (
        <button
          type="button"
          aria-label={`Copy ${item.name} digest`}
          title="Copy digest"
          onClick={() => onCopy(row.digest)}
          className="text-muted hover:bg-hover hover:text-primary flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
        >
          <Copy size={13} />
        </button>
      )}
    </div>
  )
})
