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
    await saveSetting('theme', 'light')
    await saveSetting('theme', 'dark')

    const rows = await bridge.db.query('select key from settings where key = ?', ['theme'])
    expect(rows).toHaveLength(1)
    expect((await loadSettings()).theme).toBe('dark')
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
    splitMode: 1,
    paneSizes: [1],
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

  it('repairs pane sizes that do not match the pane count', async () => {
    await bridge.db.exec('insert into sessions (id, payload, updated_at) values (1, ?, ?)', [
      JSON.stringify({
        tabs: [
          {
            id: 'tab-1',
            paneIds: ['pane-1', 'pane-2'],
            activePaneId: 'pane-1',
            splitMode: 2,
            paneSizes: [1], // one size for two panes
          },
        ],
        panes: { 'pane-1': pane, 'pane-2': { ...pane, id: 'pane-2' } },
        activeTabId: 'tab-1',
      }),
      0,
    ])

    const restored = await loadSession()
    const sizes = restored?.tabs[0]?.paneSizes ?? []
    expect(sizes).toHaveLength(2)
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
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
