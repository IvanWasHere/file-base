/**
 * The detail view's columns, as data (PLAN.md §M19).
 *
 * The shape `splitModes`, `hashAlgorithms` and `themes` already have: what a
 * column *is* lives here, and how it draws lives in `DetailsView`. A registry
 * that imported React to hold cell renderers would stop being data — and the
 * renderer map there is typed `Record<ColumnId, …>`, so adding an entry to this
 * list fails to compile until it can be drawn.
 *
 * Widths are **fractions of the pane, never pixels** (§M19 decision 2), for the
 * reason §M16 stores pane sizes the same way: a pane in a 2 × 2 grid is a
 * quarter of the window wide, stored pixels would overflow it, and a window
 * resize would leave every column stranded at a stale width.
 */

import type { SortKey } from '@/services/filesystem/sort'

export type ColumnId = 'name' | 'size' | 'type' | 'modified'

export interface ColumnSpec {
  id: ColumnId
  label: string
  /** What clicking this header sorts by. */
  sortKey: SortKey
  /** Share of the pane in a fresh layout. The list sums to 1. */
  defaultWeight: number
  /**
   * Floor, as a share of the pane. Per column rather than one global figure: a
   * Name column squeezed to 8% is unreadable, and a Size column held at 15%
   * wastes a third of a split pane on four characters.
   */
  minWeight: number
}

/**
 * Registry order, which is also the default layout order and the order missing
 * columns are appended in when a stored layout is repaired.
 *
 * The weights are the `2fr 1fr 1fr 1fr` the view was hard-coded to before this
 * milestone, written as fractions.
 */
export const COLUMNS: ColumnSpec[] = [
  { id: 'name', label: 'Name', sortKey: 'name', defaultWeight: 0.4, minWeight: 0.15 },
  { id: 'size', label: 'Size', sortKey: 'size', defaultWeight: 0.2, minWeight: 0.08 },
  { id: 'type', label: 'Type', sortKey: 'type', defaultWeight: 0.2, minWeight: 0.08 },
  { id: 'modified', label: 'Modified', sortKey: 'modified', defaultWeight: 0.2, minWeight: 0.08 },
]

/**
 * A layout: the order columns appear in, and how wide each one is.
 *
 * Weights are keyed by id rather than parallel to `order`, so moving a column
 * cannot desynchronise a column from its width — the bug two parallel arrays
 * invite on the first reorder.
 */
export interface ColumnLayout {
  order: ColumnId[]
  weights: Record<ColumnId, number>
}

const BY_ID = new Map(COLUMNS.map((spec) => [spec.id, spec]))

export function columnSpec(id: ColumnId): ColumnSpec {
  // Non-null: the map is built from the same list the union is written from.
  return BY_ID.get(id) as ColumnSpec
}

export function isColumnId(value: unknown): value is ColumnId {
  return typeof value === 'string' && BY_ID.has(value as ColumnId)
}

export const DEFAULT_LAYOUT: ColumnLayout = {
  order: COLUMNS.map((spec) => spec.id),
  weights: Object.fromEntries(COLUMNS.map((spec) => [spec.id, spec.defaultWeight])) as Record<
    ColumnId,
    number
  >,
}

/** The weights of `order`, as the array `useSplitResize` works in. */
export function weightsOf(layout: ColumnLayout): number[] {
  return layout.order.map((id) => layout.weights[id])
}

/** A layout with the same order and new weights, positional to `order`. */
export function withWeights(layout: ColumnLayout, weights: number[]): ColumnLayout {
  const next = { ...layout.weights }
  layout.order.forEach((id, index) => {
    const weight = weights[index]
    if (weight !== undefined) next[id] = weight
  })
  return { order: layout.order, weights: next }
}

/** The floors of `order`, in the same positional form. */
export function minWeightsOf(layout: ColumnLayout): number[] {
  return layout.order.map((id) => columnSpec(id).minWeight)
}

/**
 * `grid-template-columns` for both the header and every row.
 *
 * Rounded, because a fraction that has been through a drag is
 * `0.30000000000000004` and the browser cannot tell that from `0.3`. The state
 * keeps full precision — only what reaches the DOM is trimmed, so a drag does
 * not rewrite the style string of every row for a difference nobody can see.
 */
export function gridTemplate(layout: ColumnLayout): string {
  return layout.order.map((id) => `minmax(0, ${Number(layout.weights[id].toFixed(4))}fr)`).join(' ')
}

/**
 * Moves the column at `from` so it sits at index `to`, the way dropping it there
 * reads: the ones it passes close up behind it.
 *
 * Out-of-range indices and a move to where it already is both return the same
 * order, so a drag that ends where it started changes nothing.
 */
