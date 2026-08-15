import type { PaneLayout, SplitMode } from '@/types/workspace'

/**
 * The split layouts, as data (PLAN.md §M16, §M17).
 *
 * One source for the label and the shape. Before M16 the modes were named in
 * four places and the status bar had already drifted; before M17 the shape was
 * "how many columns by how many rows", which only describes a uniform grid.
 *
 * A mode now declares **which cells each pane occupies** and nothing else.
 * Everything downstream — the track counts, the pane count, the dividers and
 * the icon — is derived from that one list, so adding a tenth layout means
 * describing its panes and no more. `splitModes.test.ts` proves every mode's
 * cells tile its grid exactly: no overlap, no gap. Neither of those fails
 * loudly on its own — an overlap draws one pane on top of another and a gap
 * leaves a hole — so the test is what makes deriving safe.
 */

/**
 * One pane's place in the track grid. Spans default to 1.
 *
 * Cells are declared in reading order — scanning the grid left to right, top to
 * bottom, taking each pane at its first appearance — because that order is what
 * the pane letters A/B/C/D follow, and what "add a pane" and "drop a pane"
 * count along.
 */
export interface SplitCell {
  column: number
  row: number
  columnSpan?: number
  rowSpan?: number
}

interface SplitSpec {
  label: string
  cells: SplitCell[]
}

/**
 * Ordered as the 3 × 3 picker fills, row by row: the trivial ones, then the
 * three-pane arrangements, then the four-pane grid.
 */
const SPECS: Record<SplitMode, SplitSpec> = {
  single: { label: 'Single Pane', cells: [{ column: 0, row: 0 }] },
  'columns-2': {
    label: '2 Columns',
    cells: [
      { column: 0, row: 0 },
      { column: 1, row: 0 },
    ],
  },
  'rows-2': {
    label: '2 Rows',
    cells: [
      { column: 0, row: 0 },
      { column: 0, row: 1 },
    ],
  },
  'columns-3': {
    label: '3 Columns',
    cells: [
      { column: 0, row: 0 },
      { column: 1, row: 0 },
      { column: 2, row: 0 },
    ],
  },
  // Two panes above one full-width pane.
  'split-top': {
    label: 'Split Top',
    cells: [
      { column: 0, row: 0 },
      { column: 1, row: 0 },
      { column: 0, row: 1, columnSpan: 2 },
    ],
  },
  // One full-width pane above two.
  'split-bottom': {
    label: 'Split Bottom',
    cells: [
      { column: 0, row: 0, columnSpan: 2 },
      { column: 0, row: 1 },
      { column: 1, row: 1 },
    ],
  },
  // Two stacked panes beside one full-height pane. B is the tall one on the
  // right because it is the second pane reading order reaches, as everywhere.
  'split-left': {
    label: 'Split Left',
    cells: [
      { column: 0, row: 0 },
      { column: 1, row: 0, rowSpan: 2 },
      { column: 0, row: 1 },
    ],
  },
  // One full-height pane beside two stacked ones.
  'split-right': {
    label: 'Split Right',
    cells: [
      { column: 0, row: 0, rowSpan: 2 },
      { column: 1, row: 0 },
      { column: 1, row: 1 },
    ],
  },
  'grid-2x2': {
    label: '2 × 2 Grid',
    cells: [
      { column: 0, row: 0 },
      { column: 1, row: 0 },
      { column: 0, row: 1 },
      { column: 1, row: 1 },
    ],
  },
}

export const SPLIT_MODES = Object.keys(SPECS) as SplitMode[]

export const SPLIT_OPTIONS: { mode: SplitMode; label: string; cells: SplitCell[] }[] =
  SPLIT_MODES.map((mode) => ({ mode, label: SPECS[mode].label, cells: SPECS[mode].cells }))

export function splitLabel(mode: SplitMode): string {
  return SPECS[mode]?.label ?? 'Single Pane'
}

export function cellsOf(mode: SplitMode): SplitCell[] {
  return SPECS[mode].cells
}

export function isSplitMode(value: unknown): value is SplitMode {
  return typeof value === 'string' && value in SPECS
}

/** How many panes a mode holds. One per cell, by definition. */
export function paneCount(mode: SplitMode): number {
  return SPECS[mode].cells.length
}

export const columnSpanOf = (cell: SplitCell): number => cell.columnSpan ?? 1
export const rowSpanOf = (cell: SplitCell): number => cell.rowSpan ?? 1

export interface SplitGrid {
  columns: number
  rows: number
}

