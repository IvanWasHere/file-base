import { useCallback, useRef } from 'react'
import { ExplorerPane } from './ExplorerPane'
import { SPLIT_GRIDS } from '@/constants/splitModes'
import { useSplitResize, type SplitAxis } from '@/hooks/useSplitResize'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import type { Tab } from '@/types/workspace'

/**
 * Lays out a tab's panes with draggable dividers between them (PLAN.md §M16).
 *
 * CSS Grid rather than nested flex rows: `2 × 2` is a grid, panes fill it in
 * reading order on their own, and the fractions go straight into
 * `grid-template-*` instead of being threaded through `flexGrow`/`flexBasis` at
 * two levels. `minmax(0, Nfr)` matters — a bare `Nfr` track lets a long filename
 * push the column wider than its share.
 *
 * The dividers are positioned over the grid rather than sitting in it, and that
 * is what makes the 2 × 2 a cross: one vertical line spanning *both* rows, not
 * one per row that happen to line up. It also means a divider is one element,
 * one tab stop, and one thing a screen reader announces, however many rows it
 * crosses.
 */

/** Cumulative boundaries between parts, as percentages. Excludes the far edge. */
function boundaries(fractions: number[]): number[] {
  const stops: number[] = []
  let running = 0
  for (const fraction of fractions.slice(0, -1)) {
    running += fraction
    stops.push(running * 100)
  }
  return stops
}

export function PaneGroup({ tab }: { tab: Tab }) {
  const panes = useWorkspaceStore((state) => state.panes)
  const setLayout = useWorkspaceStore((state) => state.setLayout)
  const setActivePane = useWorkspaceStore((state) => state.setActivePane)

  const container = useRef<HTMLDivElement>(null)
  const grid = SPLIT_GRIDS[tab.splitMode]
  const { columns, rows } = tab.layout

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
        if (!pane) return null

        return (
          <div key={paneId} className="flex min-h-0 min-w-0 flex-col overflow-hidden">
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

      {boundaries(columns).map((percent, index) => (
        <Divider
          key={`column-${index}`}
          axis="x"
          index={index}
          percent={percent}
          fraction={columns[index] ?? 0}
          label={grid.columns > 2 ? `Resize column ${index + 1}` : 'Resize columns'}
          onStart={columnResize.startResize}
          onNudge={columnResize.nudge}
        />
      ))}

      {boundaries(rows).map((percent, index) => (
        <Divider
          key={`row-${index}`}
          axis="y"
          index={index}
          percent={percent}
          fraction={rows[index] ?? 0}
          label="Resize rows"
          onStart={rowResize.startResize}
          onNudge={rowResize.nudge}
        />
      ))}
    </div>
  )
}

function Divider({
  axis,
  index,
  percent,
  fraction,
  label,
  onStart,
  onNudge,
}: {
  axis: SplitAxis
  index: number
  /** Where the boundary sits, as a percentage of the container. */
  percent: number
  /** The size of the part before it, for `aria-valuenow`. */
  fraction: number
  label: string
  onStart: (index: number, event: React.MouseEvent) => void
  onNudge: (index: number, direction: -1 | 1) => void
}) {
  const horizontal = axis === 'x'
  // Arrow keys follow the divider's own orientation: a horizontal divider that
  // answered to Left/Right would be the kind of detail that makes keyboard
  // support feel bolted on (§M16 decision 5).
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
      onMouseDown={(event) => onStart(index, event)}
      onKeyDown={(event) => {
        if (event.key === decrease) {
          event.preventDefault()
          onNudge(index, -1)
        }
        if (event.key === increase) {
          event.preventDefault()
          onNudge(index, 1)
        }
      }}
      // Centred on the boundary and drawn over the panes, so the line is
      // continuous across every row it crosses.
      className={`bg-edge hover:bg-accent focus-visible:bg-accent absolute z-10 transition-colors ${
        horizontal
          ? 'inset-y-0 w-1 -translate-x-1/2 cursor-col-resize'
          : 'inset-x-0 h-1 -translate-y-1/2 cursor-row-resize'
      }`}
      style={horizontal ? { left: `${percent}%` } : { top: `${percent}%` }}
    />
  )
}
