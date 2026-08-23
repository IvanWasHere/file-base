import { describe, expect, it } from 'vitest'
import {
  COLUMNS,
  DEFAULT_LAYOUT,
  balanceWeights,
  columnSpec,
  gridTemplate,
  isColumnId,
  isColumnVisible,
  isDefaultLayout,
  minWeightsOf,
  moveColumn,
  moveVisibleColumn,
  normaliseLayout,
  setColumnVisible,
  visibleColumns,
  weightsOf,
  withWeights,
  type ColumnId,
  type ColumnLayout,
} from './columns'

const IDS = COLUMNS.map((spec) => spec.id)

/** The four a fresh install draws — `IDS` has been longer than that since §M22. */
const SHOWN = COLUMNS.filter((spec) => spec.defaultVisible).map((spec) => spec.id)

/** A layout literal, spared repeating `hidden: []` in every helper test. */
const layoutOf = (order: ColumnId[], hidden: ColumnId[] = []): ColumnLayout => ({
  order,
  weights: DEFAULT_LAYOUT.weights,
  hidden,
})

/** Floating-point sums never land on exactly 1. */
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

describe('the registry', () => {
  // Over the columns a fresh install shows: a hidden column's weight is not on
  // screen to tile anything, and `setColumnVisible` rebalances when it arrives.
  it('has default weights that tile the pane exactly', () => {
    expect(sum(SHOWN.map((id) => columnSpec(id).defaultWeight))).toBeCloseTo(1, 10)
  })

  // Otherwise Name could be switched off, and the listing would have no names.
  it('marks exactly one column required, and it is Name', () => {
    expect(COLUMNS.filter((spec) => spec.required).map((spec) => spec.id)).toEqual(['name'])
  })

  // Otherwise a fresh layout would already be under a floor, and the first
  // resize would jump.
  it('gives every column a default at or above its own floor', () => {
    for (const spec of COLUMNS) {
      expect(spec.defaultWeight).toBeGreaterThanOrEqual(spec.minWeight)
    }
  })

  // The guard in `balanceWeights` would otherwise be the only thing between a
  // pane and an unsatisfiable layout.
  it('has floors that can all be honoured at once', () => {
    expect(sum(COLUMNS.map((spec) => spec.minWeight))).toBeLessThan(1)
  })

  it('recognises its own ids and nothing else', () => {
    for (const id of IDS) expect(isColumnId(id)).toBe(true)
    expect(isColumnId('owner')).toBe(false)
    expect(isColumnId(undefined)).toBe(false)
    expect(isColumnId(0)).toBe(false)
  })
})

describe('moveColumn', () => {
  it('moves a column forward, closing the gap behind it', () => {
    expect(moveColumn(IDS, 0, 2)).toEqual(['size', 'type', 'name', 'modified', 'created', 'tags'])
  })

  it('moves a column backward', () => {
    expect(moveColumn(IDS, 3, 0)).toEqual(['modified', 'name', 'size', 'type', 'created', 'tags'])
  })

  it('moves a column one place, which is what the keyboard does', () => {
    expect(moveColumn(IDS, 1, 2)).toEqual(['name', 'type', 'size', 'modified', 'created', 'tags'])
  })

  // A drag released where it started, and the arrow keys at either end.
  it('returns the same array when nothing would change', () => {
    expect(moveColumn(IDS, 2, 2)).toBe(IDS)
    expect(moveColumn(IDS, 0, -1)).toBe(IDS)
    expect(moveColumn(IDS, IDS.length - 1, 99)).toBe(IDS)
    expect(moveColumn(IDS, -1, 0)).toBe(IDS)
    expect(moveColumn(IDS, IDS.length, 0)).toBe(IDS)
  })

  it('never loses or duplicates a column, for any pair', () => {
    for (let from = 0; from < IDS.length; from++) {
      for (let to = 0; to < IDS.length; to++) {
        const moved = moveColumn(IDS, from, to)
        expect([...moved].sort()).toEqual([...IDS].sort())
      }
    }
  })
})

