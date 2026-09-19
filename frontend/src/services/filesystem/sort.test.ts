import { describe, expect, it } from 'vitest'
import { DEFAULT_SORT, pinFirst, sortItems, type SortSpec } from './sort'
import type { FileTag } from '@/constants/tags'
import type { FileItem } from '@/types/file'
import { categorize } from '@/utils/fileCategory'
import { extname } from '@/utils/path'

function item(
  name: string,
  options: {
    dir?: boolean
    size?: number
    modified?: number
    created?: number
    tags?: FileTag[]
  } = {},
) {
  const isDirectory = options.dir ?? false
  const extension = isDirectory ? '' : extname(name)
  return {
    id: `/x/${name}`,
    path: `/x/${name}`,
    name,
    extension,
    size: options.size ?? 0,
    isDirectory,
    createdAt: options.created ?? 0,
    modifiedAt: options.modified ?? 0,
    permissions: '',
    hidden: false,
    symlink: false,
    mimeType: '',
    category: categorize(extension, isDirectory),
    broken: false,
    tags: options.tags ?? [],
  } satisfies FileItem
}

const names = (items: FileItem[]) => items.map((entry) => entry.name)

describe('sortItems', () => {
  it('puts folders first by default', () => {
    const input = [item('beta.txt'), item('Alpha', { dir: true }), item('alpha.txt')]
    expect(names(sortItems(input, DEFAULT_SORT))).toEqual(['Alpha', 'alpha.txt', 'beta.txt'])
  })

  it('can interleave folders when foldersFirst is off', () => {
    const spec: SortSpec = { ...DEFAULT_SORT, foldersFirst: false }
    const input = [item('beta.txt'), item('zeta', { dir: true }), item('alpha.txt')]
    expect(names(sortItems(input, spec))).toEqual(['alpha.txt', 'beta.txt', 'zeta'])
  })

  it('sorts names numerically, not lexically', () => {
    const input = [item('file 10.txt'), item('file 9.txt'), item('file 1.txt')]
    expect(names(sortItems(input, DEFAULT_SORT))).toEqual([
      'file 1.txt',
      'file 9.txt',
      'file 10.txt',
    ])
  })

  it('is case-insensitive', () => {
    const input = [item('banana.txt'), item('Apple.txt'), item('cherry.txt')]
    expect(names(sortItems(input, DEFAULT_SORT))).toEqual(['Apple.txt', 'banana.txt', 'cherry.txt'])
  })

  it('reverses on descending', () => {
    const spec: SortSpec = { ...DEFAULT_SORT, direction: 'desc' }
    const input = [item('a.txt'), item('b.txt'), item('c.txt')]
    expect(names(sortItems(input, spec))).toEqual(['c.txt', 'b.txt', 'a.txt'])
  })

  it('keeps folders on top even when descending', () => {
    const spec: SortSpec = { ...DEFAULT_SORT, direction: 'desc' }
    const input = [item('a.txt'), item('Zed', { dir: true })]
    expect(names(sortItems(input, spec))[0]).toBe('Zed')
  })

  it('sorts by size', () => {
    const spec: SortSpec = { key: 'size', direction: 'asc', foldersFirst: false }
    const input = [
      item('big', { size: 900 }),
      item('small', { size: 10 }),
      item('mid', { size: 100 }),
    ]
    expect(names(sortItems(input, spec))).toEqual(['small', 'mid', 'big'])
  })

  it('falls back to name between directories when sorting by size', () => {
    const spec: SortSpec = { key: 'size', direction: 'asc', foldersFirst: false }
    const input = [item('Zed', { dir: true }), item('Alpha', { dir: true })]
    expect(names(sortItems(input, spec))).toEqual(['Alpha', 'Zed'])
  })

  it('sorts by modification time', () => {
    const spec: SortSpec = { key: 'modified', direction: 'desc', foldersFirst: false }
    const input = [item('old', { modified: 1 }), item('new', { modified: 300 })]
    expect(names(sortItems(input, spec))).toEqual(['new', 'old'])
  })

  // §M22's two new keys.
  it('sorts by creation time, which is not modification time', () => {
    const spec: SortSpec = { key: 'created', direction: 'asc', foldersFirst: false }
    const input = [
      item('new', { created: 300, modified: 1 }),
      item('old', { created: 1, modified: 300 }),
    ]
    expect(names(sortItems(input, spec))).toEqual(['old', 'new'])
  })

  it('sorts by tag name, with untagged files at one end', () => {
    const spec: SortSpec = { key: 'tags', direction: 'asc', foldersFirst: false }
    const input = [
      item('work.txt', { tags: [{ name: 'Work', color: 4 }] }),
      item('plain.txt'),
      item('admin.txt', { tags: [{ name: 'Admin', color: 6 }] }),
    ]
    expect(names(sortItems(input, spec))).toEqual(['plain.txt', 'admin.txt', 'work.txt'])
  })

  // A set has no inherent order, so two files tagged the same way in different
  // orders have to compare equal — otherwise the listing would shuffle.
  it('treats a tag set as a set', () => {
    const spec: SortSpec = { key: 'tags', direction: 'asc', foldersFirst: false }
    const input = [
      item('b.txt', {
        tags: [
          { name: 'Work', color: 4 },
          { name: 'Admin', color: 6 },
        ],
      }),
      item('a.txt', {
        tags: [
          { name: 'Admin', color: 6 },
          { name: 'Work', color: 4 },
        ],
      }),
    ]
    // Tied on tags, so the name tiebreak decides — which is stability, not luck.
    expect(names(sortItems(input, spec))).toEqual(['a.txt', 'b.txt'])
  })

  it('groups by type then name', () => {
    const spec: SortSpec = { key: 'type', direction: 'asc', foldersFirst: false }
    const input = [item('b.txt'), item('a.zip'), item('a.txt')]
    expect(names(sortItems(input, spec))).toEqual(['a.txt', 'b.txt', 'a.zip'])
  })

  it('does not mutate the input array', () => {
    const input = [item('b.txt'), item('a.txt')]
    const snapshot = names(input)
    sortItems(input, DEFAULT_SORT)
    expect(names(input)).toEqual(snapshot)
  })
})

