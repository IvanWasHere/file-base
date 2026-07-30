/**
 * Pure selection maths, kept out of the store so it can be tested directly and
 * reused by both the pointer and keyboard paths (PRD: "No duplicated business
 * logic").
 *
 * `ordered` is always the list *as displayed* — sorted and filtered — because a
 * Shift-range means "everything between these two rows on screen", not
 * everything between them on disk.
 */

/** Inclusive range between two paths, in display order. */
export function rangeBetween(ordered: readonly string[], anchor: string, target: string): string[] {
  const from = ordered.indexOf(anchor)
  const to = ordered.indexOf(target)

  // A missing anchor (its item was deleted or filtered away) degrades to a
  // single selection rather than selecting nothing.
  if (from === -1 || to === -1) return to === -1 ? [] : [target]

  const [start, end] = from <= to ? [from, to] : [to, from]
  return ordered.slice(start, end + 1)
}

/** Index to move to for an arrow key, clamped to the list. */
export function stepIndex(
  current: number,
  delta: number,
  count: number,
  /** Grid views move by a whole row; lists move by one. */
  stride = 1,
): number {
  if (count === 0) return -1
  if (current < 0) return delta > 0 ? 0 : count - 1
  return Math.min(Math.max(current + delta * stride, 0), count - 1)
}

/**
 * Type-ahead: the next item starting with `query`, searching after `fromIndex`
 * and wrapping. Matches Finder — typing "de" jumps to "Desktop".
 */
export function findByPrefix(names: readonly string[], query: string, fromIndex: number): number {
  if (!query) return -1
  const needle = query.toLowerCase()

  for (let offset = 1; offset <= names.length; offset += 1) {
    const index = (fromIndex + offset) % names.length
    if (names[index]?.toLowerCase().startsWith(needle)) return index
  }
  return -1
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
}

/** Normalises a drag (which may run in any direction) into a rectangle. */
export function rectFromPoints(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  }
}
