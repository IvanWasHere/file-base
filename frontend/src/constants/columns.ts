/**
 * The detail view's columns, as data (PLAN.md §M19, extended in §M22).
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
 *
 * §M22 adds two columns and, with them, the idea that a column can be *off*.
 * The layout therefore carries a `hidden` list rather than the registry
 * carrying the answer: which columns a user wants is a setting, and the
 * registry has to keep describing every column the build knows how to draw so
 * the Settings modal can offer the ones that are off (decision 1).
 */

import type { SortKey } from '@/services/filesystem/sort'

export type ColumnId = 'name' | 'size' | 'type' | 'modified' | 'created' | 'tags'

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
  /**
   * Whether a fresh install shows it — and, just as importantly, what happens
   * to a column added by a *later* build: one that is off by default stays off
   * for an existing user rather than appearing unbidden in their layout
   * (§M22 decision 2).
   */
  defaultVisible: boolean
  /**
   * A column that cannot be switched off. Only Name: a row that shows a file's
   * size and nothing else is not a listing, and offering the checkbox that
   * produces it would be offering a broken state.
   */
  required?: boolean
}

/**
 * Registry order, which is also the default layout order and the order missing
 * columns are appended in when a stored layout is repaired.
 *
 * The weights are the `2fr 1fr 1fr 1fr` the view was hard-coded to before this
 * milestone, written as fractions.
 */
export const COLUMNS: ColumnSpec[] = [
  {
    id: 'name',
    label: 'Name',
    sortKey: 'name',
    defaultWeight: 0.4,
    minWeight: 0.15,
    defaultVisible: true,
    required: true,
  },
  {
    id: 'size',
    label: 'Size',
    sortKey: 'size',
    defaultWeight: 0.2,
    minWeight: 0.08,
    defaultVisible: true,
  },
  {
    id: 'type',
    label: 'Type',
    sortKey: 'type',
    defaultWeight: 0.2,
    minWeight: 0.08,
    defaultVisible: true,
  },
  {
    id: 'modified',
    label: 'Modified',
    sortKey: 'modified',
    defaultWeight: 0.2,
    minWeight: 0.08,
    defaultVisible: true,
  },
  // Off by default, both of them: the four above are the layout every existing
  // user already has, and §M22 is about being able to ask for more, not about
  // rearranging everyone's window on upgrade.
  {
    id: 'created',
    label: 'Created',
    sortKey: 'created',
    defaultWeight: 0.2,
    minWeight: 0.08,
    defaultVisible: false,
  },
  {
    id: 'tags',
    label: 'Tags',
    sortKey: 'tags',
    defaultWeight: 0.2,
    minWeight: 0.08,
    defaultVisible: false,
  },
]

/**
 * A layout: the order columns appear in, and how wide each one is.
 *
 * Weights are keyed by id rather than parallel to `order`, so moving a column
 * cannot desynchronise a column from its width — the bug two parallel arrays
 * invite on the first reorder.
 */
export interface ColumnLayout {
  /** Every column the build knows about, in display order — hidden ones too. */
  order: ColumnId[]
  weights: Record<ColumnId, number>
  /**
   * The columns that are switched off (§M22).
   *
   * A hidden list rather than a visible one, so `order` stays the complete
   * roster: a column keeps its place in the order while it is off, and
   * switching it back on returns it to where it was rather than to the end.
   * Its weight is kept in `weights` for the same reason.
   */
  hidden: ColumnId[]
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
  hidden: COLUMNS.filter((spec) => !spec.defaultVisible).map((spec) => spec.id),
}

/**
 * The columns actually drawn, in order.
 *
 * Everything downstream — the grid template, the resize weights, the header,
 * the cells a row renders — is written against *this* list rather than
 * `order`, which is why a hidden column costs the view nothing beyond not
 * being in it.
 */
export function visibleColumns(layout: ColumnLayout): ColumnId[] {
  return layout.order.filter((id) => !layout.hidden.includes(id))
}

export function isColumnVisible(layout: ColumnLayout, id: ColumnId): boolean {
  return !layout.hidden.includes(id)
}

/**
 * Switches a column on or off, rebalancing the ones that remain.
 *
 * The weights of the visible set have to sum to 1, so turning a column off
 * hands its share to its neighbours and turning one on takes a share back
 * (`balanceWeights` does both, and honours every floor while doing it). A
 * required column refuses to be hidden here rather than being defended only by
 * a disabled checkbox: the store is what the layout is repaired against.
 */
export function setColumnVisible(
  layout: ColumnLayout,
  id: ColumnId,
  visible: boolean,
): ColumnLayout {
  if (visible === isColumnVisible(layout, id)) return layout
  if (!visible && columnSpec(id).required) return layout

  const hidden = visible ? layout.hidden.filter((entry) => entry !== id) : [...layout.hidden, id]
  const next: ColumnLayout = { order: layout.order, weights: layout.weights, hidden }

  // A column coming back has been sitting at whatever width it had when it
  // left, which no longer sums with anything; balancing is what makes the row
  // add up again.
  const order = visibleColumns(next)
  const balanced = balanceWeights(
    order.map((entry) => next.weights[entry] ?? columnSpec(entry).defaultWeight),
    order.map((entry) => columnSpec(entry).minWeight),
  )

  const weights = { ...next.weights }
  order.forEach((entry, index) => {
    weights[entry] = balanced[index] ?? columnSpec(entry).defaultWeight
  })

  return { order: layout.order, weights, hidden }
}

