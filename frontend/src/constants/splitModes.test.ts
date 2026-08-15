import { describe, expect, it } from 'vitest'
import {
  SPLIT_GRIDS,
  SPLIT_MODES,
  SPLIT_OPTIONS,
  cellsOf,
  columnSpanOf,
  defaultModeForPaneCount,
  dividersOf,
  evenLayout,
  isSplitMode,
  occupancyOf,
  paneCount,
  rowSpanOf,
  splitLabel,
  splitModeFromLegacy,
} from './splitModes'

describe('the layouts', () => {
  it('offers all nine', () => {
    expect(SPLIT_MODES).toHaveLength(9)
    expect(SPLIT_OPTIONS).toHaveLength(9)
  })

  it('makes four panes two rows of two', () => {
    expect(SPLIT_GRIDS['grid-2x2']).toEqual({ columns: 2, rows: 2 })
    expect(paneCount('grid-2x2')).toBe(4)
  })

  it('stacks 2 Rows in one column', () => {
    expect(SPLIT_GRIDS['rows-2']).toEqual({ columns: 1, rows: 2 })
    expect(paneCount('rows-2')).toBe(2)
  })

  // The five asymmetric ones all live in a 2 × 2 of tracks; what differs is
  // which pane spans two of them.
  it.each([
    ['split-top', 3],
    ['split-bottom', 3],
    ['split-left', 3],
    ['split-right', 3],
  ] as const)('%s holds %i panes in a 2 × 2 of tracks', (mode, panes) => {
    expect(SPLIT_GRIDS[mode]).toEqual({ columns: 2, rows: 2 })
    expect(paneCount(mode)).toBe(panes)
  })

  it('spans the wide pane across both columns in Split Top', () => {
    const [, , wide] = cellsOf('split-top')
    expect(wide).toEqual({ column: 0, row: 1, columnSpan: 2 })
  })

  it('spans the tall pane across both rows in Split Left', () => {
    const [, tall] = cellsOf('split-left')
    expect(tall).toEqual({ column: 1, row: 0, rowSpan: 2 })
  })
})

/**
 * The guard that makes deriving everything else safe. An overlap draws one pane
 * on top of another and a gap leaves a hole in the window; neither throws, and
 * neither is obvious in a screenshot of a folder listing.
 */
describe('every layout tiles its grid exactly', () => {
  it.each(SPLIT_MODES)('%s covers every cell exactly once', (mode) => {
    const grid = SPLIT_GRIDS[mode]
    const covered = new Map<string, number>()

    cellsOf(mode).forEach((cell, index) => {
      for (let column = cell.column; column < cell.column + columnSpanOf(cell); column += 1) {
        for (let row = cell.row; row < cell.row + rowSpanOf(cell); row += 1) {
          const key = `${column},${row}`
          const existing = covered.get(key)
          expect(
            existing,
            `panes ${existing} and ${index} both cover cell ${key} in ${mode}`,
          ).toBeUndefined()
          covered.set(key, index)
        }
      }
    })

    // Nothing left uncovered.
    for (let column = 0; column < grid.columns; column += 1) {
      for (let row = 0; row < grid.rows; row += 1) {
        expect(covered.has(`${column},${row}`), `${mode} leaves cell ${column},${row} empty`).toBe(
          true,
        )
      }
    }

    expect(covered.size).toBe(grid.columns * grid.rows)
    expect(occupancyOf(mode).flat().includes(-1)).toBe(false)
  })
})

describe('the derived dividers', () => {
  it('gives a single pane nothing to drag', () => {
    expect(dividersOf('single')).toEqual([])
  })

  it('runs the 2 × 2 cross the whole way across both axes', () => {
    expect(dividersOf('grid-2x2')).toEqual([
      { axis: 'x', index: 0, from: 0, to: 2 },
      { axis: 'y', index: 0, from: 0, to: 2 },
    ])
  })

  it('gives 3 Columns two boundaries and no row divider', () => {
    expect(dividersOf('columns-3')).toEqual([
      { axis: 'x', index: 0, from: 0, to: 1 },
      { axis: 'x', index: 1, from: 0, to: 1 },
    ])
  })

  // The point of §M17 decision 4: a divider stops where the panes on either
  // side of it stop being different.
  it('stops Split Top’s column divider at the row boundary', () => {
    expect(dividersOf('split-top')).toEqual([
      // The top row only — beneath it there is one pane on both sides.
      { axis: 'x', index: 0, from: 0, to: 1 },
      // The row divider still spans both columns.
      { axis: 'y', index: 0, from: 0, to: 2 },
    ])
  })

  it('starts Split Bottom’s column divider at the row boundary', () => {
    expect(dividersOf('split-bottom')).toEqual([
      { axis: 'x', index: 0, from: 1, to: 2 },
      { axis: 'y', index: 0, from: 0, to: 2 },
    ])
  })

  it('confines Split Left’s row divider to the left column', () => {
    expect(dividersOf('split-left')).toEqual([
      { axis: 'x', index: 0, from: 0, to: 2 },
      { axis: 'y', index: 0, from: 0, to: 1 },
    ])
  })

  it('confines Split Right’s row divider to the right column', () => {
    expect(dividersOf('split-right')).toEqual([
      { axis: 'x', index: 0, from: 0, to: 2 },
      { axis: 'y', index: 0, from: 1, to: 2 },
    ])
  })

  // Whatever the shape, a divider must sit on a real boundary and cover a real
  // stretch, or it renders as a zero-length line nobody can grab.
  it.each(SPLIT_MODES)('%s produces only well-formed segments', (mode) => {
    const grid = SPLIT_GRIDS[mode]
    for (const divider of dividersOf(mode)) {
      const boundaries = divider.axis === 'x' ? grid.columns - 1 : grid.rows - 1
      const steps = divider.axis === 'x' ? grid.rows : grid.columns
      expect(divider.index).toBeGreaterThanOrEqual(0)
      expect(divider.index).toBeLessThan(boundaries)
      expect(divider.to).toBeGreaterThan(divider.from)
      expect(divider.to).toBeLessThanOrEqual(steps)
    }
  })
})

