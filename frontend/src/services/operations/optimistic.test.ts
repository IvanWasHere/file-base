import { describe, expect, it } from 'vitest'
import {
  parentDirectories,
  placeholderItem,
  untakenName,
  withItem,
  withRenamed,
  withoutPaths,
} from './optimistic'
import type { FileItem } from '@/types/file'

function item(path: string, overrides: Partial<FileItem> = {}): FileItem {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return {
    id: path,
    path,
    name,
    extension: '',
    size: 0,
    isDirectory: false,
    createdAt: 0,
    modifiedAt: 0,
    permissions: '-rw-r--r--',
    hidden: false,
    symlink: false,
    mimeType: 'application/octet-stream',
    category: 'default',
    broken: false,
    tags: [],
    ...overrides,
  }
}

describe('withoutPaths', () => {
  it('removes exactly the listed entries', () => {
    const items = [item('/a/one.txt'), item('/a/two.txt'), item('/a/three.txt')]
    const result = withoutPaths(items, ['/a/two.txt'])
    expect(result.map((entry) => entry.name)).toEqual(['one.txt', 'three.txt'])
  })

  it('ignores paths that are not present', () => {
    const items = [item('/a/one.txt')]
    expect(withoutPaths(items, ['/a/ghost.txt'])).toHaveLength(1)
  })
})

describe('withItem', () => {
  it('appends a new entry', () => {
    const result = withItem([item('/a/one.txt')], item('/a/two.txt'))
    expect(result).toHaveLength(2)
  })

  it('replaces an entry at the same path rather than duplicating it', () => {
    const result = withItem([item('/a/one.txt', { size: 5 })], item('/a/one.txt', { size: 9 }))
    expect(result).toHaveLength(1)
    expect(result[0]?.size).toBe(9)
  })
})

describe('withRenamed', () => {
  it('re-points path, id, name, extension and category together', () => {
    const items = [item('/a/notes.txt', { extension: 'txt', category: 'document' })]
    const [renamed] = withRenamed(items, '/a/notes.txt', '/a/photo.png')

    expect(renamed?.path).toBe('/a/photo.png')
    expect(renamed?.id).toBe('/a/photo.png')
    expect(renamed?.name).toBe('photo.png')
    // The category is derived, so it has to follow the extension or the icon
    // would keep showing the old file type until the next read.
    expect(renamed?.extension).toBe('png')
    expect(renamed?.category).toBe('image')
  })

  it('leaves a directory without an extension', () => {
    const items = [item('/a/Work', { isDirectory: true, category: 'folder' })]
    const [renamed] = withRenamed(items, '/a/Work', '/a/Work.old')
    expect(renamed?.extension).toBe('')
    expect(renamed?.category).toBe('folder')
  })

  it('leaves other entries untouched', () => {
    const items = [item('/a/one.txt'), item('/a/two.txt')]
    const result = withRenamed(items, '/a/one.txt', '/a/renamed.txt')
    expect(result[1]).toBe(items[1])
  })
})

describe('placeholderItem', () => {
  it('describes a folder that does not exist yet', () => {
    const placeholder = placeholderItem('/Users/dev', 'untitled folder', true)
    expect(placeholder.path).toBe('/Users/dev/untitled folder')
    expect(placeholder.isDirectory).toBe(true)
    expect(placeholder.category).toBe('folder')
    expect(placeholder.size).toBe(0)
  })

  it('flags a dot-name as hidden so it obeys the show-hidden setting', () => {
    expect(placeholderItem('/Users/dev', '.env', false).hidden).toBe(true)
  })
})

describe('parentDirectories', () => {
  it('collapses to the distinct parents', () => {
    expect(parentDirectories(['/a/one.txt', '/a/two.txt', '/b/three.txt'])).toEqual(['/a', '/b'])
  })
})

describe('untakenName', () => {
  it('returns the base when it is free', () => {
    expect(untakenName([], 'untitled folder')).toBe('untitled folder')
  })

  it('counts up past existing names', () => {
    const items = [item('/a/untitled folder'), item('/a/untitled folder 2')]
    expect(untakenName(items, 'untitled folder')).toBe('untitled folder 3')
  })
})
