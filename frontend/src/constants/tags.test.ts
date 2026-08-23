import { describe, expect, it } from 'vitest'
import {
  STOCK_TAGS,
  TAG_COLORS,
  hasTag,
  isTagColor,
  normaliseTags,
  tagColorSpec,
  tagKey,
  tagSortValue,
  toggleTag,
  type FileTag,
} from './tags'

describe('the palette', () => {
  it('covers all eight of Finder’s indices exactly once', () => {
    expect(TAG_COLORS.map((spec) => spec.color).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('recognises its own indices and nothing else', () => {
    for (const spec of TAG_COLORS) expect(isTagColor(spec.color)).toBe(true)
    expect(isTagColor(8)).toBe(false)
    expect(isTagColor(-1)).toBe(false)
    expect(isTagColor('red')).toBe(false)
    expect(isTagColor(undefined)).toBe(false)
  })

  // The stock seven are the coloured ones; "None" is a choice in the picker,
  // not a tag anybody starts with.
  it('offers the seven stock tags, all coloured', () => {
    expect(STOCK_TAGS).toHaveLength(7)
    expect(STOCK_TAGS.every((tag) => tag.color !== 0)).toBe(true)
    expect(STOCK_TAGS.map((tag) => tag.name)).toContain('Red')
  })

  it('resolves a spec for every index', () => {
    for (const spec of TAG_COLORS) expect(tagColorSpec(spec.color).label).toBe(spec.label)
  })
})

describe('tag identity', () => {
  // As in Finder: one tag, whichever way it was typed.
  it('is the name, case-insensitively and trimmed', () => {
    expect(tagKey({ name: '  Work ', color: 4 })).toBe(tagKey({ name: 'WORK', color: 6 }))
  })

  it('ignores the colour when asking whether a tag is present', () => {
    const tags: FileTag[] = [{ name: 'Work', color: 4 }]
    expect(hasTag(tags, { name: 'work', color: 6 })).toBe(true)
    expect(hasTag(tags, { name: 'Home', color: 4 })).toBe(false)
  })
})

describe('normaliseTags', () => {
  it('accepts what Go sends', () => {
    expect(normaliseTags([{ name: 'Work', color: 4 }])).toEqual([{ name: 'Work', color: 4 }])
  })

  // A nil Go slice arrives as null, and the attribute can hold anything at all.
  it('is empty for anything that is not a list of tags', () => {
    expect(normaliseTags(null)).toEqual([])
    expect(normaliseTags(undefined)).toEqual([])
    expect(normaliseTags('Work')).toEqual([])
    expect(normaliseTags([null, 42, 'Work'])).toEqual([])
  })

  it('drops blank names and trims the rest', () => {
    expect(
      normaliseTags([
        { name: '  ', color: 2 },
        { name: ' Work ', color: 4 },
      ]),
    ).toEqual([{ name: 'Work', color: 4 }])
  })

  it('collapses a repeated name, keeping the first spelling', () => {
    expect(
      normaliseTags([
        { name: 'Work', color: 4 },
        { name: 'work', color: 6 },
      ]),
    ).toEqual([{ name: 'Work', color: 4 }])
  })

  // An index outside the palette would paint nothing; 0 is a real "no colour".
  it('falls back to no colour for an index off the palette', () => {
    expect(normaliseTags([{ name: 'Odd', color: 42 }])).toEqual([{ name: 'Odd', color: 0 }])
    expect(normaliseTags([{ name: 'Odd', color: 'red' }])).toEqual([{ name: 'Odd', color: 0 }])
  })
})

describe('toggleTag', () => {
  const tags: FileTag[] = [{ name: 'Work', color: 4 }]

  it('adds a tag that is absent', () => {
    expect(toggleTag(tags, { name: 'Red', color: 6 })).toEqual([
      { name: 'Work', color: 4 },
      { name: 'Red', color: 6 },
    ])
  })

  it('removes a tag that is present, whatever colour was passed', () => {
    expect(toggleTag(tags, { name: 'work', color: 6 })).toEqual([])
  })
})

describe('tagSortValue', () => {
  // Ordering *sets* needs a total order; alphabetical by the names on screen is
  // the one that reads correctly (§M22 decision 6).
  it('orders by the names, independent of how they were stored', () => {
    const a = tagSortValue([
      { name: 'Work', color: 4 },
      { name: 'Admin', color: 6 },
    ])
    const b = tagSortValue([
      { name: 'Admin', color: 6 },
      { name: 'Work', color: 4 },
    ])
    expect(a).toBe(b)
  })

  it('sorts untagged files together at one end', () => {
    expect(tagSortValue([])).toBe('')
    expect(tagSortValue([{ name: 'Admin', color: 6 }]) > tagSortValue([])).toBe(true)
  })
})
