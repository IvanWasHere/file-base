import { useCallback, useMemo, useRef } from 'react'
import { ExplorerPane } from './ExplorerPane'
import {
  SPLIT_GRIDS,
  cellsOf,
  columnSpanOf,
  dividersOf,
  rowSpanOf,
  type DividerSegment,
} from '@/constants/splitModes'
import { useSplitResize, type SplitAxis } from '@/hooks/useSplitResize'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import type { Tab } from '@/types/workspace'

/**
 * Lays out a tab's panes with draggable dividers between them (§M16, §M17).
 *
 * CSS Grid rather than nested flex: the fractions go straight into
 * `grid-template-*`, and a pane that spans two tracks — the wide one under
 * Split Top, the tall one beside Split Left — is `grid-column: 1 / span 2`
 * rather than a second level of nesting. `minmax(0, Nfr)` matters: a bare `Nfr`
 * track lets a long filename push a column wider than its share.
 *
 * The dividers are positioned over the grid rather than sitting in it, so a
 * divider is one element however many rows it crosses — one tab stop, one thing
 * a screen reader announces. Where it starts and stops is derived from the
 * panes themselves (`dividersOf`), which is why the 2 × 2's full-height cross
 * and Split Top's stub are the same code path.
 */

/** Cumulative boundaries between tracks, as percentages of the container. */
function stops(fractions: readonly number[]): number[] {
  const result: number[] = [0]
  let running = 0
  for (const fraction of fractions) {
    running += fraction
    result.push(running * 100)
  }
  return result
}

export function PaneGroup({ tab }: { tab: Tab }) {
  const panes = useWorkspaceStore((state) => state.panes)
  const setLayout = useWorkspaceStore((state) => state.setLayout)
  const setActivePane = useWorkspaceStore((state) => state.setActivePane)

  const container = useRef<HTMLDivElement>(null)
  const { columns, rows } = tab.layout
  const cells = cellsOf(tab.splitMode)
  const grid = SPLIT_GRIDS[tab.splitMode]
  const dividers = useMemo(() => dividersOf(tab.splitMode), [tab.splitMode])

  const onColumns = useCallback(
    (next: number[]) => setLayout(tab.id, { columns: next, rows }),
    [setLayout, tab.id, rows],
  )
  const onRows = useCallback(
    (next: number[]) => setLayout(tab.id, { columns, rows: next }),
    [setLayout, tab.id, columns],
  )

  const columnResize = useSplitResize({
    containerRef: container,
    axis: 'x',
    sizes: columns,
    onResize: onColumns,
  })
  const rowResize = useSplitResize({
    containerRef: container,
    axis: 'y',
    sizes: rows,
    onResize: onRows,
  })

  const columnStops = stops(columns)
  const rowStops = stops(rows)

  // Named per axis only when there is more than one to tell apart: two column
  // dividers need numbering, a lone one reads better without it.
  const perAxis = (axis: SplitAxis) => dividers.filter((divider) => divider.axis === axis).length

  return (
    <div
      ref={container}
      className="relative grid min-w-0 flex-1 overflow-hidden"
      style={{
        gridTemplateColumns: columns.map((size) => `minmax(0, ${size}fr)`).join(' '),
        gridTemplateRows: rows.map((size) => `minmax(0, ${size}fr)`).join(' '),
      }}
    >
      {tab.paneIds.map((paneId, index) => {
        const pane = panes[paneId]
        const cell = cells[index]
        if (!pane || !cell) return null

        return (
          <div
            key={paneId}
            className="flex min-h-0 min-w-0 flex-col overflow-hidden"
            style={{
              // 1-based, and spans declared explicitly rather than left to
              // auto-placement — a spanning cell would otherwise push the ones
              // after it into the wrong track.
              gridColumn: `${cell.column + 1} / span ${columnSpanOf(cell)}`,
              gridRow: `${cell.row + 1} / span ${rowSpanOf(cell)}`,
            }}
          >
            <ExplorerPane
              pane={pane}
              index={index}
              isActive={tab.activePaneId === paneId}
              showLetter={tab.paneIds.length > 1}
              onFocus={() => setActivePane(tab.id, paneId)}
            />
          </div>
        )
      })}

      {dividers.map((divider) => {
        const horizontal = divider.axis === 'x'
        const along = horizontal ? columnStops : rowStops
        const across = horizontal ? rowStops : columnStops
        const many = perAxis(divider.axis) > 1

        return (
          <Divider
            key={`${divider.axis}-${divider.index}-${divider.from}`}
            divider={divider}
            position={along[divider.index + 1] ?? 0}
            start={across[divider.from] ?? 0}
            end={across[divider.to] ?? 100}
            fraction={(horizontal ? columns : rows)[divider.index] ?? 0}
            label={
              horizontal
                ? many
                  ? `Resize column ${divider.index + 1}`
                  : 'Resize columns'
                : many
                  ? `Resize row ${divider.index + 1}`
                  : 'Resize rows'
            }
            onStart={horizontal ? columnResize.startResize : rowResize.startResize}
            onNudge={horizontal ? columnResize.nudge : rowResize.nudge}
            // A divider that covers the whole container is the 2 × 2 cross; one
            // that stops short is Split Top's. Only the geometry differs.
            full={divider.from === 0 && divider.to === (horizontal ? grid.rows : grid.columns)}
          />
        )
      })}
    </div>
  )
}

function Divider({
  divider,
  position,
  start,
  end,
  fraction,
  label,
  full,
  onStart,
  onNudge,
}: {
  divider: DividerSegment
  /** Where the boundary sits along its own axis, as a percentage. */
  position: number
  /** Where the segment starts and ends across the other axis, as percentages. */
  start: number
  end: number
  /** The size of the track before the boundary, for `aria-valuenow`. */
  fraction: number
  label: string
  full: boolean
  onStart: (index: number, event: React.MouseEvent) => void
  onNudge: (index: number, direction: -1 | 1) => void
}) {
  const horizontal = divider.axis === 'x'
  // Arrow keys follow the divider's own orientation: a horizontal divider that
  // answered to Left/Right would make keyboard support feel bolted on.
  const decrease = horizontal ? 'ArrowLeft' : 'ArrowUp'
  const increase = horizontal ? 'ArrowRight' : 'ArrowDown'

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={12}
      aria-valuemax={88}
      tabIndex={0}
      data-full-span={full || undefined}
      onMouseDown={(event) => onStart(divider.index, event)}
      onKeyDown={(event) => {
        if (event.key === decrease) {
          event.preventDefault()
          onNudge(divider.index, -1)
        }
        if (event.key === increase) {
          event.preventDefault()
          onNudge(divider.index, 1)
        }
      }}
      // Centred on the boundary and drawn over the panes, so the line is
      // continuous across every row or column it does cover.
      className={`bg-edge hover:bg-accent focus-visible:bg-accent absolute z-10 transition-colors ${
        horizontal
          ? 'w-1 -translate-x-1/2 cursor-col-resize'
          : 'h-1 -translate-y-1/2 cursor-row-resize'
      }`}
      style={
        horizontal
          ? { left: `${position}%`, top: `${start}%`, height: `${end - start}%` }
          : { top: `${position}%`, left: `${start}%`, width: `${end - start}%` }
      }
    />
  )
}
