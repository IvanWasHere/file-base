import { describe, expect, it } from 'vitest'
import { findByPrefix, rangeBetween, rectFromPoints, rectsIntersect, stepIndex } from './selection'

const ORDERED = ['/a', '/b', '/c', '/d', '/e']

describe('rangeBetween', () => {
  it('selects downward inclusively', () => {
    expect(rangeBetween(ORDERED, '/b', '/d')).toEqual(['/b', '/c', '/d'])
  })

  it('selects upward inclusively', () => {
    expect(rangeBetween(ORDERED, '/d', '/b')).toEqual(['/b', '/c', '/d'])
  })

  it('handles anchor equal to target', () => {
    expect(rangeBetween(ORDERED, '/c', '/c')).toEqual(['/c'])
  })

  it('degrades to a single selection when the anchor is gone', () => {
    // The anchored item was deleted or filtered away; selecting nothing would
    // be worse than selecting what was actually clicked.
    expect(rangeBetween(ORDERED, '/missing', '/c')).toEqual(['/c'])
  })

  it('returns nothing when the target is gone', () => {
    expect(rangeBetween(ORDERED, '/a', '/missing')).toEqual([])
  })
})

describe('stepIndex', () => {
  it('moves within bounds', () => {
    expect(stepIndex(1, 1, 5)).toBe(2)
    expect(stepIndex(1, -1, 5)).toBe(0)
  })

  it('clamps rather than wrapping', () => {
    expect(stepIndex(4, 1, 5)).toBe(4)
    expect(stepIndex(0, -1, 5)).toBe(0)
  })

  it('starts at the first item when nothing is selected', () => {
    expect(stepIndex(-1, 1, 5)).toBe(0)
  })

  it('starts at the last item moving backwards from nothing', () => {
    expect(stepIndex(-1, -1, 5)).toBe(4)
  })

  it('moves a whole row when a stride is given', () => {
    expect(stepIndex(0, 1, 12, 4)).toBe(4)
    expect(stepIndex(9, -1, 12, 4)).toBe(5)
  })

  it('clamps a stride jump to the last item', () => {
    expect(stepIndex(10, 1, 12, 4)).toBe(11)
  })

  it('returns -1 for an empty list', () => {
    expect(stepIndex(0, 1, 0)).toBe(-1)
  })
})

describe('findByPrefix', () => {
  const names = ['Applications', 'Desktop', 'Documents', 'Downloads', 'Music']

  it('finds the next match after the current index', () => {
    expect(findByPrefix(names, 'd', 0)).toBe(1)
  })

  it('narrows with more characters', () => {
    expect(findByPrefix(names, 'doc', 0)).toBe(2)
  })

  it('is case-insensitive', () => {
    expect(findByPrefix(names, 'MUS', 0)).toBe(4)
  })

  it('cycles through matches on repeated presses', () => {
    expect(findByPrefix(names, 'd', 1)).toBe(2)
    expect(findByPrefix(names, 'd', 2)).toBe(3)
    // Wraps back to the first "D".
    expect(findByPrefix(names, 'd', 3)).toBe(1)
  })

  it('returns -1 when nothing matches', () => {
    expect(findByPrefix(names, 'zz', 0)).toBe(-1)
  })

  it('returns -1 for an empty query', () => {
    expect(findByPrefix(names, '', 0)).toBe(-1)
  })
})

describe('rect helpers', () => {
  it('normalises a drag in any direction', () => {
    expect(rectFromPoints(100, 80, 20, 10)).toEqual({
      left: 20,
      top: 10,
      right: 100,
      bottom: 80,
    })
  })

  it('detects overlap and separation', () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 }
    expect(rectsIntersect(a, { left: 5, top: 5, right: 15, bottom: 15 })).toBe(true)
    expect(rectsIntersect(a, { left: 20, top: 0, right: 30, bottom: 10 })).toBe(false)
    expect(rectsIntersect(a, { left: 0, top: 20, right: 10, bottom: 30 })).toBe(false)
  })

  it('counts edge contact as an intersection', () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 }
    expect(rectsIntersect(a, { left: 10, top: 10, right: 20, bottom: 20 })).toBe(true)
  })
})