export function moveColumn(order: ColumnId[], from: number, to: number): ColumnId[] {
  if (from < 0 || from >= order.length) return order
  const target = Math.min(Math.max(to, 0), order.length - 1)
  if (target === from) return order

  const next = [...order]
  const [moved] = next.splice(from, 1)
  if (!moved) return order
  next.splice(target, 0, moved)
  return next
}

/**
 * Redistributes weights so they sum to 1 and no column is under its floor.
 *
 * Water-filling rather than a scale-then-clamp: clamping after scaling breaks
 * the sum again, and scaling after clamping pushes columns back under their
 * floor. Each pass pins whatever fell short and rescales the rest into what is
 * left, which terminates because a pinned column is never freed.
 */
export function balanceWeights(values: number[], mins: number[]): number[] {
  const result = [...values]
  const pinned = new Set<number>()

  // Mins that cannot all be honoured would loop forever chasing a budget that
  // does not exist. Registry mins sum to 0.39, so this is a guard, not a path.
  const minTotal = mins.reduce((sum, min) => sum + min, 0)
  if (minTotal >= 1) {
    return mins.map((min) => min / minTotal)
  }

  for (let pass = 0; pass <= result.length; pass++) {
    const free = result.map((_, index) => index).filter((index) => !pinned.has(index))
    if (free.length === 0) break

    const pinnedTotal = [...pinned].reduce((sum, index) => sum + (result[index] ?? 0), 0)
    const freeTotal = free.reduce((sum, index) => sum + (result[index] ?? 0), 0)
    const budget = 1 - pinnedTotal

    // Every free column at zero: nothing to scale, so share the budget evenly
    // rather than dividing by zero.
    const scale = freeTotal > 0 ? budget / freeTotal : 0
    let pinnedAny = false

    for (const index of free) {
      const min = mins[index] ?? 0
      const scaled = freeTotal > 0 ? (result[index] ?? 0) * scale : budget / free.length
      if (scaled < min) {
        result[index] = min
        pinned.add(index)
        pinnedAny = true
      } else {
        result[index] = scaled
      }
    }

    if (!pinnedAny) break
  }

  return result
}

/**
 * Repairs whatever came back from the settings table (§M19 decision 11).
 *
 * The M13 / M14 / M18 lesson for the fourth time, and here the failure is not
 * cosmetic: a layout with an empty order renders a table with no columns at
 * all. A row written by a later build can name a fifth column, omit one this
 * build has, repeat one, or carry weights that sum to anything.
 */
export function normaliseLayout(value: unknown): ColumnLayout {
  if (typeof value !== 'object' || value === null) return DEFAULT_LAYOUT

  const raw = value as { order?: unknown; weights?: unknown }

  const order: ColumnId[] = []
  if (Array.isArray(raw.order)) {
    for (const id of raw.order) {
      // Unknown ids are dropped and repeats collapse: a duplicate would render
      // one column twice and lose another.
      if (isColumnId(id) && !order.includes(id)) order.push(id)
    }
  }
  // Anything this build knows about but the stored row did not, in registry
  // order — a downgrade shows the missing column rather than hiding it.
  for (const spec of COLUMNS) {
    if (!order.includes(spec.id)) order.push(spec.id)
  }

  const storedWeights =
    typeof raw.weights === 'object' && raw.weights !== null
      ? (raw.weights as Record<string, unknown>)
      : {}

  const values = order.map((id) => {
    const weight = storedWeights[id]
    return typeof weight === 'number' && Number.isFinite(weight) && weight > 0
      ? weight
      : columnSpec(id).defaultWeight
  })

  const balanced = balanceWeights(
    values,
    order.map((id) => columnSpec(id).minWeight),
  )

  const weights = {} as Record<ColumnId, number>
  order.forEach((id, index) => {
    weights[id] = balanced[index] ?? columnSpec(id).defaultWeight
  })

  return { order, weights }
}

/** Whether the layout is untouched — what greys out Reset Columns. */
export function isDefaultLayout(layout: ColumnLayout): boolean {
  if (layout.order.length !== DEFAULT_LAYOUT.order.length) return false
  if (layout.order.some((id, index) => DEFAULT_LAYOUT.order[index] !== id)) return false
  // Fractions come back from a resize as floats, so exact equality would leave
  // Reset enabled after a drag that landed back where it started.
  return layout.order.every(
    (id) => Math.abs(layout.weights[id] - DEFAULT_LAYOUT.weights[id]) < 0.001,
  )
}
