import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, ArrowDown, ArrowUp, FolderOpen, Link2 } from 'lucide-react'
import { memo, useCallback, useMemo, useRef } from 'react'
import { FileIcon } from '@/components/common/FileIcon'
import { InlineRename } from '@/components/explorer/InlineRename'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useDragSource, useDropZone } from '@/hooks/useFileDrag'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection'
import { useReclaimFocus } from '@/hooks/useReclaimFocus'
import { useSelection } from '@/hooks/useSelection'
import type { SortKey, SortSpec } from '@/services/filesystem/sort'
import { useCutPaths } from '@/stores/clipboardStore'
import { useDragStore } from '@/stores/dragStore'
import { useUiStore } from '@/stores/uiStore'
import type { FileItem } from '@/types/file'
import { typeLabel } from '@/utils/fileCategory'
import { formatDate, formatSize } from '@/utils/format'
import type { Rect } from '@/utils/selection'

/**
 * Details view — the mockup's `.detail-header` / `.detail-row` layout, now
 * virtualized and with sortable columns.
 */

const ROW_HEIGHT = 34
const HEADER_HEIGHT = 28
const COLUMNS = 'grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]'

const HEADERS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
  { key: 'type', label: 'Type' },
  { key: 'modified', label: 'Modified' },
]

interface DetailsViewProps {
  paneId: string
  /** The folder being shown — the drop target when the pointer is not on a row. */
  path: string
  items: FileItem[]
  sort: SortSpec
  onSortChange: (sort: SortSpec) => void
  onActivate: (item: FileItem) => void
  onFocus: () => void
  onRename: (path: string, newName: string) => void
}

/** Memoised so scrolling re-renders only rows entering the window. */
const Row = memo(function Row({
  item,
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
      // What the right-click hit-test reads. Separate from `data-drop-path`,
      // which only folders carry: everything can be right-clicked.
      data-file-path={item.path}
      // Only folders advertise themselves as drop targets; the container's
      // hit-test reads this attribute to find what is under the pointer.
      {...(item.isDirectory ? { 'data-drop-path': item.path } : {})}
      {...dragProps}
      aria-selected={selected}
      // Primary button only: a right-click inside a multi-selection must not
      // collapse it to the one row under the cursor. `useContextMenu` selects
      // when the target is not already selected.
      onMouseDown={(event) => event.button === 0 && onSelect(item, event)}
      onDoubleClick={() => onActivate(item)}
      className={`grid ${COLUMNS} hover:bg-hover h-full cursor-default items-center border-b border-[var(--border-subtle)] px-3 text-[13px] ${
        selected ? 'bg-[var(--accent-glow)]' : ''
      } ${cut ? 'opacity-45' : ''} ${
        dropTarget ? 'ring-accent bg-[var(--accent-glow)] ring-2 ring-inset' : ''
      }`}
    >
      <div role="gridcell" className="flex min-w-0 items-center gap-2">
        <FileIcon category={item.category} />
        {renaming ? (
          <InlineRename
            name={item.name}
            isDirectory={item.isDirectory}
            onCommit={(next) => onRename(item.path, next)}
            onCancel={onCancelRename}
          />
        ) : (
          <span className={`truncate ${item.broken ? 'text-muted italic' : ''}`}>{item.name}</span>
        )}
        {item.symlink && <Link2 size={12} className="text-muted shrink-0" aria-label="Alias" />}
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
})

export function DetailsView({
  paneId,
  path,
  items,
  sort,
  onSortChange,
  onActivate,
  onFocus,
  onRename,
}: DetailsViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const { selected, lead, handlePointerSelect, select, extendTo, selectAll, clear, setSelection } =
    useSelection(paneId, items)

  const renamingPath = useUiStore((state) =>
    state.renaming?.paneId === paneId ? state.renaming.path : null,
  )
  const endRename = useUiStore((state) => state.endRename)
  const cutPaths = useCutPaths()
  const cut = useMemo(() => new Set(cutPaths), [cutPaths])

  // Closing the editor unmounts the input, dropping focus to the document body
  // — after which every shortcut is inert until the next click. The list has to
  // take focus back explicitly; the grid stays mounted, so useReclaimFocus
  // (which fires on mount) cannot cover this.
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

  // React Compiler will not auto-memoize a component using useVirtualizer,
  // because the hook returns fresh functions each render. That is accounted
  // for: `Row` is memoised by hand above, which is where the win actually is.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  const handleKeyDown = useListKeyboard({
    items,
    lead,
    onSelect: select,
    onExtendTo: extendTo,
    onSelectAll: selectAll,
    onClear: clear,
    onScrollToIndex: (index) => virtualizer.scrollToIndex(index),
  })

  const handleContextMenu = useContextMenu(paneId, items)

  // Row geometry is arithmetic, not DOM lookup, so a marquee dragged past the
  // viewport still selects rows that were never rendered.
  const getItemRect = useCallback(
    (index: number): Rect => ({
      left: 0,
      right: Number.MAX_SAFE_INTEGER,
      top: index * ROW_HEIGHT,
      bottom: (index + 1) * ROW_HEIGHT,
    }),
    [],
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

  const toggleSort = (key: SortKey) => {
    onSortChange(
      sort.key === key
        ? { ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
        : { ...sort, key, direction: 'asc' },
    )
  }

  if (items.length === 0) {
    return (
      // Right-clicking an empty folder still offers New Folder and Paste, which
      // is most of what anyone opens a background menu for.
      <div
        onContextMenu={handleContextMenu}
        className="text-muted flex h-full flex-col items-center justify-center gap-2"
      >
        <FolderOpen size={36} strokeWidth={1.25} className="opacity-40" />
        <span className="text-[13px]">This folder is empty</span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div
        role="row"
        className={`grid ${COLUMNS} border-edge bg-surface text-muted shrink-0 border-b px-3 text-[11px] font-semibold tracking-[0.5px] uppercase`}
        style={{ height: HEADER_HEIGHT }}
      >
        {HEADERS.map((header) => {
          const active = sort.key === header.key
          return (
            <button
              key={header.key}
              type="button"
              role="columnheader"
              aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
              onClick={() => toggleSort(header.key)}
              className={`hover:text-primary flex items-center gap-1 text-left transition-colors ${
                active ? 'text-accent' : ''
              }`}
            >
              <span>{header.label}</span>
              {active &&
                (sort.direction === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
            </button>
          )
        })}
      </div>

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
          // A click on empty space clears, matching Finder.
          if (!(event.target as HTMLElement).closest('[data-file-row]')) clear()
        }}
        onContextMenu={handleContextMenu}
        {...dropZone}
        className={`relative flex-1 overflow-auto outline-none ${
          dropTarget === path ? 'ring-accent ring-2 ring-inset' : ''
        }`}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index]
            if (!item) return null
            return (
              <div
                key={item.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <Row
                  item={item}
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
    </div>
  )
}
