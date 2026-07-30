import { describe, expect, it } from 'vitest'
import { bridge } from '@/services/bridge'
import { loadMigrations, migrate, parseMigrationFilename, splitStatements } from './migrate'

describe('splitStatements', () => {
  it('splits on semicolons and drops blanks', () => {
    expect(splitStatements('create table a (x); create table b (y);')).toEqual([
      'create table a (x)',
      'create table b (y)',
    ])
  })

  it('strips line comments', () => {
    const sql = `-- a leading note
      create table a (x); -- trailing note
      -- another note
      create table b (y);`
    expect(splitStatements(sql)).toEqual(['create table a (x)', 'create table b (y)'])
  })

  it('returns nothing for a comment-only file', () => {
    expect(splitStatements('-- nothing to do here\n')).toEqual([])
  })
})

describe('parseMigrationFilename', () => {
  it('extracts version and name', () => {
    expect(parseMigrationFilename('./migrations/001_init.sql')).toEqual({
      version: 1,
      name: 'init',
    })
    expect(parseMigrationFilename('./migrations/012_add_search_index.sql')).toEqual({
      version: 12,
      name: 'add_search_index',
    })
  })

  it('ignores files that are not migrations', () => {
    expect(parseMigrationFilename('./migrations/readme.md')).toBeNull()
  })
})

describe('loadMigrations', () => {
  it('orders by version, not by string sort', () => {
    const loaded = loadMigrations({
      './migrations/010_ten.sql': 'select 1;',
      './migrations/002_two.sql': 'select 1;',
      './migrations/001_one.sql': 'select 1;',
    })
    expect(loaded.map((migration) => migration.version)).toEqual([1, 2, 10])
  })

  it('loads the real migration files', () => {
    const loaded = loadMigrations()
    expect(loaded.length).toBeGreaterThan(0)
    expect(loaded[0]?.version).toBe(1)
    expect(loaded[0]?.statements.length).toBeGreaterThan(0)
  })
})

describe('migrate', () => {
  const tableNames = async () => {
    const rows = await bridge.db.query<{ name: string }>(
      "select name from sqlite_master where type = 'table' order by name",
    )
    return rows.map((row) => row.name)
  }

  it('creates the schema and records the version', async () => {
    const result = await migrate()

    expect(result.from).toBe(0)
    expect(result.applied.length).toBeGreaterThan(0)

    const names = await tableNames()
    for (const expected of [
      'settings',
      'favorites',
      'recents',
      'folder_prefs',
      'sessions',
      'tags',
      'path_tags',
      'annotations',
      'thumbs',
    ]) {
      expect(names).toContain(expected)
    }

    const version = await bridge.db.query<{ user_version: number }>('pragma user_version')
    expect(Number(version[0]?.user_version)).toBe(result.to)
  })

  it('is idempotent — a second run applies nothing', async () => {
    await migrate()
    const second = await migrate()

    expect(second.applied).toEqual([])
    expect(second.from).toBe(second.to)
  })

  it('enforces the single-row constraint on sessions', async () => {
    await migrate()
    await expect(
      bridge.db.exec('insert into sessions (id, payload, updated_at) values (2, ?, ?)', ['{}', 0]),
    ).rejects.toBeDefined()
  })
})
