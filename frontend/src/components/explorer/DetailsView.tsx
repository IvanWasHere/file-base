import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, ArrowDown, ArrowUp, FolderOpen, Link2 } from 'lucide-react'
import { Fragment, memo, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { FileIcon } from '@/components/common/FileIcon'
import { InlineRename } from '@/components/explorer/InlineRename'
import {
  columnSpec,
  gridTemplate,
  minWeightsOf,
  moveVisibleColumn,
  visibleColumns,
  weightsOf,
  withWeights,
  type ColumnId,
} from '@/constants/columns'
import { TagDots } from '@/components/common/TagDots'
import { useColumnReorder } from '@/hooks/useColumnReorder'
import { useSplitResize } from '@/hooks/useSplitResize'
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
 * virtualized, with sortable columns the user can reorder and resize (§M19).
 *
 * The header and the rows are two separate grids that must agree. They agree
 * because both take one `gridTemplateColumns` string computed here from the
 * stored layout, and both walk the same `order` array — before §M19 they agreed
 * because they shared one hard-coded constant, which is the same property held
 * a weaker way.
 */

const ROW_HEIGHT = 34
const HEADER_HEIGHT = 28

/**
 * The strip down the left edge that reads as "behind the rows".
 *
 * Details rows span the full width, so — unlike the icon grids — there is no
 * empty space left to click when the user means the folder being shown rather
 * than a row. This gutter is that space: a press in it reaches the container
 * with no row under the pointer, so the selection clears and a right-click
 * raises the background menu. That is what lets a selected folder be a paste
 * destination in its own right (`useMenuCommands`, `edit.paste`) while the open
 * folder stays one keystroke away.
 *
 * 10px, which sits entirely inside the rows' 12px left padding: it can never
 * cover an icon or a name.
 */
const GUTTER_WIDTH = 10

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
  columns,
  template,
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
  /**
   * Display order — the visible columns only. A stable reference, memoised
   * from the stored layout, so a row that is merely scrolled past does not
   * re-render (§M19 decision 9).
   */
  columns: ColumnId[]
  template: string
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
  /**
   * Every cell this row can draw, keyed by column.
   *
   * `Record<ColumnId, …>` rather than a lookup that can miss: adding a column to
   * the registry fails to compile here until it can be drawn, which is stronger
   * than the runtime "the map covers the registry" test §M19 planned for.
   *
   * Rendered in layout order below, not placed by CSS: what a screen reader
   * announces is then the order on screen (§M19 decision 8).
   */
  const cells: Record<ColumnId, ReactNode> = {
    name: (
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
    ),
    size: (
      <span role="gridcell" className="text-secondary truncate text-xs">
        {item.isDirectory ? '—' : formatSize(item.size)}
      </span>
    ),
    type: (
      <span role="gridcell" className="text-secondary truncate text-xs">
        {typeLabel(item.extension, item.isDirectory)}
      </span>
    ),
    modified: (
      <span role="gridcell" className="text-secondary truncate text-xs">
        {formatDate(item.modifiedAt)}
      </span>
    ),
    created: (
      <span role="gridcell" className="text-secondary truncate text-xs">
        {formatDate(item.createdAt)}
      </span>
    ),
    tags: (
      <span role="gridcell" className="text-secondary flex min-w-0 items-center text-xs">
        <TagDots tags={item.tags} />
      </span>
    ),
  }

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
      style={{ gridTemplateColumns: template }}
      className={`hover:bg-hover grid h-full cursor-default items-center border-b border-[var(--border-subtle)] px-3 text-[13px] ${
        selected ? 'bg-[var(--accent-glow)]' : ''
      } ${cut ? 'opacity-45' : ''} ${
        dropTarget ? 'ring-accent bg-[var(--accent-glow)] ring-2 ring-inset' : ''
      }`}
    >
      {columns.map((id) => (
        <Fragment key={id}>{cells[id]}</Fragment>
      ))}
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

  // The layout is one global setting, not one per pane: four panes showing four
  // different column widths would read as a bug (§M19 decision 10).
  const layout = useUiStore((state) => state.columnLayout)
  const setColumnLayout = useUiStore((state) => state.setColumnLayout)
  const headerRef = useRef<HTMLDivElement>(null)

  const template = gridTemplate(layout)
  const weights = weightsOf(layout)
  // The header, the rows and the resize handles all walk this one list, so a
  // column switched off in Settings disappears from all three at once (§M22).
  //
  // Memoised because it is the identity §M19 decision 9 relies on: `Row` is
  // memoised by hand, and a freshly-derived array every render would re-render
  // every visible row on every scroll tick. The layout is replaced wholesale by
  // the store, so this changes exactly when the columns do.
  const columns = useMemo(() => visibleColumns(layout), [layout])

  const { startResize, nudge } = useSplitResize({
    containerRef: headerRef,
    axis: 'x',
    sizes: weights,
    minFraction: minWeightsOf(layout),
    onResize: (sizes) => setColumnLayout(withWeights(layout, sizes)),
  })

  const { drag, startReorder, consumeClick } = useColumnReorder({
    containerRef: headerRef,
    weights,
    // `moveVisibleColumn`, not `moveColumn`: the drag reports header positions,
    // and with a column hidden those no longer index `order` (§M22).
    onReorder: (from, to) =>
      setColumnLayout({ ...layout, order: moveVisibleColumn(layout, from, to) }),
  })

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

  /**
   * Reorder and resize from the keyboard, so neither is mouse-only.
   *
   * Handled here rather than in the shortcut registry because this is the
   * focused widget's own business — `constants/shortcuts.ts` rule 1, the same
   * line that keeps arrow keys inside `useListKeyboard`. `preventDefault` is
   * what tells the global listener to keep its hands off (`useKeyboard` rule 1).
   */
  const handleHeaderKeyDown = (index: number, event: React.KeyboardEvent) => {
    const back = event.key === 'ArrowLeft'
    const forward = event.key === 'ArrowRight'
    if (!back && !forward) return

    const direction = back ? -1 : 1

    if (event.altKey) {
      event.preventDefault()
      const next = moveVisibleColumn(layout, index, index + direction)
      if (next !== layout.order) {
        setColumnLayout({ ...layout, order: next })
        // Focus follows the column, not the position: the user is moving *this*
        // header and expects to keep moving it.
        requestAnimationFrame(() => {
          const headers =
            headerRef.current?.querySelectorAll<HTMLButtonElement>('[role="columnheader"]')
          headers?.[index + direction]?.focus()
        })
      }
      return
    }

    if (event.shiftKey) {
      event.preventDefault()
      // A column grows against the divider on its right; the last one has none,
      // so it grows by pulling the divider on its left the other way.
      const last = index === columns.length - 1
      nudge(last ? index - 1 : index, (last ? -direction : direction) as -1 | 1)
    }
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
        ref={headerRef}
        role="row"
        className="border-edge bg-surface text-muted grid shrink-0 border-b px-3 text-[11px] font-semibold tracking-[0.5px] uppercase"
        style={{ height: HEADER_HEIGHT, gridTemplateColumns: template }}
      >
        {columns.map((id, index) => {
          const spec = columnSpec(id)
          const active = sort.key === spec.sortKey
          const dragging = drag?.from === index
          return (
            <div key={id} className="relative flex min-w-0 items-center">
              <button
                type="button"
                role="columnheader"
                aria-sort={
                  active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                }
                onMouseDown={(event) => startReorder(index, event)}
                // A drag that crossed the threshold ends in a click the button
                // would otherwise read as a sort (§M19 decision 6).
                onClick={() => {
                  if (!consumeClick()) toggleSort(spec.sortKey)
                }}
                onKeyDown={(event) => handleHeaderKeyDown(index, event)}
                className={`hover:text-primary flex min-w-0 flex-1 items-center gap-1 text-left transition-colors ${
                  active ? 'text-accent' : ''
                } ${dragging ? 'text-primary opacity-50' : ''}`}
              >
                <span className="truncate">{spec.label}</span>
                {active &&
                  (sort.direction === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
              </button>

              {/* Where the dragged column would land. Drawn on the leading edge
                  of the target, or the trailing edge when it is moving right —
                  which is the side it will actually end up on. */}
              {drag && drag.to === index && drag.from !== index && (
                <div
                  data-testid="column-drop-indicator"
                  aria-hidden
                  className={`bg-accent pointer-events-none absolute top-0 bottom-0 w-0.5 ${
                    drag.from < index ? '-right-px' : '-left-px'
                  }`}
                />
              )}

              {/* The rule between two columns. The last column has none: there
                  is nothing to its right to take width from (§M19 decision 4).

                  Deliberately *not* `role="separator"`, which the split-pane
                  dividers use: those are focusable splitters carrying
                  aria-valuenow, and this is a mouse affordance for something the
                  keyboard already reaches through the header (Shift+←/→). A
                  second, unfocusable separator in the tree would be noise to a
                  screen reader — and it made `getAllByRole('separator')` count
                  fourteen dividers in a 2 × 2 split, which is how it was found. */}
              {index < columns.length - 1 && (
                <div
                  aria-hidden
                  data-testid={`column-resize-${id}`}
                  onMouseDown={(event) => {
                    // Stops the press reaching the header button, which would
                    // start a reorder and end in a sort.
                    event.stopPropagation()
                    startResize(index, event)
                  }}
                  className="hover:bg-accent absolute top-0 -right-1 bottom-0 z-10 w-2 cursor-col-resize bg-transparent transition-colors"
                />
              )}
            </div>
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
                  columns={columns}
                  template={template}
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

          {/* Last in the box, so it paints over the rows' left padding — and
              inside it, so it spans the whole scrolled height rather than just
              the viewport. It carries no handlers of its own: being the event
              target *is* the job, since the container's own mousedown and
              contextmenu then find no row under the pointer and treat the
              press as background. */}
          <div
            data-testid="details-gutter"
            aria-hidden
            style={{ width: GUTTER_WIDTH }}
            className="hover:bg-hover absolute top-0 bottom-0 left-0 transition-colors"
          />
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
