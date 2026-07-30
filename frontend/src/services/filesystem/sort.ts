/**
 * Sorting lives in TypeScript (PRD: "No sorting" in Go). Go returns entries in
 * byte order; every ordering the user sees is applied here.
 *
 * M1 provides the mechanism; M4 wires it to column headers and persists the
 * choice per folder.
 */

import type { FileItem } from '@/types/file'

export type SortKey = 'name' | 'modified' | 'size' | 'type'
export type SortDirection = 'asc' | 'desc'

export interface SortSpec {
  key: SortKey
  direction: SortDirection
  /** Finder's default: directories cluster above files regardless of the key. */
  foldersFirst: boolean
}

export const DEFAULT_SORT: SortSpec = { key: 'name', direction: 'asc', foldersFirst: true }

// `numeric` so "file 10" sorts after "file 9"; `sensitivity: base` so casing
// does not split otherwise-identical names.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compareBy(key: SortKey, a: FileItem, b: FileItem): number {
  switch (key) {
    case 'name':
      return collator.compare(a.name, b.name)
    case 'modified':
      return a.modifiedAt - b.modifiedAt
    case 'size':
      // Directory size is meaningless without a recursive walk, so fall back to
      // name rather than showing an arbitrary order.
      if (a.isDirectory && b.isDirectory) return collator.compare(a.name, b.name)
      return a.size - b.size
    case 'type':
      return collator.compare(a.extension, b.extension) || collator.compare(a.name, b.name)
  }
}

/** Returns a new array; never mutates the query cache's data. */
export function sortItems(items: readonly FileItem[], spec: SortSpec): FileItem[] {
  const sign = spec.direction === 'asc' ? 1 : -1

  return [...items].sort((a, b) => {
    if (spec.foldersFirst && a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1
    }
    const result = compareBy(spec.key, a, b)
    // Ties broken by name so the order is stable across re-sorts.
    return result === 0 ? collator.compare(a.name, b.name) : result * sign
  })
}
