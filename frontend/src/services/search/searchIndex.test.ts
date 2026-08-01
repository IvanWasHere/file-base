/**
 * The index layer.
 *
 * The mock bridge runs sql.js, which has no FTS5 — the same situation as a
 * user's machine if the driver ever lost it. So these cover the two things that
 * matter regardless: the query construction (pure), and that every entry point
 * degrades to "no index" instead of throwing.
 *
 * The FTS5 behaviour itself is pinned on the Go side by TestFTS5IsAvailable,
 * which is where it has to work.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetIndexAvailability,
  buildMatchExpression,
  indexAvailable,
  isIndexed,
  listIndexedRoots,
  queryIndex,
  readIndexRecord,
} from './searchIndex'
import { migrate } from '@/services/db/migrate'
import { buildCriteria } from './criteria'
import { DEFAULT_FILTERS } from './criteria'

beforeEach(() => {
  __resetIndexAvailability()
})

describe('buildMatchExpression', () => {
  it('makes every word a prefix term against the name column', () => {
    expect(buildMatchExpression('annual rep')).toBe('name:"annual"* AND name:"rep"*')
  })

  it('is null when there is nothing to match', () => {
    expect(buildMatchExpression('   ')).toBeNull()
    expect(buildMatchExpression('')).toBeNull()
  })

  // Someone typing `report OR draft` is naming a file, not writing a query
  // language; unquoted, FTS5 would read the operators and probably error.
  it('neutralises FTS5 operators and quotes', () => {
    expect(buildMatchExpression('report OR draft')).toBe('name:"report"* AND name:"OR"* AND name:"draft"*')
    expect(buildMatchExpression('say "hi"')).toBe('name:"say"* AND name:"hi"*')
    expect(buildMatchExpression('a* b')).toBe('name:"a*"* AND name:"b"*')
  })
})

describe('without FTS5', () => {
  it('reports the index as unavailable rather than throwing', async () => {
    expect(await indexAvailable()).toBe(false)
  })

  // Every one of these is on the path of a keystroke in the search box. A throw
  // here would surface as a broken search rather than a missing accelerator.
  it('degrades quietly on every read path', async () => {
    await migrate()

    expect(await readIndexRecord('/Users/dev')).toBeNull()
    expect(await listIndexedRoots()).toEqual([])
    expect(await isIndexed('/Users/dev')).toBe(false)

    const criteria = buildCriteria('notes', '/Users/dev', DEFAULT_FILTERS)
    // null is the caller's signal to walk instead.
    expect(await queryIndex('/Users/dev', criteria)).toBeNull()
  })

  it('caches the availability probe', async () => {
    expect(await indexAvailable()).toBe(false)
    expect(await indexAvailable()).toBe(false)
  })
})

describe('migration', () => {
  it('creates index_meta without needing FTS5', async () => {
    const result = await migrate()
    expect(result.applied.join(',')).toContain('search_index')

    // The plain table is usable even where the virtual one cannot exist.
    const { bridge } = await import('@/services/bridge')
    await bridge.db.exec(
      "insert into index_meta (root, indexed_at, status, entries) values ('/x', 1, 'ready', 3)",
    )
    const rows = await bridge.db.query<{ root: string }>('select root from index_meta')
    expect(rows[0]?.root).toBe('/x')
  })
})
