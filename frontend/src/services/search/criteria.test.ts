import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  buildCriteria,
  filterItems,
  hasActiveFilters,
  matches,
  parseExtensions,
  type SearchFilters,
} from './criteria'
import type { FileItem } from '@/types/file'

const NOW = Date.UTC(2025, 5, 15)
const DAY = 86_400_000

function item(name: string, overrides: Partial<FileItem> = {}): FileItem {
  const extension = name.includes('.') && !name.startsWith('.')
    ? (name.split('.').pop() ?? '').toLowerCase()
    : ''
  return {
    id: `/root/${name}`,
    path: `/root/${name}`,
    name,
    extension,
    size: 1000,
    isDirectory: false,
    createdAt: NOW,
    modifiedAt: NOW,
    permissions: '-rw-r--r--',
    hidden: name.startsWith('.'),
    symlink: false,
    mimeType: 'application/octet-stream',
    category: 'default',
    broken: false,
    ...overrides,
  }
}

const withFilters = (overrides: Partial<SearchFilters>): SearchFilters => ({
  ...DEFAULT_FILTERS,
  ...overrides,
})

describe('matches', () => {
  it('matches names case-insensitively, anywhere in the name', () => {
    expect(matches(item('Annual Report.pdf'), 'report', DEFAULT_FILTERS, NOW)).toBe(true)
    expect(matches(item('Annual Report.pdf'), 'REPORT', DEFAULT_FILTERS, NOW)).toBe(true)
    expect(matches(item('Annual Report.pdf'), 'budget', DEFAULT_FILTERS, NOW)).toBe(false)
  })

  it('filters by kind', () => {
    const folder = item('Work', { isDirectory: true, extension: '' })
    expect(matches(folder, '', withFilters({ kind: 'folder' }), NOW)).toBe(true)
    expect(matches(folder, '', withFilters({ kind: 'file' }), NOW)).toBe(false)
  })

  it('filters by extension', () => {
    const filters = withFilters({ extensions: ['pdf'] })
    expect(matches(item('a.pdf'), '', filters, NOW)).toBe(true)
    expect(matches(item('a.png'), '', filters, NOW)).toBe(false)
    // A folder has no extension, so an extension filter excludes folders.
    expect(matches(item('Work', { isDirectory: true }), '', filters, NOW)).toBe(false)
  })

  it('filters by size bucket', () => {
    const filters = withFilters({ size: 'medium' }) // 10 MB – 100 MB
    expect(matches(item('big.bin', { size: 50 * 1024 * 1024 }), '', filters, NOW)).toBe(true)
    expect(matches(item('small.bin', { size: 1000 }), '', filters, NOW)).toBe(false)
  })

  // Exempting folders from a size filter would mean asking for "over 1 GB"
  // hands back every folder in the tree — the opposite of narrowing.
  it('excludes directories from a size filter', () => {
    const folder = item('Work', { isDirectory: true, size: 96 })
    expect(matches(folder, '', withFilters({ size: 'huge' }), NOW)).toBe(false)
    // With no size filter, folders are unaffected.
    expect(matches(folder, '', DEFAULT_FILTERS, NOW)).toBe(true)
  })

  it('filters by modification window', () => {
    const filters = withFilters({ modified: 'week' })
    expect(matches(item('fresh.txt', { modifiedAt: NOW - 2 * DAY }), '', filters, NOW)).toBe(true)
    expect(matches(item('old.txt', { modifiedAt: NOW - 30 * DAY }), '', filters, NOW)).toBe(false)
  })

  it('combines criteria conjunctively', () => {
    const filters = withFilters({ extensions: ['pdf'], size: 'tiny' })
    expect(matches(item('report.pdf', { size: 500 }), 'report', filters, NOW)).toBe(true)
    // Right name and extension, wrong size.
    expect(matches(item('report.pdf', { size: 50_000_000 }), 'report', filters, NOW)).toBe(false)
  })
})

describe('filterItems', () => {
  it('returns everything when nothing is narrowing', () => {
    const items = [item('a.txt'), item('b.txt')]
    expect(filterItems(items, '   ', DEFAULT_FILTERS, NOW)).toHaveLength(2)
  })

  it('applies filters even with an empty query', () => {
    const items = [item('a.txt'), item('b.pdf')]
    const result = filterItems(items, '', withFilters({ extensions: ['pdf'] }), NOW)
    expect(result.map((entry) => entry.name)).toEqual(['b.pdf'])
  })
})

describe('hasActiveFilters', () => {
  it('is false for the defaults and true for any change', () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false)
    expect(hasActiveFilters(withFilters({ kind: 'file' }))).toBe(true)
    expect(hasActiveFilters(withFilters({ extensions: ['png'] }))).toBe(true)
    expect(hasActiveFilters(withFilters({ size: 'huge' }))).toBe(true)
    expect(hasActiveFilters(withFilters({ modified: 'today' }))).toBe(true)
    expect(hasActiveFilters(withFilters({ includeHidden: true }))).toBe(true)
  })
})

describe('parseExtensions', () => {
  it('accepts dots, commas, spaces and mixed case, without duplicates', () => {
    expect(parseExtensions('.PNG, jpg  gif,png')).toEqual(['png', 'jpg', 'gif'])
  })

  it('is empty for blank input', () => {
    expect(parseExtensions('   ')).toEqual([])
  })
})

describe('buildCriteria', () => {
  it('translates buckets into the bounds the backend expects', () => {
    const criteria = buildCriteria(
      '  report  ',
      '/root',
      withFilters({ size: 'tiny', modified: 'today' }),
      { now: NOW },
    )

    expect(criteria.query).toBe('report')
    expect(criteria.root).toBe('/root')
    expect(criteria.minSize).toBe(0)
    expect(criteria.maxSize).toBe(100 * 1024)
    expect(criteria.modifiedAfter).toBe(NOW - DAY)
    expect(criteria.modifiedBefore).toBe(0)
  })

  it('leaves bounds unset when nothing is filtered', () => {
    const criteria = buildCriteria('x', '/root', DEFAULT_FILTERS, { now: NOW })
    expect(criteria.minSize).toBe(0)
    expect(criteria.maxSize).toBe(0)
    expect(criteria.modifiedAfter).toBe(0)
  })
})