describe('balanceWeights', () => {
  const mins = [0.15, 0.08, 0.08, 0.08]

  it('scales weights that do not sum to 1', () => {
    const result = balanceWeights([0.2, 0.1, 0.1, 0.1], mins)
    expect(sum(result)).toBeCloseTo(1, 10)
    expect(result).toEqual([0.4, 0.2, 0.2, 0.2])
  })

  // Scale-then-clamp breaks the sum; clamp-then-scale pushes the clamped column
  // back under its floor. Both invariants have to hold at once.
  it('lifts a column under its floor and still sums to 1', () => {
    const result = balanceWeights([0.9, 0.02, 0.04, 0.04], mins)
    expect(sum(result)).toBeCloseTo(1, 10)
    result.forEach((weight, index) => {
      expect(weight).toBeGreaterThanOrEqual((mins[index] ?? 0) - 1e-9)
    })
  })

  it('handles every column being under its floor', () => {
    const result = balanceWeights([0.01, 0.01, 0.01, 0.01], mins)
    expect(sum(result)).toBeCloseTo(1, 10)
    result.forEach((weight, index) => {
      expect(weight).toBeGreaterThanOrEqual((mins[index] ?? 0) - 1e-9)
    })
  })

  it('shares the pane evenly when every weight is zero', () => {
    const result = balanceWeights([0, 0, 0, 0], mins)
    expect(sum(result)).toBeCloseTo(1, 10)
  })

  // The guard, not a path the registry can reach.
  it('falls back to proportional floors when they cannot all be met', () => {
    const result = balanceWeights([0.5, 0.5], [0.7, 0.7])
    expect(sum(result)).toBeCloseTo(1, 10)
  })
})

describe('normaliseLayout', () => {
  it('accepts a good layout unchanged', () => {
    const layout = normaliseLayout(DEFAULT_LAYOUT)
    expect(layout.order).toEqual(IDS)
    expect(sum(weightsOf(layout))).toBeCloseTo(1, 10)
  })

  it('falls back to the default for anything that is not a layout', () => {
    expect(normaliseLayout(null)).toBe(DEFAULT_LAYOUT)
    expect(normaliseLayout('columns')).toBe(DEFAULT_LAYOUT)
    expect(normaliseLayout(42)).toBe(DEFAULT_LAYOUT)
    expect(normaliseLayout(undefined)).toBe(DEFAULT_LAYOUT)
  })

  // A row written by a later build that added a column.
  it('drops an unknown id', () => {
    const layout = normaliseLayout({
      order: ['owner', 'name', 'size', 'type', 'modified'],
      weights: { owner: 0.2, name: 0.2, size: 0.2, type: 0.2, modified: 0.2 },
    })
    expect(layout.order).toEqual(IDS)
    expect(sum(weightsOf(layout))).toBeCloseTo(1, 10)
  })

  // A row written by an older build, before a column existed.
  it('appends a missing column in registry order', () => {
    const layout = normaliseLayout({
      order: ['modified', 'name'],
      weights: { modified: 0.5, name: 0.5 },
    })
    expect(layout.order).toEqual(['modified', 'name', 'size', 'type', 'created', 'tags'])
    expect(sum(weightsOf(layout))).toBeCloseTo(1, 10)
  })

  // §M22's upgrade path, and the reason `defaultVisible` exists: a layout
  // stored before Created and Tags existed keeps the four columns it had.
  it('adds a newly-introduced column switched off when its default says so', () => {
    const layout = normaliseLayout({
      order: ['name', 'size', 'type', 'modified'],
      weights: { name: 0.4, size: 0.2, type: 0.2, modified: 0.2 },
    })
    expect(visibleColumns(layout)).toEqual(['name', 'size', 'type', 'modified'])
    expect(layout.hidden).toEqual(['created', 'tags'])
    expect(sum(weightsOf(layout))).toBeCloseTo(1, 10)
  })

  it('keeps a hidden list the user actually chose', () => {
    const layout = normaliseLayout({
      order: IDS,
      weights: DEFAULT_LAYOUT.weights,
      hidden: ['type', 'created'],
    })
    expect(visibleColumns(layout)).toEqual(['name', 'size', 'modified', 'tags'])
    expect(sum(weightsOf(layout))).toBeCloseTo(1, 10)
  })

  // However the row got that way, a listing with no Name column has no way back.
  it('refuses to hide a required column, and ignores unknown ids in the list', () => {
    const layout = normaliseLayout({
      order: IDS,
      weights: DEFAULT_LAYOUT.weights,
      hidden: ['name', 'owner', 'size', 'size'],
    })
    expect(layout.hidden).toEqual(['size'])
    expect(isColumnVisible(layout, 'name')).toBe(true)
  })

  it('collapses a repeated id rather than drawing it twice', () => {
    const layout = normaliseLayout({
      order: ['name', 'name', 'size', 'type', 'modified'],
      weights: DEFAULT_LAYOUT.weights,
    })
    expect(layout.order).toEqual(IDS)
  })

  // The failure this whole function exists to prevent: a table with no columns.
  it('rebuilds an empty order', () => {
    const layout = normaliseLayout({ order: [], weights: {} })
    expect(layout.order).toEqual(IDS)
    expect(sum(weightsOf(layout))).toBeCloseTo(1, 10)
  })

  it('replaces weights that are missing, negative, zero or not numbers', () => {
    const layout = normaliseLayout({
      order: IDS,
      weights: { name: -1, size: 0, type: 'wide', modified: NaN },
    })
    expect(sum(weightsOf(layout))).toBeCloseTo(1, 10)
    for (const id of IDS) expect(layout.weights[id]).toBeGreaterThan(0)
  })

  it('renormalises weights that sum to anything else', () => {
    const layout = normaliseLayout({
      order: IDS,
      weights: { name: 4, size: 2, type: 2, modified: 2 },
      hidden: ['created', 'tags'],
    })
    expect(sum(weightsOf(layout))).toBeCloseTo(1, 10)
    expect(layout.weights.name).toBeCloseTo(0.4, 10)
  })

  it('lifts a stored weight that is under its floor', () => {
    const layout = normaliseLayout({
      order: IDS,
      weights: { name: 0.01, size: 0.33, type: 0.33, modified: 0.33 },
    })
    expect(layout.weights.name).toBeGreaterThanOrEqual(columnSpec('name').minWeight - 1e-9)
    expect(sum(weightsOf(layout))).toBeCloseTo(1, 10)
  })
})

