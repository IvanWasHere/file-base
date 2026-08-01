import { Info, X } from 'lucide-react'
import { PreviewContent } from '@/features/preview/PreviewContent'
import { useUiStore } from '@/stores/uiStore'
import type { FileItem } from '@/types/file'
import { typeLabel } from '@/utils/fileCategory'
import { formatDateTime, formatSize } from '@/utils/format'

/**
 * The mockup's `.preview-panel`, ported, with the content preview M10 added.
 *
 * Metadata is rendered from what the listing already carries, so it appears
 * instantly; the content above it loads separately and falls back to the file's
 * icon when there is nothing to show.
 */

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--border-subtle)] py-1.5 text-xs">
      <span className="text-muted shrink-0">{label}</span>
      <span className="text-primary truncate text-right font-medium" title={value}>
        {value}
      </span>
    </div>
  )
}

export function PreviewPanel({ item }: { item: FileItem | null }) {
  const setPreviewOpen = useUiStore((state) => state.setPreviewOpen)

  return (
    <aside
      aria-label="Preview"
      className="bg-base border-edge flex w-[280px] shrink-0 flex-col overflow-hidden border-l p-[5px]"
    >
      <div className="border-edge text-secondary flex items-center justify-between border-b px-1 py-2 text-xs font-semibold">
        <span>Preview</span>
        <button
          type="button"
          aria-label="Close preview"
          onClick={() => setPreviewOpen(false)}
          className="text-muted hover:bg-hover hover:text-primary flex size-5 items-center justify-center rounded transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {item ? (
        <div className="flex-1 overflow-y-auto px-2 py-3">
          <PreviewContent item={item} />

          <div className="mb-3 text-sm leading-snug font-semibold break-words">{item.name}</div>

          <InfoRow label="Type" value={typeLabel(item.extension, item.isDirectory)} />
          <InfoRow label="Size" value={item.isDirectory ? '—' : formatSize(item.size)} />
          <InfoRow label="Modified" value={formatDateTime(item.modifiedAt)} />
          <InfoRow label="Created" value={formatDateTime(item.createdAt)} />
          <InfoRow label="Permissions" value={item.permissions} />
          {item.symlink && <InfoRow label="Alias of" value={item.symlinkTarget ?? '—'} />}

          <div className="text-muted mt-3 text-[10px] break-all opacity-70">{item.path}</div>

          {item.isDirectory && (
            <div className="bg-surface text-secondary mt-3 rounded-md p-2.5 text-center text-xs">
              Double-click to open folder
            </div>
          )}
        </div>
      ) : (
        <div className="text-muted flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Info size={24} strokeWidth={1.25} className="opacity-40" />
          <span className="text-xs">Select an item to see its details</span>
        </div>
      )}
    </aside>
  )
}
