import { splitLabel } from '@/constants/splitModes'
import { viewLabel } from '@/constants/viewModes'
import type { SplitMode, ViewMode } from '@/types/workspace'
import { formatCount, formatSize } from '@/utils/format'

/**
 * The mockup's `.status-bar`, ported.
 *
 * The split names come from `constants/splitModes.ts` rather than a table here.
 * This file used to keep its own — "Split", "4-Way" — while the menus said "Two
 * Panes" and "Four Panes", which was not a decision anyone took (§M16).
 */

export function StatusBar({
  itemCount,
  selectedCount,
  totalBytes,
  splitMode,
  viewMode,
}: {
  itemCount: number
  selectedCount: number
  totalBytes: number
  splitMode: SplitMode
  viewMode: ViewMode
}) {
  return (
    <div
      className="bg-surface border-edge text-muted flex h-7 shrink-0 items-center justify-between border-t text-[11px]"
      style={{ paddingLeft: 15, paddingRight: 15 }}
    >
      <div className="flex gap-4">
        <span>{formatCount(itemCount, 'item')}</span>
        {/* The single announcement point for selection changes — keyboard and
            marquee selection are otherwise silent to screen readers. */}
        <span aria-live="polite">{selectedCount > 0 ? `${selectedCount} selected` : ''}</span>
        <span>Total: {formatSize(totalBytes)}</span>
      </div>
      <div className="flex items-center gap-4">
        <span>
          {splitLabel(splitMode)} / {viewLabel(viewMode)}
        </span>
      </div>
    </div>
  )
}
