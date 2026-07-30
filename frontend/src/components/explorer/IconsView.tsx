import type { FileItem } from '@/types/file'
import type { ViewMode } from '@/types/workspace'
import { FileIcon } from '@/components/common/FileIcon'

/**
 * The mockup's three icon grids (`.icons-large-grid` / `-medium-` / `-small-`).
 *
 * These are pure layout, so they ship with the chrome. M4 adds virtualization,
 * multi-selection and marquee drag across all four views.
 */

interface GridSpec {
  /** Tailwind grid class — min column width from the mockup. */
  columns: string
  gap: string
  tile: number
  icon: number
  label: string
  /** Small icons are a horizontal row, not a vertical tile. */
  horizontal: boolean
}

const SPECS: Record<Exclude<ViewMode, 'details'>, GridSpec> = {
  'large-icons': {
    columns: 'grid-cols-[repeat(auto-fill,minmax(100px,1fr))]',
    gap: 'gap-2 p-2',
    tile: 56,
    icon: 28,
    label: 'text-[11px] max-w-[90px]',
    horizontal: false,
  },
  'medium-icons': {
    columns: 'grid-cols-[repeat(auto-fill,minmax(80px,1fr))]',
    gap: 'gap-1.5 p-2',
    tile: 40,
    icon: 20,
    label: 'text-[10px] max-w-[72px]',
    horizontal: false,
  },
  'small-icons': {
    columns: 'grid-cols-[repeat(auto-fill,minmax(160px,1fr))]',
    gap: 'gap-0.5 p-1',
    tile: 22,
    icon: 12,
    label: 'text-xs',
    horizontal: true,
  },
}

interface IconsViewProps {
  mode: Exclude<ViewMode, 'details'>
  items: FileItem[]
  selected: ReadonlySet<string>
  onSelect: (item: FileItem) => void
  onActivate: (item: FileItem) => void
}

export function IconsView({ mode, items, selected, onSelect, onActivate }: IconsViewProps) {
  const spec = SPECS[mode]

  return (
    <div role="grid" aria-label="Folder contents" className={`grid ${spec.columns} ${spec.gap}`}>
      {items.map((item) => {
        const isSelected = selected.has(item.path)
        return (
          <div
            key={item.id}
            role="row"
            aria-selected={isSelected}
            tabIndex={0}
            title={item.name}
            onClick={() => onSelect(item)}
            onDoubleClick={() => onActivate(item)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onActivate(item)
            }}
            className={`hover:bg-hover flex cursor-default rounded-lg transition-colors ${
              spec.horizontal
                ? 'items-center gap-2 px-2 py-1'
                : 'flex-col items-center gap-1.5 px-2 pt-3 pb-2'
            } ${isSelected ? 'bg-[var(--accent-glow)]' : ''}`}
          >
            <div
              role="gridcell"
              className="flex shrink-0 items-center justify-center rounded-lg"
              style={{
                width: spec.tile,
                height: spec.tile,
                background: `var(--ft-bg-${item.category})`,
              }}
            >
              <FileIcon category={item.category} size={spec.icon} />
            </div>
            <span
              className={`${spec.label} ${
                spec.horizontal ? 'truncate' : 'text-center leading-tight break-words'
              } ${isSelected ? 'text-accent' : 'text-secondary'} ${
                item.broken ? 'italic opacity-60' : ''
              }`}
            >
              {item.name}
            </span>
          </div>
        )
      })}
    </div>
  )
}