describe('layout helpers', () => {
  it('reads and writes weights positionally against the order', () => {
    const moved = layoutOf(moveColumn(SHOWN, 0, 3), ['created', 'tags'])
    // Name is last now, so its weight is last — the width travels with the
    // column, which is the point of keying weights by id.
    expect(weightsOf(moved)).toEqual([0.2, 0.2, 0.2, 0.4])

    const resized = withWeights(moved, [0.1, 0.2, 0.3, 0.4])
    expect(resized.weights.name).toBe(0.4)
    expect(resized.weights.size).toBe(0.1)
    expect(resized.order).toBe(moved.order)
  })

  it('reports floors in display order', () => {
    expect(minWeightsOf(DEFAULT_LAYOUT)).toEqual(SHOWN.map((id) => columnSpec(id).minWeight))
  })

  it('builds a grid template in display order', () => {
    expect(gridTemplate(DEFAULT_LAYOUT)).toBe(
      'minmax(0, 0.4fr) minmax(0, 0.2fr) minmax(0, 0.2fr) minmax(0, 0.2fr)',
    )
  })

  it('has one template entry per visible column, whatever the order', () => {
    const layout = layoutOf(moveColumn(IDS, 3, 0), ['created', 'tags'])
    expect(gridTemplate(layout).split(' minmax')).toHaveLength(visibleColumns(layout).length)
  })

  // The three of them have to agree positionally, or a drag on the divider
  // between Size and Type would resize Type and Modified.
  it('keeps weights, floors and the template the same length', () => {
    const layout = setColumnVisible(DEFAULT_LAYOUT, 'tags', true)
    expect(weightsOf(layout)).toHaveLength(5)
    expect(minWeightsOf(layout)).toHaveLength(5)
    expect(gridTemplate(layout).split(' minmax')).toHaveLength(5)
  })
})