describe('evenLayout', () => {
  it('splits both axes evenly', () => {
    expect(evenLayout('grid-2x2')).toEqual({ columns: [0.5, 0.5], rows: [0.5, 0.5] })
    expect(evenLayout('rows-2')).toEqual({ columns: [1], rows: [0.5, 0.5] })
    expect(evenLayout('columns-3').rows).toEqual([1])
  })

  it('sums to 1 on both axes and matches the track counts', () => {
    for (const mode of SPLIT_MODES) {
      const { columns, rows } = evenLayout(mode)
      expect(columns.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
      expect(rows.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
      expect(columns).toHaveLength(SPLIT_GRIDS[mode].columns)
      expect(rows).toHaveLength(SPLIT_GRIDS[mode].rows)
    }
  })
})

describe('isSplitMode', () => {
  // A stored mode is untrusted input in both directions: a database written by
  // another build can name anything at all.
  it('accepts the nine names and nothing else', () => {
    expect(isSplitMode('split-left')).toBe(true)
    expect(isSplitMode('grid-3x3')).toBe(false)
    // The pre-§M17 numbers are not modes any more; they go through the mapper.
    expect(isSplitMode(2)).toBe(false)
    expect(isSplitMode(null)).toBe(false)
  })
})

describe('splitModeFromLegacy', () => {
  it('maps the pre-M17 pane counts onto names', () => {
    expect(splitModeFromLegacy(1)).toBe('single')
    expect(splitModeFromLegacy(2)).toBe('columns-2')
    expect(splitModeFromLegacy(3)).toBe('columns-3')
    // Four meant four columns before M16 and a 2 × 2 after it; M16 already
    // decided both restore to the grid.
    expect(splitModeFromLegacy(4)).toBe('grid-2x2')
  })

  it('refuses anything that was never a legal count', () => {
    expect(splitModeFromLegacy(5)).toBeNull()
    expect(splitModeFromLegacy('columns-2')).toBeNull()
    expect(splitModeFromLegacy(undefined)).toBeNull()
  })
})

describe('defaultModeForPaneCount', () => {
  // M16's "one mode per pane count" is gone — five modes hold three panes — so
  // the fallback is declared rather than searched.
  it('picks one canonical mode per count', () => {
    expect(defaultModeForPaneCount(1)).toBe('single')
    expect(defaultModeForPaneCount(2)).toBe('columns-2')
    expect(defaultModeForPaneCount(3)).toBe('columns-3')
    expect(defaultModeForPaneCount(4)).toBe('grid-2x2')
  })

  it('clamps a count no layout holds', () => {
    expect(defaultModeForPaneCount(0)).toBe('single')
    expect(defaultModeForPaneCount(99)).toBe('grid-2x2')
  })
})

describe('splitLabel', () => {
  it('names each layout', () => {
    expect(splitLabel('single')).toBe('Single Pane')
    expect(splitLabel('columns-2')).toBe('2 Columns')
    expect(splitLabel('rows-2')).toBe('2 Rows')
    expect(splitLabel('columns-3')).toBe('3 Columns')
    expect(splitLabel('grid-2x2')).toBe('2 × 2 Grid')
    expect(splitLabel('split-top')).toBe('Split Top')
    expect(splitLabel('split-bottom')).toBe('Split Bottom')
    expect(splitLabel('split-left')).toBe('Split Left')
    expect(splitLabel('split-right')).toBe('Split Right')
  })

  // The dropdown renders no text, so these names are what the tooltip, the
  // accessible name, the status bar and both View menus say. Every layout needs
  // one.
  it('gives every layout a name', () => {
    for (const mode of SPLIT_MODES) expect(splitLabel(mode)).toBeTruthy()
  })
})
