/**
 * In-memory SQLite for the mock bridge, backed by sql.js (SQLite compiled to
 * WebAssembly).
 *
 * This exists so migrations and repositories are tested against a real SQL
 * engine rather than a hand-written fake that would happily accept invalid SQL.
 *
 * Caveat: the stock sql.js build has no FTS5. That only affects M8's search
 * index; FTS5 is covered by Go tests against the real driver
 * (backend/db/db_test.go), which is where it actually has to work.
 */

import initSqlJs, { type Database } from 'sql.js'
import type { DatabaseApi, ExecResult, SqlValue, Statement } from '../types'

let database: Database | null = null
let loading: Promise<Database> | null = null

async function connect(): Promise<Database> {
  if (database) return database
  loading ??= initSqlJs().then((SQL) => {
    database = new SQL.Database()
    return database
  })
  return loading
}

/** Test hook: drops the in-memory database so each suite starts clean. */
export function resetMockDatabase(): void {
  database?.close()
  database = null
  loading = null
}

// sql.js accepts a narrower set of bind types than our contract nominally
// allows; everything we actually bind (string/number/null/Uint8Array) is
// supported, and booleans are mapped to integers as SQLite would.
function toBindable(args: readonly SqlValue[] | undefined) {
  return (args ?? []).map((value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value))
}

export const mockDb: DatabaseApi = {
  query: async <T = Record<string, SqlValue>>(sql: string, args?: SqlValue[]): Promise<T[]> => {
    const db = await connect()
    const statement = db.prepare(sql)
    try {
      statement.bind(toBindable(args))
      const rows: T[] = []
      while (statement.step()) {
        rows.push(statement.getAsObject() as T)
      }
      return rows
    } finally {
      statement.free()
    }
  },

  exec: async (sql: string, args?: SqlValue[]): Promise<ExecResult> => {
    const db = await connect()
    db.run(sql, toBindable(args))
    return {
      rowsAffected: db.getRowsModified(),
      lastInsertId: Number(
        (db.exec('select last_insert_rowid() as id')[0]?.values[0]?.[0] as number | undefined) ?? 0,
      ),
    }
  },

  transaction: async (statements: Statement[]): Promise<void> => {
    const db = await connect()
    db.run('begin')
    try {
      for (const statement of statements) {
        db.run(statement.sql, toBindable(statement.args))
      }
      db.run('commit')
    } catch (error) {
      db.run('rollback')
      throw error
    }
  },
}
