/**
 * Repository tests against a real SQL engine (sql.js in the mock bridge), so
 * invalid SQL fails here rather than at runtime.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../migrate'
import { DEFAULT_SETTINGS, loadSettings, saveSetting, saveSettings } from './settings'
import {
  addFavorite,
  isFavorite,
  listFavorites,
  removeFavorite,
  renameFavorite,
  reorderFavorites,
} from './favorites'
import { clearRecents, forgetPath, listRecents, recordVisit } from './recents'
import { getFolderPrefs, loadAllFolderPrefs, saveFolderPrefs } from './folderPrefs'
import { clearSession, loadSession, saveSession } from './session'
import { bridge } from '@/services/bridge'
import { DEFAULT_THEME } from '@/constants/themes'
import { DEFAULT_SORT } from '@/services/filesystem/sort'
import type { Pane, Tab } from '@/types/workspace'

beforeEach(async () => {
  await migrate()
})

describe('settings', () => {
  it('returns defaults on a fresh database', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips a boolean without collapsing it to 0/1', async () => {
    await saveSetting('showHiddenFiles', true)
    expect((await loadSettings()).showHiddenFiles).toBe(true)

    await saveSetting('showHiddenFiles', false)
    const loaded = await loadSettings()
    expect(loaded.showHiddenFiles).toBe(false)
    expect(loaded.showHiddenFiles).not.toBe(0)
  })

  it('overwrites rather than duplicating a key', async () => {
    await saveSetting('theme', 'nocturne')
    await saveSetting('theme', 'graphite')

    const rows = await bridge.db.query('select key from settings where key = ?', ['theme'])
    expect(rows).toHaveLength(1)
    expect((await loadSettings()).theme).toBe('graphite')
  })

  // The two values a database written before §M24 can hold, when `light` and
  // `dark` were the only palettes rather than the ids of two of five themes.
  it('brings a pre-§M24 theme preference forward on the way out', async () => {
    await saveSetting('theme', 'dark')
    expect((await loadSettings()).theme).toBe('vault-dark')

    await saveSetting('theme', 'light')
    expect((await loadSettings()).theme).toBe('vault-light')
  })

  // Not validated against the installed themes here, deliberately: an id can
  // name a file that exists on one Mac and not another, so the fallback lives
  // in `resolveTheme` where the themes are known.
  it('keeps a theme id it does not recognise, and drops one of the wrong type', async () => {
    await saveSetting('theme', 'external:/themes/ocean.json')
    expect((await loadSettings()).theme).toBe('external:/themes/ocean.json')

    await bridge.db.exec(
      'insert into settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
      ['theme', JSON.stringify(7)],
    )
    expect((await loadSettings()).theme).toBe(DEFAULT_THEME)
  })

  it('saves several settings at once', async () => {
    await saveSettings({ sidebarOpen: false, previewOpen: true })
    const loaded = await loadSettings()
    expect(loaded.sidebarOpen).toBe(false)
    expect(loaded.previewOpen).toBe(true)
  })

  it('falls back to defaults for a corrupt value rather than failing startup', async () => {
    await bridge.db.exec('insert into settings (key, value) values (?, ?)', [
      'showHiddenFiles',
      'not json',
    ])
    expect((await loadSettings()).showHiddenFiles).toBe(DEFAULT_SETTINGS.showHiddenFiles)
  })

  it('ignores unknown keys left by an older version', async () => {
    await bridge.db.exec('insert into settings (key, value) values (?, ?)', ['removedOption', '1'])
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS)
  })
})

describe('favorites', () => {
  it('adds and lists in insertion order', async () => {
    await addFavorite('/Users/dev/Projects')
    await addFavorite('/Users/dev/Documents')

    const favorites = await listFavorites()
    expect(favorites.map((favorite) => favorite.path)).toEqual([
      '/Users/dev/Projects',
      '/Users/dev/Documents',
    ])
  })

  it('derives a label from the path', async () => {
    await addFavorite('/Users/dev/Projects')
    expect((await listFavorites())[0]?.label).toBe('Projects')
  })

  it('treats pinning twice as a no-op', async () => {
    await addFavorite('/Users/dev/Projects', 'First')
    await addFavorite('/Users/dev/Projects', 'Second')

    const favorites = await listFavorites()
    expect(favorites).toHaveLength(1)
    expect(favorites[0]?.label).toBe('First')
  })

  it('removes and reports membership', async () => {
    await addFavorite('/Users/dev/Projects')
    expect(await isFavorite('/Users/dev/Projects')).toBe(true)

    await removeFavorite('/Users/dev/Projects')
    expect(await isFavorite('/Users/dev/Projects')).toBe(false)
    expect(await listFavorites()).toHaveLength(0)
  })

  it('renames', async () => {
    await addFavorite('/Users/dev/Projects')
    await renameFavorite('/Users/dev/Projects', 'Work')
    expect((await listFavorites())[0]?.label).toBe('Work')
  })

  it('persists a reorder', async () => {
    await addFavorite('/a')
    await addFavorite('/b')
    await addFavorite('/c')

    await reorderFavorites(['/c', '/a', '/b'])
    expect((await listFavorites()).map((favorite) => favorite.path)).toEqual(['/c', '/a', '/b'])
  })
})

describe('recents', () => {
  it('records and lists newest first', async () => {
    await recordVisit('/a', 1000)
    await recordVisit('/b', 2000)

    expect((await listRecents()).map((recent) => recent.path)).toEqual(['/b', '/a'])
  })

  it('updates the timestamp of a revisited path instead of duplicating it', async () => {
    await recordVisit('/a', 1000)
    await recordVisit('/b', 2000)
    await recordVisit('/a', 3000)

    const recents = await listRecents()
    expect(recents).toHaveLength(2)
    expect(recents[0]?.path).toBe('/a')
  })

  it('caps the table so it cannot grow without bound', async () => {
    for (let index = 0; index < 40; index += 1) {
      await recordVisit(`/path-${index}`, index)
    }

    const all = await bridge.db.query('select path from recents')
    expect(all.length).toBeLessThanOrEqual(30)

    // The most recent survive; the oldest are dropped.
    const recents = await listRecents(1)
    expect(recents[0]?.path).toBe('/path-39')
  })

  it('forgets a single path and clears everything', async () => {
    await recordVisit('/a', 1)
    await recordVisit('/b', 2)

    await forgetPath('/a')
    expect((await listRecents()).map((recent) => recent.path)).toEqual(['/b'])

    await clearRecents()
    expect(await listRecents()).toHaveLength(0)
  })
})

describe('folder prefs', () => {
  it('stores and reloads a view mode and sort', async () => {
    await saveFolderPrefs('/Users/dev/Pictures', 'large-icons', {
      key: 'modified',
      direction: 'desc',
      foldersFirst: false,
    })

    const prefs = await getFolderPrefs('/Users/dev/Pictures')
    expect(prefs).toEqual({
      viewMode: 'large-icons',
      sort: { key: 'modified', direction: 'desc', foldersFirst: false },
    })
  })

  it('returns null for a folder never customised', async () => {
    expect(await getFolderPrefs('/nowhere')).toBeNull()
  })

  it('overwrites on repeat save', async () => {
    await saveFolderPrefs('/x', 'details', DEFAULT_SORT)
    await saveFolderPrefs('/x', 'small-icons', DEFAULT_SORT)
    expect((await getFolderPrefs('/x'))?.viewMode).toBe('small-icons')
  })

  it('falls back when a stored value is no longer valid', async () => {
    // A row written by a build that had a view mode this one does not.
    await bridge.db.exec(
      'insert into folder_prefs (path, view_mode, sort_key, sort_dir, folders_first) values (?, ?, ?, ?, ?)',
      ['/legacy', 'column-view', 'colour', 'sideways', 1],
    )

    const prefs = await getFolderPrefs('/legacy')
    expect(prefs?.viewMode).toBe('details')
    expect(prefs?.sort.key).toBe('name')
    expect(prefs?.sort.direction).toBe('asc')
  })

  // M13 decision 9: `photos` has to survive a round trip through both stores, or
  // a pane restored into it silently drops back to Details — which looks like the
  // view mode simply not sticking.
  it('round-trips the Photos view mode', async () => {
    await saveFolderPrefs('/gallery', 'photos', DEFAULT_SORT)
    expect((await getFolderPrefs('/gallery'))?.viewMode).toBe('photos')
  })

  it('loads every folder at once', async () => {
    await saveFolderPrefs('/a', 'details', DEFAULT_SORT)
    await saveFolderPrefs('/b', 'medium-icons', DEFAULT_SORT)

    const all = await loadAllFolderPrefs()
    expect(all.size).toBe(2)
    expect(all.get('/b')?.viewMode).toBe('medium-icons')
  })
})

describe('session', () => {
  const pane: Pane = {
    id: 'pane-1',
    path: '/Users/dev/Documents',
    history: ['/Users/dev', '/Users/dev/Documents'],
    historyIndex: 1,
    viewMode: 'details',
    sort: DEFAULT_SORT,
  }

  const tab: Tab = {
    id: 'tab-1',
    paneIds: ['pane-1'],
    activePaneId: 'pane-1',
    splitMode: 'single',
    layout: { columns: [1], rows: [1] },
  }

  it('round-trips tabs, panes and history', async () => {
    await saveSession({ tabs: [tab], panes: { 'pane-1': pane }, activeTabId: 'tab-1' }, 123)

    const restored = await loadSession()
    expect(restored?.tabs).toHaveLength(1)
    expect(restored?.panes['pane-1']?.path).toBe('/Users/dev/Documents')
    expect(restored?.panes['pane-1']?.historyIndex).toBe(1)
    expect(restored?.activeTabId).toBe('tab-1')
  })

  // The second of the two places a view mode is validated on the way out. This
  // one had spelled the union out by hand, so Photos would have been restored as
  // Details without a word (M13 decision 9).
  it('restores a pane left in the Photos view', async () => {
    const photos: Pane = { ...pane, viewMode: 'photos' }
    await saveSession({ tabs: [tab], panes: { 'pane-1': photos }, activeTabId: 'tab-1' }, 1)

    expect((await loadSession())?.panes['pane-1']?.viewMode).toBe('photos')
  })

  it('keeps only one session row', async () => {
    await saveSession({ tabs: [tab], panes: { 'pane-1': pane }, activeTabId: 'tab-1' }, 1)
    await saveSession({ tabs: [tab], panes: { 'pane-1': pane }, activeTabId: 'tab-1' }, 2)

    const rows = await bridge.db.query('select id from sessions')
    expect(rows).toHaveLength(1)
  })

  it('returns null when nothing is stored', async () => {
    expect(await loadSession()).toBeNull()
  })

  it('returns null for unparseable JSON rather than throwing', async () => {
    await bridge.db.exec('insert into sessions (id, payload, updated_at) values (1, ?, ?)', [
      'not json at all',
      0,
    ])
    expect(await loadSession()).toBeNull()
  })

  it('drops tabs whose panes did not survive', async () => {
    await bridge.db.exec('insert into sessions (id, payload, updated_at) values (1, ?, ?)', [
      JSON.stringify({
        tabs: [{ ...tab, paneIds: ['pane-missing'], activePaneId: 'pane-missing' }],
        panes: {},
        activeTabId: 'tab-1',
      }),
      0,
    ])
    // No usable tab means no session — the caller opens a fresh one at home.
    expect(await loadSession()).toBeNull()
  })

  /** Writes one tab straight into the session row, bypassing `saveSession`. */
  async function storeRawTab(tabRecord: Record<string, unknown>, paneIds: string[]) {
    const panes = Object.fromEntries(paneIds.map((id) => [id, { ...pane, id }]))
    await bridge.db.exec('insert into sessions (id, payload, updated_at) values (1, ?, ?)', [
      JSON.stringify({ tabs: [tabRecord], panes, activeTabId: tabRecord.id }),
      0,
    ])
    return (await loadSession())?.tabs[0]
  }

  it('repairs a layout that does not match the pane count', async () => {
    const restored = await storeRawTab(
      {
        id: 'tab-1',
        paneIds: ['pane-1', 'pane-2'],
        activePaneId: 'pane-1',
        splitMode: 'columns-2',
        layout: { columns: [1], rows: [1] }, // one column for two panes
      },
      ['pane-1', 'pane-2'],
    )

    expect(restored?.layout.columns).toHaveLength(2)
    expect(restored?.layout.columns.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
  })

  // §M17 changed the stored *type*: `splitMode` was a pane count and is now a
  // name. This is the third shape this one field has taken.
  it.each([
    [1, 'single'],
    [2, 'columns-2'],
    [3, 'columns-3'],
    [4, 'grid-2x2'],
  ])('maps the pre-M17 numeric mode %i onto %s', async (legacy, expected) => {
    const ids = ['pane-1', 'pane-2', 'pane-3', 'pane-4'].slice(0, legacy)
    const restored = await storeRawTab(
      { id: 'tab-1', paneIds: ids, activePaneId: 'pane-1', splitMode: legacy },
      ids,
    )

    expect(restored?.splitMode).toBe(expected)
    expect(restored?.paneIds).toHaveLength(legacy)
  })

  // A name from a later build. Unreadable is unreadable, whichever direction it
  // came from, so it takes the same path a corrupt value does.
  it('falls back by pane count for a layout it has never heard of', async () => {
    const ids = ['pane-1', 'pane-2', 'pane-3']
    const restored = await storeRawTab(
      { id: 'tab-1', paneIds: ids, activePaneId: 'pane-1', splitMode: 'grid-3x3' },
      ids,
    )

    expect(restored?.splitMode).toBe('columns-3')
    expect(restored?.paneIds).toHaveLength(3)
  })

  it('round-trips an asymmetric layout with its dragged proportions', async () => {
    const ids = ['pane-1', 'pane-2', 'pane-3']
    const restored = await storeRawTab(
      {
        id: 'tab-1',
        paneIds: ids,
        activePaneId: 'pane-1',
        splitMode: 'split-right',
        layout: { columns: [0.6, 0.4], rows: [0.25, 0.75] },
      },
      ids,
    )

    expect(restored?.splitMode).toBe('split-right')
    expect(restored?.layout).toEqual({ columns: [0.6, 0.4], rows: [0.25, 0.75] })
  })

  // Split Top is three panes in a 2 × 2 of tracks, so its fractions are two and
  // two — not three columns, which is what a pane-count guess would produce.
  it('keeps an asymmetric layout’s track counts rather than its pane count', async () => {
    const ids = ['pane-1', 'pane-2', 'pane-3']
    const restored = await storeRawTab(
      { id: 'tab-1', paneIds: ids, activePaneId: 'pane-1', splitMode: 'split-top' },
      ids,
    )

    expect(restored?.layout).toEqual({ columns: [0.5, 0.5], rows: [0.5, 0.5] })
  })

  // §M16 changed the stored *shape*, not just a value. A tab written by the
  // previous build carries `paneSizes` and no `layout`.
  it('lifts a pre-M16 single-row tab onto the grid', async () => {
    const restored = await storeRawTab(
      {
        id: 'tab-1',
        paneIds: ['pane-1', 'pane-2'],
        activePaneId: 'pane-1',
        splitMode: 2,
        paneSizes: [0.7, 0.3],
      },
      ['pane-1', 'pane-2'],
    )

    // The dragged proportions survive; they only ever described columns.
    expect(restored?.layout).toEqual({ columns: [0.7, 0.3], rows: [1] })
  })

  // Four fractions along one axis cannot be turned into a 2 × 2 — they never
  // meant anything on a second axis — so the grid starts even.
  it('starts a pre-M16 four-column tab as an even grid', async () => {
    const ids = ['pane-1', 'pane-2', 'pane-3', 'pane-4']
    const restored = await storeRawTab(
      {
        id: 'tab-1',
        paneIds: ids,
        activePaneId: 'pane-1',
        splitMode: 4,
        paneSizes: [0.4, 0.2, 0.2, 0.2],
      },
      ids,
    )

    expect(restored?.splitMode).toBe('grid-2x2')
    expect(restored?.layout).toEqual({ columns: [0.5, 0.5], rows: [0.5, 0.5] })
  })

  it('round-trips a dragged 2 × 2 layout', async () => {
    const ids = ['pane-1', 'pane-2', 'pane-3', 'pane-4']
    const restored = await storeRawTab(
      {
        id: 'tab-1',
        paneIds: ids,
        activePaneId: 'pane-1',
        splitMode: 4,
        layout: { columns: [0.65, 0.35], rows: [0.3, 0.7] },
      },
      ids,
    )

    expect(restored?.layout).toEqual({ columns: [0.65, 0.35], rows: [0.3, 0.7] })
  })

  // A mode that outlives its panes would leave the grid with an empty cell, or
  // a pane with no cell to sit in.
  it('falls back to the mode the surviving panes fit', async () => {
    const restored = await storeRawTab(
      {
        id: 'tab-1',
        paneIds: ['pane-1', 'pane-2', 'missing-pane', 'also-missing'],
        activePaneId: 'pane-1',
        splitMode: 4,
        layout: { columns: [0.5, 0.5], rows: [0.5, 0.5] },
      },
      ['pane-1', 'pane-2'],
    )

    expect(restored?.splitMode).toBe('columns-2')
    expect(restored?.paneIds).toEqual(['pane-1', 'pane-2'])
    expect(restored?.layout).toEqual({ columns: [0.5, 0.5], rows: [1] })
  })

  it('clamps a history index past the end of the history', async () => {
    await bridge.db.exec('insert into sessions (id, payload, updated_at) values (1, ?, ?)', [
      JSON.stringify({
        tabs: [tab],
        panes: { 'pane-1': { ...pane, historyIndex: 99 } },
        activeTabId: 'tab-1',
      }),
      0,
    ])

    expect((await loadSession())?.panes['pane-1']?.historyIndex).toBe(1)
  })

  it('clears', async () => {
    await saveSession({ tabs: [tab], panes: { 'pane-1': pane }, activeTabId: 'tab-1' }, 1)
    await clearSession()
    expect(await loadSession()).toBeNull()
  })
})
