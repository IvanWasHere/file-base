/**
 * Search orchestration for one pane.
 *
 * Three modes behind one search box, chosen by what is possible rather than by
 * anything the user has to configure:
 *
 *  - **Current folder** — a pure predicate over the listing already in the
 *    query cache. No round trip, no debounce, results on the keystroke.
 *  - **Subfolders, indexed** — one FTS5 query, then a batch stat. Fast enough
 *    to feel like the folder filter.
 *  - **Subfolders, not indexed** — a streaming walk in Go, cancelled and
 *    restarted as the query changes.
 *
 * Only the last needs debouncing, and only it can be slow, so only it reports
 * progress.
 */

import { useEffect, useMemo, useRef } from 'react'
import { bridge } from '@/services/bridge'
import { buildCriteria, filterItems, hasActiveFilters } from '@/services/search/criteria'
import { queryIndex } from '@/services/search/searchIndex'
import { usePaneSearch, useSearchStore } from '@/stores/searchStore'
import type { FileItem, SearchBatch, SearchDone } from '@/types/file'

/**
 * Long enough that typing a word does not start a walk per letter, short enough
 * that a pause feels like a decision rather than a lag.
 */
const DEBOUNCE_MS = 250

export interface UseSearchResult {
  /** True when the pane should render results instead of its listing. */
  active: boolean
  items: FileItem[]
  /** Cancels a running walk. */
  cancel: () => void
}

/** `root` is the folder the pane is showing — where a recursive search starts. */
export function useSearch(
  paneId: string,
  root: string,
  listing: readonly FileItem[],
): UseSearchResult {
  const search = usePaneSearch(paneId)
  const begin = useSearchStore((state) => state.begin)
  const append = useSearchStore((state) => state.append)
  const finish = useSearchStore((state) => state.finish)

  const { open, query, scope, filters } = search
  const trimmed = query.trim()
  const narrowed = trimmed.length > 0 || hasActiveFilters(filters)

  // Folder scope is synchronous: the listing is already in memory, so filtering
  // it during render is cheaper than any amount of machinery around it.
  const filtered = useMemo(
    () => (scope === 'folder' ? filterItems(listing, query, filters) : []),
    [scope, listing, query, filters],
  )

  // The id of the walk this pane started, for cancelling on unmount or restart.
  const runningId = useRef<string | null>(null)

  useEffect(() => {
    if (!open || scope !== 'recursive' || !root) return
    // A recursive search needs words. Filters alone would match the whole
    // subtree, which is a directory tree dump, not a search.
    if (!trimmed) return

    let cancelled = false
    let unsubscribe: (() => void) | undefined

    const timer = setTimeout(() => {
      void (async () => {
        const criteria = buildCriteria(trimmed, root, filters)

        // The index answers in one shot, so it needs neither streaming nor a
        // cancel path.
        try {
          const hits = await queryIndex(root, criteria)
          if (cancelled) return
          if (hits) {
            const id = `index-${root}-${trimmed}`
            begin(paneId, id, root, true)
            append(paneId, id, hits, hits.length)
            finish(paneId, id, { status: 'done', matched: hits.length, truncated: false })
            return
          }
        } catch {
          // A broken index must never block a search; fall through and walk.
        }
        if (cancelled) return

        // Subscribing *before* starting the walk, and buffering until the id
        // comes back. The result stream and the call response are independent
        // messages — the backend can emit its first batch before the promise
        // for the id has resolved here, and those results would be lost.
        let id: string | null = null
        const buffered: { batches: SearchBatch[]; done: SearchDone[] } = { batches: [], done: [] }

        const deliverBatch = (batch: SearchBatch) => {
          append(paneId, batch.id, batch.items, batch.scanned)
        }
        const deliverDone = (done: SearchDone) => {
          runningId.current = null
          finish(paneId, done.id, {
            status: done.cancelled ? 'cancelled' : done.error ? 'error' : 'done',
            matched: done.matched,
            truncated: done.truncated,
            message: done.error,
          })
        }

        unsubscribe = bridge.search.subscribe({
          onBatch: (batch) => {
            if (id === null) {
              buffered.batches.push(batch)
              return
            }
            if (batch.id === id) deliverBatch(batch)
          },
          onDone: (done) => {
            if (id === null) {
              buffered.done.push(done)
              return
            }
            if (done.id === id) deliverDone(done)
          },
        })

        try {
          id = await bridge.search.find(criteria)
        } catch (error) {
          unsubscribe()
          unsubscribe = undefined
          begin(paneId, 'failed', root, false)
          finish(paneId, 'failed', {
            status: 'error',
            matched: 0,
            truncated: false,
            message: error instanceof Error ? error.message : String(error),
          })
          return
        }

        if (cancelled) {
          void bridge.search.cancel(id)
          return
        }

        runningId.current = id
        begin(paneId, id, root, false)

        // `begin` clears the results, so anything that arrived early is
        // replayed after it, not before.
        for (const batch of buffered.batches) {
          if (batch.id === id) deliverBatch(batch)
        }
        for (const done of buffered.done) {
          if (done.id === id) deliverDone(done)
        }
      })()
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
      unsubscribe?.()
      // Superseded walks are stopped rather than left running: a query edited
      // five times would otherwise have five walks competing for the disk.
      if (runningId.current) {
        void bridge.search.cancel(runningId.current)
        runningId.current = null
      }
    }
  }, [open, scope, root, trimmed, filters, paneId, begin, append, finish])

  const cancel = useMemo(
    () => () => {
      if (runningId.current) {
        void bridge.search.cancel(runningId.current)
        runningId.current = null
      }
    },
    [],
  )

  return {
    active: open && (scope === 'folder' ? narrowed : search.status !== 'idle'),
    items: scope === 'folder' ? filtered : search.results,
    cancel,
  }
}
