import { viewLabel } from '@/constants/viewModes'
import type { SplitMode, ViewMode } from '@/types/workspace'
import { formatCount, formatSize } from '@/utils/format'

/** The mockup's `.status-bar`, ported. */

const SPLIT_LABEL: Record<SplitMode, string> = {
  1: 'Single',
  2: 'Split',
  3: '3-Column',
  4: '4-Way',
}

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
    <div className="bg-surface border-edge text-muted flex h-7 shrink-0 items-center justify-between border-t px-3.5 text-[11px]">
      <div className="flex gap-4">
        <span>{formatCount(itemCount, 'item')}</span>
        {selectedCount > 0 && <span>{selectedCount} selected</span>}
        <span>Total: {formatSize(totalBytes)}</span>
      </div>
      <div className="flex items-center gap-4">
        <span>
          {SPLIT_LABEL[splitMode]} / {viewLabel(viewMode)}
        </span>
      </div>
    </div>
  )
}
