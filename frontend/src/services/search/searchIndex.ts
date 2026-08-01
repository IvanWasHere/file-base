/**
 * FTS5-backed instant search for indexed roots (PLAN.md M8).
 *
 * The index is an accelerator, never a source of truth. It answers "which paths
 * might match" in milliseconds; every hit is then re-stat'd through the bridge,
 * so an entry deleted since the index was built simply drops out rather than
 * appearing as a phantom row. That is what makes a stale index safe to use.
 *
 * Availability is discovered, not assumed. FTS5 is a compile-time SQLite
 * option: the Go driver has it, the sql.js build behind the mock bridge does
 * not. Everything here degrades to "unavailable", and the caller falls back to
 * a live walk — which is why indexing is an optimisation the app can lose
 * without losing search.
 */

import { bridge } from '@/services/bridge'
import type { FileItem, SearchCriteria } from '@/types/file'

/** Rows written per transaction while building. */
const INSERT_BATCH = 500

/** Hits fetched from the index before stat'ing. */
const QUERY_LIMIT = 1000

export type IndexStatus = 'building' | 'ready' | 'failed'

export interface IndexRecord {
  root: string
  indexedAt: number
  status: IndexStatus
  entries: number
}

/**
 * Cached per session: the answer cannot change while the process runs, and the
 * question is asked on every keystroke of a recursive search.
 */
let available: boolean | null = null

/**
 * Creates the virtual table if it is missing, and reports whether FTS5 works
 * at all.
 */
export async function indexAvailable(): Promise<boolean> {
  if (available !== null) return available

  try {
    await bridge.db.exec(
      `create virtual table if not exists search_index
       using fts5(path, name, ext, tokenize='unicode61')`,
    )
    available = true
  } catch {
    // No FTS5 in this build. Not an error the user should ever see: search
    // still works, it just walks.
    available = false
  }
  return available
}

/**
 * Builds the FTS5 MATCH expression for a user's words.
 *
 * Each word becomes a quoted prefix term against the `name` column, ANDed
 * together, so "annual rep" finds "Annual Report 2024.pdf". Quoting is what
 * keeps FTS5 operators — `AND`, `NEAR`, `*`, `"` — from being interpreted:
 * a user typing `report OR draft` is searching for a filename, not writing a
 * query language.
 *
 * Returns null when there is nothing to match on, which is the caller's signal
 * that the index cannot answer and a walk is needed.
 */
export function buildMatchExpression(query: string): string | null {
  const words = query
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/"/g, ''))
    .filter(Boolean)

  if (words.length === 0) return null
  return words.map((word) => `name:"${word}"*`).join(' AND ')
}

/** A GLOB pattern matching everything at or under a root. */
function subtreePattern(root: string): string {
  return root.endsWith('/') ? `${root}*` : `${root}/*`
}

export async function readIndexRecord(root: string): Promise<IndexRecord | null> {
  if (!(await indexAvailable())) return null

  const rows = await bridge.db.query<{
    root: string
    indexed_at: number
    status: string
    entries: number
  }>('select root, indexed_at, status, entries from index_meta where root = ?', [root])

  const row = rows[0]
  if (!row) return null
  return {
    root: row.root,
    indexedAt: Number(row.indexed_at),
    status: row.status as IndexStatus,
    entries: Number(row.entries),
  }
}

/** Every indexed root, newest first — what the settings and search UI list. */
export async function listIndexedRoots(): Promise<IndexRecord[]> {
  if (!(await indexAvailable())) return []

  const rows = await bridge.db.query<{
    root: string
    indexed_at: number
    status: string
    entries: number
  }>('select root, indexed_at, status, entries from index_meta order by indexed_at desc')

  return rows.map((row) => ({
    root: row.root,
    indexedAt: Number(row.indexed_at),
    status: row.status as IndexStatus,
    entries: Number(row.entries),
  }))
}

/** True when this root can answer instantly right now. */
export async function isIndexed(root: string): Promise<boolean> {
  const record = await readIndexRecord(root)
  return record?.status === 'ready'
}

export interface IndexProgress {
  indexed: number
  scanned: number
}

/**
 * Builds (or rebuilds) the index for a root.
 *
 * The walk is the same streaming search the UI uses, run with an empty query so
 * everything matches — reusing it means indexing cannot drift from searching in
 * what it considers a hidden file or a followable link.
 */