describe('pinFirst', () => {
  const listing = (...names: string[]): FileItem[] => names.map((name) => item(name))
  const namesOf = (items: FileItem[]) => items.map((entry) => entry.name)

  it('lifts the named items to the front, leaving the rest in order', () => {
    const items = listing('Annual.pdf', 'Budget.xlsx', 'Resume.pdf')

    expect(namesOf(pinFirst(items, ['/x/Resume.pdf']))).toEqual([
      'Resume.pdf',
      'Annual.pdf',
      'Budget.xlsx',
    ])
  })

  it('keeps pinned items in the order they arrived, not the sorted one', () => {
    const items = listing('Annual.pdf', 'Budget.xlsx', 'Resume.pdf')

    // A paste reports its files in the order it copied them; that is the order
    // they should read in, not the one the listing happens to be sorted by.
    const pinned = pinFirst(items, ['/x/Resume.pdf', '/x/Annual.pdf'])
    expect(namesOf(pinned)).toEqual(['Resume.pdf', 'Annual.pdf', 'Budget.xlsx'])
  })

  it('returns the same array when nothing matches', () => {
    const items = listing('Annual.pdf', 'Budget.xlsx')

    // Identity, not equality: a pane whose arrival landed in another folder
    // must not get a new array and re-render every row for it.
    expect(pinFirst(items, ['/x/Elsewhere.pdf'])).toBe(items)
    expect(pinFirst(items, [])).toBe(items)
  })

  it('ignores a path that is no longer in the listing', () => {
    const items = listing('Annual.pdf', 'Budget.xlsx')

    const pinned = pinFirst(items, ['/x/Gone.pdf', '/x/Budget.xlsx'])
    expect(namesOf(pinned)).toEqual(['Budget.xlsx', 'Annual.pdf'])
  })
})
