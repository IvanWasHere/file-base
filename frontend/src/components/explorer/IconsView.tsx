import { useVirtualizer } from '@tanstack/react-virtual'
import { FolderOpen } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { FileIcon } from '@/components/common/FileIcon'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection'
import { useSelection } from '@/hooks/useSelection'
import type { FileItem } from '@/types/file'
import type { ViewMode } from '@/types/workspace'
import type { Rect } from '@/utils/selection'

/**
 * The mockup's three icon grids (`.icons-large-grid` / `-medium-` / `-small-`),
 * virtualized by row.
 *
 * The mockup used CSS `auto-fill minmax(Npx, 1fr)`, which lets the browser
 * decide the column count. Virtualization needs that number up front, so the
 * container width is measured and the columns computed explicitly.
 */

interface GridSpec {
  minTile: number
  rowHeight: number
  tile: number
  icon: number
  label: string
  horizontal: boolean
  padding: number
}

const SPECS: Record<Exclude<ViewMode, 'details'>, GridSpec> = {
  'large-icons': {
    minTile: 108,
    rowHeight: 110,
    tile: 56,
    icon: 28,
    label: 'text-[11px] max-w-[90px]',
    horizontal: false,
    padding: 8,
  },
  'medium-icons': {
    minTile: 86,
    rowHeight: 86,
    tile: 40,
    icon: 20,
    label: 'text-[10px] max-w-[72px]',
    horizontal: false,
    padding: 8,
  },
  'small-icons': {
    minTile: 162,
    rowHeight: 30,
    tile: 22,
    icon: 12,
    label: 'text-xs',
    horizontal: true,
    padding: 4,
  },
}

const Tile = memo(function Tile({
  item,
  spec,
  selected,
  onSelect,
  onActivate,
}: {
  item: FileItem
  spec: GridSpec
  selected: boolean
  onSelect: (item: FileItem, event: React.MouseEvent) => void
  onActivate: (item: FileItem) => void
}) {
  return (
    <div
      role="row"
      data-file-row
      aria-selected={selected}
      title={item.name}
      onMouseDown={(event) => onSelect(item, event)}
      onDoubleClick={() => onActivate(item)}
      className={`hover:bg-hover flex h-full cursor-default rounded-lg transition-colors ${
        spec.horizontal ? 'items-center gap-2 px-2' : 'flex-col items-center gap-1.5 px-2 pt-3 pb-2'
      } ${selected ? 'bg-[var(--accent-glow)]' : ''}`}
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
          spec.horizontal ? 'truncate' : 'line-clamp-2 text-center leading-tight break-words'
        } ${selected ? 'text-accent' : 'text-secondary'} ${item.broken ? 'italic opacity-60' : ''}`}
      >
        {item.name}
      </span>
    </div>
  )
})

interface IconsViewProps {
  paneId: string
  mode: Exclude<ViewMode, 'details'>
  items: FileItem[]
  onActivate: (item: FileItem) => void
  onFocus: () => void
}

export function IconsView({ paneId, mode, items, onActivate, onFocus }: IconsViewProps) {
  const spec = SPECS[mode]
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  // ResizeObserver rather than a window listener: a pane can change width
  // without the window doing so, when a split divider is dragged.
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    setWidth(element.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])

  const usable = Math.max(width - spec.padding * 2, spec.minTile)
  const columns = Math.max(1, Math.floor(usable / spec.minTile))
  const columnWidth = usable / columns
  const rowCount = Math.ceil(items.length / columns)

  const { selected, lead, handlePointerSelect, select, extendTo, selectAll, clear, setSelection } =
    useSelection(paneId, items)

  // See DetailsView: the compiler skips memoizing around useVirtualizer, and
  // `Tile` is memoised by hand instead.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => spec.rowHeight,
    overscan: 4,
  })

  const handleKeyDown = useListKeyboard({
    items,
    lead,
    // Up/Down move a whole row in a grid.
    stride: columns,
    onSelect: select,
    onExtendTo: extendTo,
    onSelectAll: selectAll,
    onClear: clear,
    onActivate,
    onScrollToIndex: (index) => virtualizer.scrollToIndex(Math.floor(index / columns)),
  })

  const getItemRect = useCallback(
    (index: number): Rect => {
      const row = Math.floor(index / columns)
      const column = index % columns
      const left = spec.padding + column * columnWidth
      const top = row * spec.rowHeight
      return { left, right: left + columnWidth, top, bottom: top + spec.rowHeight }
    },
    [columns, columnWidth, spec.padding, spec.rowHeight],
  )

  const { onMouseDown, marqueeStyle } = useMarqueeSelection({
    scrollRef,
    itemCount: items.length,
    getItemRect,
    onSelect: (indices) => {
      setSelection(indices.map((index) => items[index]?.path ?? '').filter(Boolean))
    },
  })

  if (items.length === 0) {
    return (
      <div className="text-muted flex h-full flex-col items-center justify-center gap-2">
        <FolderOpen size={36} strokeWidth={1.25} className="opacity-40" />
        <span className="text-[13px]">This folder is empty</span>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label="Folder contents"
      aria-multiselectable
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => {
        onFocus()
        onMouseDown(event)
        if (!(event.target as HTMLElement).closest('[data-file-row]')) clear()
      }}
      className="relative h-full overflow-auto outline-none"
      style={{ padding: spec.padding }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const start = virtualRow.index * columns
          const rowItems = items.slice(start, start + columns)

          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {rowItems.map((item) => (
                <Tile
                  key={item.id}
                  item={item}
                  spec={spec}
                  selected={selected.has(item.path)}
                  onSelect={handlePointerSelect}
                  onActivate={onActivate}
                />
              ))}
            </div>
          )
        })}
      </div>

      {marqueeStyle && (
        <div
          data-testid="marquee"
          className="pointer-events-none absolute border border-[var(--accent)] bg-[var(--accent-glow)]"
          style={{ position: 'absolute', ...marqueeStyle }}
        />
      )}
    </div>
  )
}
