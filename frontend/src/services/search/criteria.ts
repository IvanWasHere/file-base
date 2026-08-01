/**
 * Search criteria: what the user is asking for, and the one place it is
 * interpreted.
 *
 * The same filters serve both modes. Filtering the current folder is a pure
 * predicate over the listing already in the query cache — instant, no round
 * trip. Searching subfolders sends the identical criteria to Go, which applies
 * them during the walk. Sharing this module is what keeps the two from
 * disagreeing about what "larger than 1 MB" means.
 *
 * Sizes and dates are buckets rather than free numbers. "Larger than 1 MB" is a
 * question people actually ask; "larger than 1048576 bytes" is a form to fill
 * in, and it would need validation, units and error states to earn its place.
 */

import type { FileItem, SearchCriteria } from '@/types/file'

export type SizeBucket = 'any' | 'tiny' | 'small' | 'medium' | 'large' | 'huge'
export type DateBucket = 'any' | 'today' | 'week' | 'month' | 'year'
export type KindFilter = 'any' | 'file' | 'folder'

export interface SearchFilters {
  kind: KindFilter
  /** Lowercase, without the dot. Empty means any. */
  extensions: string[]
  size: SizeBucket
  modified: DateBucket
  includeHidden: boolean
}

export const DEFAULT_FILTERS: SearchFilters = {
  kind: 'any',
  extensions: [],
  size: 'any',
  modified: 'any',
  includeHidden: false,
}

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

/** `[min, max]` in bytes; 0 means unbounded on that end. */
const SIZE_RANGES: Record<SizeBucket, [number, number]> = {
  any: [0, 0],
  tiny: [0, 100 * KB],
  small: [100 * KB, 10 * MB],
  medium: [10 * MB, 100 * MB],
  large: [100 * MB, GB],
  huge: [GB, 0],
}

export const SIZE_LABELS: Record<SizeBucket, string> = {
  any: 'Any size',
  tiny: 'Under 100 KB',
  small: '100 KB – 10 MB',
  medium: '10 MB – 100 MB',
  large: '100 MB – 1 GB',
  huge: 'Over 1 GB',
}

const DAY = 86_400_000

const DATE_WINDOWS: Record<DateBucket, number> = {
  any: 0,
  today: DAY,
  week: 7 * DAY,
  month: 30 * DAY,
  year: 365 * DAY,
}

export const DATE_LABELS: Record<DateBucket, string> = {
  any: 'Any time',
  today: 'Past 24 hours',
  week: 'Past week',
  month: 'Past month',
  year: 'Past year',
}

/** True when anything beyond the plain text query is narrowing the results. */
export function hasActiveFilters(filters: SearchFilters): boolean {
  return (
    filters.kind !== 'any' ||
    filters.extensions.length > 0 ||
    filters.size !== 'any' ||
    filters.modified !== 'any' ||
    filters.includeHidden
  )
}

/** Splits a typed extension list — "png, jpg .gif" — into normalised entries. */
export function parseExtensions(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\s,]+/)
        .map((entry) => entry.replace(/^\./, '').toLowerCase().trim())
        .filter(Boolean),
    ),
  ]
}

/**
 * Builds the criteria sent to the backend.
 *
 * `now` is a parameter rather than a call to the clock so date buckets are
 * testable, following the convention in services/db/persistence.
 */
export function buildCriteria(
  query: string,
  root: string,
  filters: SearchFilters,
  options: { maxResults?: number; now?: number } = {},
): SearchCriteria {
  const [minSize, maxSize] = SIZE_RANGES[filters.size]
  const window = DATE_WINDOWS[filters.modified]
  const now = options.now ?? Date.now()

  return {
    query: query.trim(),
    root,
    extensions: filters.extensions,
    kind: filters.kind,
    minSize,
    maxSize,
    modifiedAfter: window > 0 ? now - window : 0,
    modifiedBefore: 0,
    includeHidden: filters.includeHidden,
    maxResults: options.maxResults ?? 0,
  }
}

/**
 * The predicate behind the current-folder filter.
 *
 * Mirrors `compile` in backend/search, including the details that are easy to
 * get subtly different: matching is case-insensitive, and a size filter
 * excludes directories outright.
 */
export function matches(
  item: FileItem,
  query: string,
  filters: SearchFilters,
  now: number = Date.now(),
): boolean {
  const needle = query.trim().toLowerCase()
  if (needle && !item.name.toLowerCase().includes(needle)) return false

  if (filters.kind === 'file' && item.isDirectory) return false
  if (filters.kind === 'folder' && !item.isDirectory) return false

  if (filters.extensions.length > 0) {
    if (item.isDirectory || !filters.extensions.includes(item.extension)) return false
  }

  // A size filter excludes directories rather than exempting them: a folder's
  // reported size is its own inode, so comparing it is meaningless, and letting
  // folders through unfiltered would mean asking for "over 1 GB" returns every
  // folder in the listing.
  const [minSize, maxSize] = SIZE_RANGES[filters.size]
  if (minSize > 0 || maxSize > 0) {
    if (item.isDirectory) return false
    if (minSize > 0 && item.size < minSize) return false
    if (maxSize > 0 && item.size > maxSize) return false
  }

  const window = DATE_WINDOWS[filters.modified]
  if (window > 0 && item.modifiedAt < now - window) return false

  return true
}

/** Applies `matches` across a listing. */
export function filterItems(
  items: readonly FileItem[],
  query: string,
  filters: SearchFilters,
  now: number = Date.now(),
): FileItem[] {
  if (!query.trim() && !hasActiveFilters(filters)) return [...items]
  return items.filter((item) => matches(item, query, filters, now))
}