export async function indexRoot(
  root: string,
  options: { includeHidden?: boolean; onProgress?: (progress: IndexProgress) => void } = {},
): Promise<IndexRecord> {
  if (!(await indexAvailable())) {
    throw new Error('This build of SQLite has no full-text search.')
  }

  const now = Date.now()
  await bridge.db.exec(
    `insert into index_meta (root, indexed_at, status, entries) values (?, ?, 'building', 0)
     on conflict(root) do update set indexed_at = excluded.indexed_at, status = 'building'`,
    [root, now],
  )
  // Stale rows go before the new ones arrive, so a failed rebuild leaves an
  // empty index rather than a mixture of two generations.
  await bridge.db.exec('delete from search_index where path glob ?', [subtreePattern(root)])

  let indexed = 0
  let scanned = 0
  let pending: FileItem[] = []

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return
    const batch = pending
    pending = []
    await bridge.db.transaction(
      batch.map((item) => ({
        sql: 'insert into search_index (path, name, ext) values (?, ?, ?)',
        args: [item.path, item.name, item.extension],
      })),
    )
    indexed += batch.length
    options.onProgress?.({ indexed, scanned })
  }

  try {
    await new Promise<void>((resolve, reject) => {
      let searchId: string | null = null
      const queue: Promise<void>[] = []

      const unsubscribe = bridge.search.subscribe({
        onBatch: (batch) => {
          if (batch.id !== searchId) return
          scanned = batch.scanned
          pending.push(...batch.items)
          if (pending.length >= INSERT_BATCH) queue.push(flush())
        },
        onDone: (done) => {
          if (done.id !== searchId) return
          unsubscribe()
          // Writes are queued rather than awaited inside the callback, so the
          // event stream is never blocked on SQLite; they are drained here.
          void Promise.all(queue)
            .then(() => flush())
            .then(() => (done.error ? reject(new Error(done.error)) : resolve()))
            .catch(reject)
        },
      })

      const criteria: SearchCriteria = {
        query: '',
        root,
        extensions: [],
        kind: 'any',
        minSize: 0,
        maxSize: 0,
        modifiedAfter: 0,
        modifiedBefore: 0,
        includeHidden: options.includeHidden ?? false,
        // No cap: an index that stopped at 5000 entries would answer
        // confidently and wrongly.
        maxResults: Number.MAX_SAFE_INTEGER,
      }

      bridge.search.find(criteria).then(
        (id) => {
          searchId = id
        },
        (error: unknown) => {
          unsubscribe()
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })
  } catch (error) {
    await bridge.db.exec('update index_meta set status = ? where root = ?', ['failed', root])
    throw error
  }

  const finishedAt = Date.now()
  await bridge.db.exec(
    'update index_meta set status = ?, entries = ?, indexed_at = ? where root = ?',
    ['ready', indexed, finishedAt, root],
  )

  return { root, indexedAt: finishedAt, status: 'ready', entries: indexed }
}

export async function dropIndex(root: string): Promise<void> {
  if (!(await indexAvailable())) return
  await bridge.db.exec('delete from search_index where path glob ?', [subtreePattern(root)])
  await bridge.db.exec('delete from index_meta where root = ?', [root])
}

/**
 * Answers from the index.
 *
 * Returns null when the index cannot answer — no FTS5, root not indexed, or a
 * query with no words to match — which tells the caller to walk instead.
 */
export async function queryIndex(
  root: string,
  criteria: SearchCriteria,
): Promise<FileItem[] | null> {
  const expression = buildMatchExpression(criteria.query)
  if (!expression) return null
  if (!(await isIndexed(root))) return null

  const rows = await bridge.db.query<{ path: string }>(
    `select path from search_index
     where search_index match ? and path glob ?
     limit ?`,
    [expression, subtreePattern(root), QUERY_LIMIT],
  )

  // Re-stat every hit: the index records what was true when it was built, and
  // anything deleted since must not appear. This is also where the criteria the
  // index cannot express — size, date, kind — are applied.
  return bridge.fs.readFileInfos(rows.map((row) => row.path))
}

/** Test hook: forgets the cached FTS5 availability probe. */
export function __resetIndexAvailability(): void {
  available = null
}