/** The track counts a mode needs, derived so they cannot disagree with cells. */
function gridOf(cells: readonly SplitCell[]): SplitGrid {
  let columns = 0
  let rows = 0
  for (const cell of cells) {
    columns = Math.max(columns, cell.column + columnSpanOf(cell))
    rows = Math.max(rows, cell.row + rowSpanOf(cell))
  }
  return { columns: Math.max(columns, 1), rows: Math.max(rows, 1) }
}

export const SPLIT_GRIDS: Record<SplitMode, SplitGrid> = Object.fromEntries(
  SPLIT_MODES.map((mode) => [mode, gridOf(SPECS[mode].cells)]),
) as Record<SplitMode, SplitGrid>

/**
 * Which pane sits in each track cell; -1 where nothing does.
 *
 * Exported for the tiling test, which is the only thing that needs to see a
 * hole. Indexed `[column][row]`.
 */
export function occupancyOf(mode: SplitMode): number[][] {
  const grid = SPLIT_GRIDS[mode]
  const map: number[][] = Array.from({ length: grid.columns }, () =>
    Array.from({ length: grid.rows }, () => -1),
  )

  SPECS[mode].cells.forEach((cell, index) => {
    for (let column = cell.column; column < cell.column + columnSpanOf(cell); column += 1) {
      for (let row = cell.row; row < cell.row + rowSpanOf(cell); row += 1) {
        const strip = map[column]
        if (strip && row < strip.length) strip[row] = index
      }
    }
  })
  return map
}

/**
 * A stretch of draggable divider.
 *
 * `index` is the boundary it moves — between track `index` and `index + 1` on
 * its own axis — and `from`/`to` are the half-open track range it covers on the
 * perpendicular one. A 2 × 2's column divider covers every row and reads as one
 * continuous line; Split Top's covers only the top row and stops at the pane
 * that spans beneath it.
 */
export interface DividerSegment {
  axis: 'x' | 'y'
  index: number
  from: number
  to: number
}

/**
 * Derives the dividers from the cells.
 *
 * Walks each boundary asking, at every step, whether the panes on either side
 * of it are different; where they are, there is something to drag, and touching
 * steps merge into one segment. Declaring the dividers per mode instead would
 * be a second description of the same arrangement, and the two would drift the
 * first time a layout was adjusted (§M17 decision 4).
 */
export function dividersOf(mode: SplitMode): DividerSegment[] {
  const grid = SPLIT_GRIDS[mode]
  const map = occupancyOf(mode)
  const segments: DividerSegment[] = []

  const at = (column: number, row: number): number => map[column]?.[row] ?? -1

  const scan = (axis: 'x' | 'y', boundaries: number, steps: number): void => {
    for (let index = 0; index < boundaries; index += 1) {
      let start: number | null = null
      // One past the end, so a run reaching the far edge is still closed.
      for (let step = 0; step <= steps; step += 1) {
        const differs =
          step < steps &&
          (axis === 'x'
            ? at(index, step) !== at(index + 1, step)
            : at(step, index) !== at(step, index + 1))

        if (differs && start === null) start = step
        if (!differs && start !== null) {
          segments.push({ axis, index, from: start, to: step })
          start = null
        }
      }
    }
  }

  scan('x', grid.columns - 1, grid.rows)
  scan('y', grid.rows - 1, grid.columns)
  return segments
}

/** Equal fractions on both axes; used whenever the mode changes. */
export function evenLayout(mode: SplitMode): PaneLayout {
  const grid = SPLIT_GRIDS[mode]
  return {
    columns: Array.from({ length: grid.columns }, () => 1 / grid.columns),
    rows: Array.from({ length: grid.rows }, () => 1 / grid.rows),
  }
}

/**
 * The mode to fall back on for a given number of panes.
 *
 * Declared rather than searched, because M16's "one mode per pane count" no
 * longer holds: five modes hold three panes and only one of them can be the
 * answer when a restored tab's mode is unreadable. Making that choice in the
 * open beats letting it fall out of whichever `find` happens to hit first
 * (§M17 decision 11).
 */
const CANONICAL: Record<number, SplitMode> = {
  1: 'single',
  2: 'columns-2',
  3: 'columns-3',
  4: 'grid-2x2',
}

export function defaultModeForPaneCount(count: number): SplitMode {
  return CANONICAL[Math.min(Math.max(count, 1), 4)] ?? 'single'
}

/**
 * Reads a `splitMode` written before §M17, when it was a pane count.
 *
 * The third shape this field has taken, so the mapping is spelled out rather
 * than inferred: a stored `4` meant four columns before M16 and a 2 × 2 after
 * it, and both restore to the grid because M16 already made that call.
 */
export function splitModeFromLegacy(value: unknown): SplitMode | null {
  return typeof value === 'number' ? (CANONICAL[value] ?? null) : null
}
