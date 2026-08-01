import { CircleAlert, Search, Zap } from 'lucide-react'
import { basename } from '@/utils/path'
import { formatCount } from '@/utils/format'
import type { PaneSearch } from '@/stores/searchStore'

/**
 * The "searching in…" strip above the results (PLAN.md M8).
 *
 * A long walk has to keep saying something. The scanned count is the honest
 * thing to show while a recursive search runs: the match count barely moves in
 * a sparse tree, and a spinner alone cannot distinguish "still working" from
 * "stuck".
 */
export function SearchStatusBar({
  search,
  resultCount,
  onCancel,
}: {
  search: PaneSearch
  resultCount: number
  onCancel: () => void
}) {
  const folder = basename(search.root) || search.root

  if (search.scope === 'folder') {
    return (
      <div className="border-edge text-muted flex shrink-0 items-center gap-2 border-b px-3 py-1 text-[11px]">
        <Search size={11} className="shrink-0" />
        <span>
          {formatCount(resultCount, 'match', 'matches')} in this folder
        </span>
      </div>
    )
  }

  return (
    <div className="border-edge text-muted flex shrink-0 items-center gap-2 border-b px-3 py-1 text-[11px]">
      {search.status === 'error' ? (
        <CircleAlert size={11} className="shrink-0 text-[var(--danger)]" />
      ) : search.fromIndex ? (
        <Zap size={11} className="text-accent shrink-0" />
      ) : (
        <Search size={11} className="shrink-0" />
      )}

      {search.status === 'error' ? (
        <span className="text-[var(--danger)]">{search.message || 'The search failed.'}</span>
      ) : (
        <>
          <span>
            {search.status === 'running' ? 'Searching' : 'Searched'} {folder}
            {search.fromIndex && ' · indexed'}
          </span>
          <span aria-live="polite">
            {formatCount(resultCount, 'match', 'matches')}
            {search.status === 'running' && search.scanned > 0 && (
              <span className="opacity-70"> · {search.scanned.toLocaleString()} scanned</span>
            )}
          </span>
          {search.truncated && (
            <span className="text-[var(--warning,var(--accent))]">
              · showing the first {resultCount.toLocaleString()}
            </span>
          )}
          {search.status === 'cancelled' && <span className="opacity-70">· stopped</span>}
        </>
      )}

      {search.status === 'running' && (
        <button
          type="button"
          onClick={onCancel}
          className="border-edge hover:bg-hover hover:text-primary ml-auto rounded border px-2 py-0.5 transition-colors"
        >
          Stop
        </button>
      )}
    </div>
  )
}
