import { useVirtualizer } from '@tanstack/react-virtual'
import { FolderOpen } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileIcon } from '@/components/common/FileIcon'
import { InlineRename } from '@/components/explorer/InlineRename'
import { useDragSource, useDropZone } from '@/hooks/useFileDrag'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection'
import { useReclaimFocus } from '@/hooks/useReclaimFocus'
import { useSelection } from '@/hooks/useSelection'
import { useCutPaths } from '@/stores/clipboardStore'
import { useDragStore } from '@/stores/dragStore'
import { useUiStore } from '@/stores/uiStore'
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
  cut,
  renaming,
  dropTarget,
  dragProps,
  onSelect,
  onActivate,
  onRename,
  onCancelRename,
}: {
  item: FileItem
  spec: GridSpec
  selected: boolean
  cut: boolean
  renaming: boolean
  dropTarget: boolean
  dragProps: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean }
  onSelect: (item: FileItem, event: React.MouseEvent) => void
  onActivate: (item: FileItem) => void
  onRename: (path: string, newName: string) => void
  onCancelRename: () => void
}) {
  return (
    <div
      role="row"
      data-file-row
      {...(item.isDirectory ? { 'data-drop-path': item.path } : {})}
      {...dragProps}
      aria-selected={selected}
      title={item.name}
      onMouseDown={(event) => onSelect(item, event)}
      onDoubleClick={() => onActivate(item)}
      className={`hover:bg-hover flex h-full cursor-default rounded-lg transition-colors ${
        spec.horizontal ? 'items-center gap-2 px-2' : 'flex-col items-center gap-1.5 px-2 pt-3 pb-2'
      } ${selected ? 'bg-[var(--accent-glow)]' : ''} ${cut ? 'opacity-45' : ''} ${
        dropTarget ? 'ring-accent bg-[var(--accent-glow)] ring-2 ring-inset' : ''
      }`}
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
      {renaming ? (
        // The editor spans the tile width rather than the label's clamp, so a
        // long name is editable instead of being cropped to two lines.
        <div className={`flex w-full min-w-0 ${spec.horizontal ? '' : 'justify-center'}`}>
          <InlineRename
            name={item.name}
            isDirectory={item.isDirectory}
            onCommit={(next) => onRename(item.path, next)}
            onCancel={onCancelRename}
          />
        </div>
      ) : (
        <span
          className={`${spec.label} ${
            spec.horizontal ? 'truncate' : 'line-clamp-2 text-center leading-tight break-words'
          } ${selected ? 'text-accent' : 'text-secondary'} ${
            item.broken ? 'italic opacity-60' : ''
          }`}
        >
          {item.name}
        </span>
      )}
    </div>
  )
})

interface IconsViewProps {
  paneId: string
  /** The folder being shown — the drop target when the pointer is not on a tile. */
  path: string
  mode: Exclude<ViewMode, 'details'>
  items: FileItem[]
  onActivate: (item: FileItem) => void
  onFocus: () => void
  onRename: (path: string, newName: string) => void
}

export function IconsView({
  paneId,
  path,
  mode,
  items,
  onActivate,
  onFocus,
  onRename,
}: IconsViewProps) {
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

  const renamingPath = useUiStore((state) =>
    state.renaming?.paneId === paneId ? state.renaming.path : null,
  )
  const endRename = useUiStore((state) => state.endRename)
  const cutPaths = useCutPaths()
  const cut = useMemo(() => new Set(cutPaths), [cutPaths])

  // See DetailsView: closing the editor drops focus to the body, leaving every
  // shortcut inert until the next click.
  const finishRename = useCallback(() => {
    endRename()
    scrollRef.current?.focus({ preventScroll: true })
  }, [endRename])

  // `target` rather than `path`: the pane's own path is a prop now, and
  // shadowing it here would be a trap for the next edit.
  const handleRename = useCallback(
    (target: string, newName: string) => {
      finishRename()
      onRename(target, newName)
    },
    [finishRename, onRename],
  )

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

  useReclaimFocus(scrollRef, items.length > 0)

  const dragSource = useDragSource(paneId, path)
  const dropZone = useDropZone(path)
  const dropTarget = useDragStore((state) => state.over)

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
      {...dropZone}
      className={`relative h-full overflow-auto outline-none ${
        dropTarget === path ? 'ring-accent ring-2 ring-inset' : ''
      }`}
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
                  cut={cut.has(item.path)}
                  renaming={renamingPath === item.path}
                  dropTarget={dropTarget === item.path}
                  dragProps={dragSource(item)}
                  onSelect={handlePointerSelect}
                  onActivate={onActivate}
                  onRename={handleRename}
                  onCancelRename={finishRename}
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