describe('column visibility', () => {
  it('starts with the columns a fresh install shows', () => {
    expect(visibleColumns(DEFAULT_LAYOUT)).toEqual(SHOWN)
    expect(isColumnVisible(DEFAULT_LAYOUT, 'tags')).toBe(false)
  })

  it('switches a column on and rebalances the row to fit it', () => {
    const layout = setColumnVisible(DEFAULT_LAYOUT, 'tags', true)
    expect(visibleColumns(layout)).toEqual([...SHOWN, 'tags'])
    expect(sum(weightsOf(layout))).toBeCloseTo(1, 10)
  })

  it('switches a column off and gives its width to the rest', () => {
    const layout = setColumnVisible(DEFAULT_LAYOUT, 'size', false)
    expect(visibleColumns(layout)).toEqual(['name', 'type', 'modified'])
    expect(sum(weightsOf(layout))).toBeCloseTo(1, 10)
  })

  it('refuses to hide a required column', () => {
    expect(setColumnVisible(DEFAULT_LAYOUT, 'name', false)).toBe(DEFAULT_LAYOUT)
  })

  it('is a no-op when the column is already in that state', () => {
    expect(setColumnVisible(DEFAULT_LAYOUT, 'size', true)).toBe(DEFAULT_LAYOUT)
    expect(setColumnVisible(DEFAULT_LAYOUT, 'tags', false)).toBe(DEFAULT_LAYOUT)
  })

  // Off and on again returns the column to where it was, not to the end: its
  // place in `order` is never touched, which is why `hidden` is a list of its
  // own rather than a shorter `order`.
  it('returns a column to its old position when switched back on', () => {
    const off = setColumnVisible(DEFAULT_LAYOUT, 'type', false)
    const on = setColumnVisible(off, 'type', true)
    expect(visibleColumns(on)).toEqual(SHOWN)
    expect(sum(weightsOf(on))).toBeCloseTo(1, 10)
  })

  // The reason `moveVisibleColumn` exists: with Type hidden, header 2 is
  // Modified, and `moveColumn` on the same index would have moved Type.
  it('moves the column the header actually shows', () => {
    const layout = setColumnVisible(DEFAULT_LAYOUT, 'type', false)
    expect(visibleColumns({ ...layout, order: moveVisibleColumn(layout, 2, 0) })).toEqual([
      'modified',
      'name',
      'size',
    ])
  })

  it('leaves the order alone for a move that changes nothing', () => {
    expect(moveVisibleColumn(DEFAULT_LAYOUT, 1, 1)).toBe(DEFAULT_LAYOUT.order)
    expect(moveVisibleColumn(DEFAULT_LAYOUT, 9, 0)).toBe(DEFAULT_LAYOUT.order)
  })
})

describe('isDefaultLayout', () => {
  it('is true for the default', () => {
    expect(isDefaultLayout(DEFAULT_LAYOUT)).toBe(true)
  })

  it('is false once a column has moved', () => {
    expect(isDefaultLayout({ ...DEFAULT_LAYOUT, order: moveColumn(IDS, 0, 1) })).toBe(false)
  })

  // Which columns are on is part of the layout since §M22, so turning Tags on
  // is exactly the kind of change Reset Columns should offer to undo.
  it('is false once a column has been switched on or off', () => {
    expect(isDefaultLayout(setColumnVisible(DEFAULT_LAYOUT, 'tags', true))).toBe(false)
    expect(isDefaultLayout(setColumnVisible(DEFAULT_LAYOUT, 'size', false))).toBe(false)
  })

  it('is false once a width has changed', () => {
    expect(isDefaultLayout(withWeights(DEFAULT_LAYOUT, [0.3, 0.3, 0.2, 0.2]))).toBe(false)
  })

  // A drag out and back leaves float dust, and Reset should still grey out.
  it('tolerates floating-point dust', () => {
    const dusty = withWeights(DEFAULT_LAYOUT, [0.4 + 1e-9, 0.2 - 1e-9, 0.2, 0.2])
    expect(isDefaultLayout(dusty)).toBe(true)
  })
})
