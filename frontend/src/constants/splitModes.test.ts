import { describe, expect, it } from 'vitest'
import {
  SPLIT_GRIDS,
  SPLIT_MODES,
  SPLIT_OPTIONS,
  evenLayout,
  isSplitMode,
  paneCount,
  splitLabel,
  splitModeForPaneCount,
} from './splitModes'

describe('the split grids', () => {
  // The change §M16 exists for. `Grid2x2` has been this mode's icon since M2
  // while the layout handed back four columns.
  it('makes four panes two rows of two', () => {
    expect(SPLIT_GRIDS[4]).toEqual({ columns: 2, rows: 2 })
  })

  it('keeps every other mode a single row', () => {
    expect(SPLIT_GRIDS[1]).toEqual({ columns: 1, rows: 1 })
    expect(SPLIT_GRIDS[2]).toEqual({ columns: 2, rows: 1 })
    expect(SPLIT_GRIDS[3]).toEqual({ columns: 3, rows: 1 })
  })

  // Every mode has to have a grid, or the layout indexes `undefined` and the
  // pane group renders nothing — the failure M13 decision 9 describes.
  it('covers every mode, with a label and an icon', () => {
    for (const mode of SPLIT_MODES) {
      expect(SPLIT_GRIDS[mode]).toBeDefined()
      const option = SPLIT_OPTIONS.find((entry) => entry.mode === mode)
      expect(option?.label).toBeTruthy()
      expect(option?.icon).toBeTruthy()
    }
    expect(SPLIT_MODES).toHaveLength(4)
  })
})

describe('paneCount', () => {
  it('is the product of the grid, not the mode number', () => {
    expect(paneCount(1)).toBe(1)
    expect(paneCount(2)).toBe(2)
    expect(paneCount(3)).toBe(3)
    expect(paneCount(4)).toBe(4)
  })

  // The invariant a restored session leans on: one mode per pane count, so a
  // tab whose panes and mode disagree has exactly one mode to fall back to.
  it('is unique across modes', () => {
    const counts = SPLIT_MODES.map(paneCount)
    expect(new Set(counts).size).toBe(counts.length)
  })
})

describe('splitModeForPaneCount', () => {
  it('finds the mode that holds that many panes', () => {
    expect(splitModeForPaneCount(1)).toBe(1)
    expect(splitModeForPaneCount(3)).toBe(3)
    expect(splitModeForPaneCount(4)).toBe(4)
  })

  it('falls back to the largest mode rather than returning nothing', () => {
    expect(splitModeForPaneCount(99)).toBe(4)
  })
})

describe('evenLayout', () => {
  it('splits both axes evenly', () => {
    expect(evenLayout(4)).toEqual({ columns: [0.5, 0.5], rows: [0.5, 0.5] })
    expect(evenLayout(3).rows).toEqual([1])
    expect(evenLayout(3).columns).toHaveLength(3)
  })

  it('sums to 1 on both axes for every mode', () => {
    for (const mode of SPLIT_MODES) {
      const { columns, rows } = evenLayout(mode)
      expect(columns.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
      expect(rows.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
      expect(columns.length * rows.length).toBe(paneCount(mode))
    }
  })
})

describe('isSplitMode', () => {
  // A stored mode is untrusted input in both directions, as a stored view mode
  // is: a database written by another build can name anything.
  it('rejects everything that is not one of the four', () => {
    expect(isSplitMode(2)).toBe(true)
    expect(isSplitMode(5)).toBe(false)
    expect(isSplitMode('2')).toBe(false)
    expect(isSplitMode(null)).toBe(false)
    expect(isSplitMode(undefined)).toBe(false)
  })
})

describe('splitLabel', () => {
  // The renames §M16 asked for, and the reason "Four Panes" could not stay:
  // every other name says the shape you get.
  it('names each mode by its shape', () => {
    expect(splitLabel(1)).toBe('Single Pane')
    expect(splitLabel(2)).toBe('2 Columns')
    expect(splitLabel(3)).toBe('3 Columns')
    expect(splitLabel(4)).toBe('2 × 2 Grid')
  })
})
