import { AlertTriangle, FolderOpen, Link2 } from 'lucide-react'
import type { FileItem } from '@/types/file'
import { FileIcon } from '@/components/common/FileIcon'
import { formatDate, formatSize } from '@/utils/format'
import { typeLabel } from '@/utils/fileCategory'

/**
 * Details view — the mockup's `.detail-header` / `.detail-row` layout.
 *
 * M1 renders the full listing directly. Virtualization arrives in M4 alongside
 * the other three view modes; single-selection here is a placeholder for the
 * real multi-selection model.
 */

const COLUMNS = 'grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]'

interface DetailsViewProps {
  items: FileItem[]
  selected: ReadonlySet<string>
  onSelect: (item: FileItem) => void
  onActivate: (item: FileItem) => void
}

export function DetailsView({ items, selected, onSelect, onActivate }: DetailsViewProps) {
  if (items.length === 0) {
    return (
      <div className="text-muted flex h-full flex-col items-center justify-center gap-2">
        <FolderOpen size={36} strokeWidth={1.25} className="opacity-40" />
        <span className="text-[13px]">This folder is empty</span>
      </div>
    )
  }

  return (
    <div role="grid" aria-label="Folder contents">
      <div
        role="row"
        className={`grid ${COLUMNS} border-edge bg-surface text-muted sticky top-0 z-10 border-b px-3 py-1.5 text-[11px] font-semibold tracking-[0.5px] uppercase`}
      >
        <span role="columnheader">Name</span>
        <span role="columnheader">Size</span>
        <span role="columnheader">Type</span>
        <span role="columnheader">Modified</span>
      </div>

      {items.map((item) => {
        const isSelected = selected.has(item.path)
        return (
          <div
            key={item.id}
            role="row"
            aria-selected={isSelected}
            tabIndex={0}
            onClick={() => onSelect(item)}
            onDoubleClick={() => onActivate(item)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onActivate(item)
            }}
            className={`grid ${COLUMNS} hover:bg-hover cursor-default items-center border-b border-[var(--border-subtle)] px-3 py-2 text-[13px] transition-colors ${
              isSelected ? 'bg-[var(--accent-glow)]' : ''
            }`}
          >
            <div role="gridcell" className="flex min-w-0 items-center gap-2">
              <FileIcon category={item.category} />
              <span className={`truncate ${item.broken ? 'text-muted italic' : ''}`}>
                {item.name}
              </span>
              {item.symlink && (
                <Link2 size={12} className="text-muted shrink-0" aria-label="Alias" />
              )}
              {item.broken && (
                <AlertTriangle
                  size={12}
                  className="shrink-0 text-[var(--danger)]"
                  aria-label="Unavailable"
                />
              )}
            </div>
            <span role="gridcell" className="text-secondary truncate text-xs">
              {item.isDirectory ? '—' : formatSize(item.size)}
            </span>
            <span role="gridcell" className="text-secondary truncate text-xs">
              {typeLabel(item.extension, item.isDirectory)}
            </span>
            <span role="gridcell" className="text-secondary truncate text-xs">
              {formatDate(item.modifiedAt)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