/** The weights of the visible columns, as the array `useSplitResize` works in. */
export function weightsOf(layout: ColumnLayout): number[] {
  return visibleColumns(layout).map((id) => layout.weights[id])
}

/**
 * A layout with the same order and new weights, positional to the *visible*
 * columns — which is what the resize handles between them produce.
 */
export function withWeights(layout: ColumnLayout, weights: number[]): ColumnLayout {
  const next = { ...layout.weights }
  visibleColumns(layout).forEach((id, index) => {
    const weight = weights[index]
    if (weight !== undefined) next[id] = weight
  })
  return { order: layout.order, weights: next, hidden: layout.hidden }
}

/** The floors of the visible columns, in the same positional form. */
export function minWeightsOf(layout: ColumnLayout): number[] {
  return visibleColumns(layout).map((id) => columnSpec(id).minWeight)
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
  return visibleColumns(layout)
    .map((id) => `minmax(0, ${Number(layout.weights[id].toFixed(4))}fr)`)
    .join(' ')
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
 * The same move, expressed in the indices the header actually has (§M22).
 *
 * A drag reports "the third header onto the first", and with a column switched
 * off the third header is not the third entry in `order`. Translating through
 * ids rather than arithmetic keeps the hidden columns anchored where they were:
 * the moved column lands beside the one it was dropped on, and nothing else
 * shifts.
 */
export function moveVisibleColumn(layout: ColumnLayout, from: number, to: number): ColumnId[] {
  const visible = visibleColumns(layout)
  const moved = visible[from]
  const target = visible[Math.min(Math.max(to, 0), visible.length - 1)]
  if (!moved || !target) return layout.order

  return moveColumn(layout.order, layout.order.indexOf(moved), layout.order.indexOf(target))
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
  //
  // Since §M22 "shows" is qualified by the spec: a column the stored layout had
  // never heard of is added *off* unless it is one a fresh install would show.
  // That is the entire upgrade path for the two columns this milestone adds —
  // an existing user's four-column layout stays four columns until they ask
  // for more (decision 2).
  const introduced: ColumnId[] = []
  for (const spec of COLUMNS) {
    if (!order.includes(spec.id)) {
      order.push(spec.id)
      introduced.push(spec.id)
    }
  }

  const hidden: ColumnId[] = []
  const storedHidden = Array.isArray((raw as { hidden?: unknown }).hidden)
    ? (raw as { hidden: unknown[] }).hidden
    : []
  for (const id of storedHidden) {
    // A required column is never hidden, however the row got that way: the
    // alternative is a listing with no Name column and no way back to one.
    if (isColumnId(id) && !hidden.includes(id) && !columnSpec(id).required) hidden.push(id)
  }
  for (const id of introduced) {
    if (!columnSpec(id).defaultVisible && !hidden.includes(id)) hidden.push(id)
  }

  const storedWeights =
    typeof raw.weights === 'object' && raw.weights !== null
      ? (raw.weights as Record<string, unknown>)
      : {}

  const weights = {} as Record<ColumnId, number>
  for (const id of order) {
    const weight = storedWeights[id]
    weights[id] =
      typeof weight === 'number' && Number.isFinite(weight) && weight > 0
        ? weight
        : columnSpec(id).defaultWeight
  }

  // Balanced over the visible columns only — they are the ones that have to
  // tile the pane. A hidden column keeps whatever width it had, which is what
  // it gets back if it is switched on again.
  const visible = order.filter((id) => !hidden.includes(id))
  const balanced = balanceWeights(
    visible.map((id) => weights[id]),
    visible.map((id) => columnSpec(id).minWeight),
  )
  visible.forEach((id, index) => {
    weights[id] = balanced[index] ?? columnSpec(id).defaultWeight
  })

  return { order, weights, hidden }
}

/** Whether the layout is untouched — what greys out Reset Columns. */
export function isDefaultLayout(layout: ColumnLayout): boolean {
  if (layout.order.length !== DEFAULT_LAYOUT.order.length) return false
  if (layout.order.some((id, index) => DEFAULT_LAYOUT.order[index] !== id)) return false
  // Which columns are on counts as part of the layout since §M22, so Reset
  // Columns is offered to someone who only turned Tags on — that *is* the
  // change they would want undone.
  if (layout.hidden.length !== DEFAULT_LAYOUT.hidden.length) return false
  if (layout.hidden.some((id) => !DEFAULT_LAYOUT.hidden.includes(id))) return false
  // Fractions come back from a resize as floats, so exact equality would leave
  // Reset enabled after a drag that landed back where it started. Hidden
  // columns are exempt: their width is not on screen to be wrong.
  return visibleColumns(layout).every(
    (id) => Math.abs(layout.weights[id] - DEFAULT_LAYOUT.weights[id]) < 0.001,
  )
}
