import { describe, expect, it } from 'vitest'
import {
  COLUMNS,
  DEFAULT_LAYOUT,
  balanceWeights,
  columnSpec,
  gridTemplate,
  isColumnId,
  isDefaultLayout,
  minWeightsOf,
  moveColumn,
  normaliseLayout,
  weightsOf,
  withWeights,
} from './columns'

const IDS = COLUMNS.map((spec) => spec.id)

/** Floating-point sums never land on exactly 1. */
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

describe('the registry', () => {
  it('has default weights that tile the pane exactly', () => {
    expect(sum(COLUMNS.map((spec) => spec.defaultWeight))).toBeCloseTo(1, 10)
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
    expect(isColumnId('created')).toBe(false)
    expect(isColumnId(undefined)).toBe(false)
    expect(isColumnId(0)).toBe(false)
  })
})

describe('moveColumn', () => {
  it('moves a column forward, closing the gap behind it', () => {
    expect(moveColumn(IDS, 0, 2)).toEqual(['size', 'type', 'name', 'modified'])
  })

  it('moves a column backward', () => {
    expect(moveColumn(IDS, 3, 0)).toEqual(['modified', 'name', 'size', 'type'])
  })

  it('moves a column one place, which is what the keyboard does', () => {
    expect(moveColumn(IDS, 1, 2)).toEqual(['name', 'type', 'size', 'modified'])
  })

  // A drag released where it started, and the arrow keys at either end.
  it('returns the same array when nothing would change', () => {
    expect(moveColumn(IDS, 2, 2)).toBe(IDS)
    expect(moveColumn(IDS, 0, -1)).toBe(IDS)
    expect(moveColumn(IDS, 3, 9)).toBe(IDS)
    expect(moveColumn(IDS, -1, 0)).toBe(IDS)
    expect(moveColumn(IDS, 4, 0)).toBe(IDS)
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
      order: ['created', 'name', 'size', 'type', 'modified'],
      weights: { created: 0.2, name: 0.2, size: 0.2, type: 0.2, modified: 0.2 },
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
    expect(layout.order).toEqual(['modified', 'name', 'size', 'type'])
    expect(sum(weightsOf(layout))).toBeCloseTo(1, 10)
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
    const moved = { order: moveColumn(IDS, 0, 3), weights: DEFAULT_LAYOUT.weights }
    // Name is last now, so its weight is last — the width travels with the
    // column, which is the point of keying weights by id.
    expect(weightsOf(moved)).toEqual([0.2, 0.2, 0.2, 0.4])

    const resized = withWeights(moved, [0.1, 0.2, 0.3, 0.4])
    expect(resized.weights.name).toBe(0.4)
    expect(resized.weights.size).toBe(0.1)
    expect(resized.order).toBe(moved.order)
  })

  it('reports floors in display order', () => {
    expect(minWeightsOf(DEFAULT_LAYOUT)).toEqual(COLUMNS.map((spec) => spec.minWeight))
  })

  it('builds a grid template in display order', () => {
    expect(gridTemplate(DEFAULT_LAYOUT)).toBe(
      'minmax(0, 0.4fr) minmax(0, 0.2fr) minmax(0, 0.2fr) minmax(0, 0.2fr)',
    )
  })

  it('has one template entry per column, whatever the order', () => {
    const layout = { order: moveColumn(IDS, 3, 0), weights: DEFAULT_LAYOUT.weights }
    expect(gridTemplate(layout).split(' minmax')).toHaveLength(layout.order.length)
  })
})

describe('isDefaultLayout', () => {
  it('is true for the default', () => {
    expect(isDefaultLayout(DEFAULT_LAYOUT)).toBe(true)
  })

  it('is false once a column has moved', () => {
    expect(isDefaultLayout({ ...DEFAULT_LAYOUT, order: moveColumn(IDS, 0, 1) })).toBe(false)
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
