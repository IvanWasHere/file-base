/**
 * Recently-visited locations.
 *
 * Retention is enforced here rather than by a database trigger: the PRD keeps
 * policy in TypeScript, and a trigger would hide the rule from the code that
 * owns it.
 */

import { bridge } from '@/services/bridge'

const MAX_RECENTS = 30

export interface Recent {
  path: string
  visitedAt: number
}

export async function recordVisit(path: string, now: number): Promise<void> {
  await bridge.db.transaction([
    {
      sql: 'insert into recents (path, visited_at) values (?, ?) on conflict (path) do update set visited_at = excluded.visited_at',
      args: [path, now],
    },
    // Trim in the same transaction so the table cannot grow unbounded if the
    // app is killed between the write and a separate prune.
    {
      sql: 'delete from recents where path not in (select path from recents order by visited_at desc limit ?)',
      args: [MAX_RECENTS],
    },
  ])
}

export async function listRecents(limit = 10): Promise<Recent[]> {
  const rows = await bridge.db.query<{ path: string; visited_at: number }>(
    'select path, visited_at from recents order by visited_at desc limit ?',
    [limit],
  )
  return rows.map((row) => ({ path: row.path, visitedAt: Number(row.visited_at) }))
}

export async function clearRecents(): Promise<void> {
  await bridge.db.exec('delete from recents')
}

/** Drops entries whose paths no longer exist — called after a delete (M6). */
export async function forgetPath(path: string): Promise<void> {
  await bridge.db.exec('delete from recents where path = ?', [path])
}
