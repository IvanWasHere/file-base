/**
 * Migration runner. TypeScript owns the schema (PLAN.md §0) — Go only supplies
 * Query/Exec/Tx.
 *
 * Versioning uses SQLite's own `user_version` pragma rather than a table, so
 * there is no bootstrapping problem: the counter exists before any schema does.
 */

import { bridge } from '@/services/bridge'

/**
 * Migrations are `.sql` files loaded at build time, numbered so their order is
 * their filename order. Vite inlines them; nothing is read from disk at runtime.
 */
const files: Record<string, string> = import.meta.glob('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})

export interface Migration {
  version: number
  name: string
  statements: string[]
}

/**
 * Splits a migration file into statements.
 *
 * Deliberately simple: line comments are stripped and the rest is split on
 * semicolons. That is sufficient for schema DDL and keeps the runner readable.
 * It would mis-split a semicolon inside a string literal or a trigger body — if
 * a future migration needs one, give it its own file with a single statement.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('--')
      return comment >= 0 ? line.slice(0, comment) : line
    })
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

/** Parses `./migrations/003_add_x.sql` into a version and a readable name. */
export function parseMigrationFilename(path: string): { version: number; name: string } | null {
  const match = /(\d+)[_-](.+)\.sql$/.exec(path)
  if (!match?.[1] || !match[2]) return null
  return { version: Number(match[1]), name: match[2] }
}

export function loadMigrations(source: Record<string, string> = files): Migration[] {
  return Object.entries(source)
    .map(([path, sql]) => {
      const parsed = parseMigrationFilename(path)
      if (!parsed) return null
      return { version: parsed.version, name: parsed.name, statements: splitStatements(sql) }
    })
    .filter((migration): migration is Migration => migration !== null)
    .sort((a, b) => a.version - b.version)
}

async function currentVersion(): Promise<number> {
  const rows = await bridge.db.query<{ user_version: number }>('pragma user_version')
  return Number(rows[0]?.user_version ?? 0)
}

/**
 * Applies every migration newer than the recorded version.
 *
 * Each migration runs as one transaction together with its own `user_version`
 * bump, so a failure part-way leaves the database on the previous version
 * rather than in a half-migrated state.
 */
export async function migrate(): Promise<{ from: number; to: number; applied: string[] }> {
  const from = await currentVersion()
  const pending = loadMigrations().filter((migration) => migration.version > from)

  const applied: string[] = []
  for (const migration of pending) {
    await bridge.db.transaction([
      ...migration.statements.map((sql) => ({ sql, args: [] })),
      // `pragma` takes no bind parameters, and the value is a number parsed
      // from a filename we control, so interpolation is safe here.
      { sql: `pragma user_version = ${migration.version}`, args: [] },
    ])
    applied.push(`${migration.version}_${migration.name}`)
  }

  return { from, to: pending.at(-1)?.version ?? from, applied }
}
