/**
 * M5 acceptance: state survives a "relaunch".
 *
 * A relaunch is simulated by resetting the stores (as a fresh process would)
 * and hydrating again from the same database.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hydrate, startPersistence } from './persistence'
import { visibleColumns } from '@/constants/columns'
import { loadSettings, saveSetting } from './repositories/settings'
import { addFavorite, listFavorites } from './repositories/favorites'
import { listRecents } from './repositories/recents'
import { getFolderPrefs } from './repositories/folderPrefs'
import { loadSession } from './repositories/session'
import { __resetIdCounter, useWorkspaceStore } from '@/stores/workspaceStore'
import { useUiStore } from '@/stores/uiStore'
import { DEFAULT_THEME } from '@/constants/themes'
import { DEFAULT_LAYOUT } from '@/constants/columns'

const HOME = '/Users/dev'

let stop: (() => void) | undefined
let clock = 1_000

/** Deterministic clock: tests must not depend on wall time. */
const now = () => (clock += 1000)

function resetStores() {
  useWorkspaceStore.setState({ tabs: [], panes: {}, activeTabId: null })
  useUiStore.setState({
    previewOpen: false,
    sidebarOpen: true,
    showHiddenFiles: false,
    theme: DEFAULT_THEME,
    columnLayout: DEFAULT_LAYOUT,
  })
  __resetIdCounter()
}

/** Lets debounced writes (500ms session, 300ms prefs) fire. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 700))

beforeEach(() => {
  clock = 1_000
  resetStores()
})

afterEach(() => {
  stop?.()
  stop = undefined
})

describe('hydrate', () => {
  it('opens a fresh tab at home when there is no stored session', async () => {
    const result = await hydrate(HOME)

    expect(result.restoredSession).toBe(false)
    const state = useWorkspaceStore.getState()
    expect(state.tabs).toHaveLength(1)
    expect(Object.values(state.panes)[0]?.path).toBe(HOME)
  })

  it('applies stored settings to the UI store', async () => {
    await hydrate(HOME)
    stop = startPersistence(now)

    useUiStore.getState().toggleHiddenFiles()
    await settle()

    expect((await loadSettings()).showHiddenFiles).toBe(true)

    // Persistence must be detached before simulating a relaunch: a live
    // subscription would see resetStores() as a user change and write the
    // defaults straight back over what was just saved.
    stop()
    stop = undefined

    resetStores()
    await hydrate(HOME)
    expect(useUiStore.getState().showHiddenFiles).toBe(true)
  })

  // §M19: the layout is a structure rather than a scalar, so the round trip is
  // worth proving on its own — JSON out, JSON in, repaired on the way.
  it('remembers the column layout across a relaunch', async () => {
    await hydrate(HOME)
    stop = startPersistence(now)

    useUiStore.getState().setColumnLayout({
      order: ['modified', 'name', 'size', 'type', 'created', 'tags'],
      weights: { name: 0.4, size: 0.2, type: 0.2, modified: 0.2, created: 0.2, tags: 0.2 },
      hidden: ['created', 'tags'],
    })
    await settle()

    const stored = (await loadSettings()).columnLayout
    expect(visibleColumns(stored)).toEqual(['modified', 'name', 'size', 'type'])
    // The hidden pair survives the round trip too — it is half of what a
    // §M22 layout says (decision 1).
    expect(stored.hidden).toEqual(['created', 'tags'])

    stop()
    stop = undefined

    resetStores()
    await hydrate(HOME)
    expect(visibleColumns(useUiStore.getState().columnLayout)).toEqual([
      'modified',
      'name',
      'size',
      'type',
    ])
  })

  // A row a later build could have written. The repair happens in the
  // repository, so hydration is where it has to hold.
  it('repairs a stored layout that names a column this build does not have', async () => {
    // Migrations run inside `hydrate`, so the bad row has to be written between
    // two of them rather than before the first.
    await hydrate(HOME)
    await saveSetting('columnLayout', {
      order: ['owner', 'modified'],
      weights: { owner: 0.5, modified: 0.5 },
    } as never)

    resetStores()
    await hydrate(HOME)

    const layout = useUiStore.getState().columnLayout
    // The unknown id is gone, the missing ones are back, and the two §M22
    // introduced come back switched off rather than rearranging the window.
    expect(visibleColumns(layout)).toEqual(['modified', 'name', 'size', 'type'])
    expect(
      visibleColumns(layout).reduce((sum, id) => sum + layout.weights[id], 0),
    ).toBeCloseTo(1, 6)
  })

  // The theme is the one setting a wrong answer is visible in every pixel of,
  // so it gets its own relaunch (§M12).
  it('remembers the chosen theme across a relaunch', async () => {
    await hydrate(HOME)
    stop = startPersistence(now)

    useUiStore.getState().setTheme('system')
    await settle()

    expect((await loadSettings()).theme).toBe('system')

    stop()
    stop = undefined

    resetStores()
    await hydrate(HOME)
    expect(useUiStore.getState().theme).toBe('system')
  })
})

describe('session restore', () => {
  it('restores tabs, panes and split layout across a relaunch', async () => {
    await hydrate(HOME)
    stop = startPersistence(now)

    const store = useWorkspaceStore.getState()
    const firstTab = store.tabs[0]
    if (!firstTab) throw new Error('expected a tab')

    store.navigate(firstTab.activePaneId, `${HOME}/Documents`)
    store.setSplitMode(firstTab.id, 'columns-2')
    store.openTab(`${HOME}/Downloads`)

    await settle()
    stop()
    stop = undefined

    // Relaunch.
    resetStores()
    const result = await hydrate(HOME)

    expect(result.restoredSession).toBe(true)
    const restored = useWorkspaceStore.getState()
    expect(restored.tabs).toHaveLength(2)

    const restoredFirst = restored.tabs[0]
    expect(restoredFirst?.splitMode).toBe('columns-2')
    expect(restoredFirst?.paneIds).toHaveLength(2)
    expect(restored.panes[restoredFirst?.activePaneId ?? '']?.path).toBe(`${HOME}/Documents`)
  })

  it('preserves per-pane history through a relaunch', async () => {
    await hydrate(HOME)
    stop = startPersistence(now)

    const tab = useWorkspaceStore.getState().tabs[0]
    if (!tab) throw new Error('expected a tab')
    const paneId = tab.activePaneId

    useWorkspaceStore.getState().navigate(paneId, `${HOME}/Documents`)
    useWorkspaceStore.getState().navigate(paneId, `${HOME}/Documents/Work`)

    await settle()
    stop()
    stop = undefined

    resetStores()
    await hydrate(HOME)

    const restoredPane = Object.values(useWorkspaceStore.getState().panes)[0]
    expect(restoredPane?.history).toEqual([HOME, `${HOME}/Documents`, `${HOME}/Documents/Work`])
    expect(restoredPane?.historyIndex).toBe(2)
  })

  it('does not reuse ids after a restore', async () => {
    await hydrate(HOME)
    stop = startPersistence(now)
    useWorkspaceStore.getState().openTab(`${HOME}/Downloads`)
    await settle()
    stop()
    stop = undefined

    resetStores()
    await hydrate(HOME)

    const before = new Set(Object.keys(useWorkspaceStore.getState().panes))
    useWorkspaceStore.getState().openTab(`${HOME}/Music`)

    const after = Object.keys(useWorkspaceStore.getState().panes)
    const fresh = after.filter((id) => !before.has(id))

    expect(fresh).toHaveLength(1)
    // A colliding id would have replaced a restored pane instead of adding one.
    expect(after).toHaveLength(before.size + 1)
  })
})

describe('recents', () => {
  it('records each visited folder', async () => {
    await hydrate(HOME)
    stop = startPersistence(now)

    const tab = useWorkspaceStore.getState().tabs[0]
    if (!tab) throw new Error('expected a tab')

    useWorkspaceStore.getState().navigate(tab.activePaneId, `${HOME}/Documents`)
    useWorkspaceStore.getState().navigate(tab.activePaneId, `${HOME}/Downloads`)
    await settle()

    const paths = (await listRecents()).map((recent) => recent.path)
    expect(paths).toContain(`${HOME}/Documents`)
    expect(paths).toContain(`${HOME}/Downloads`)
  })
})

describe('folder preferences', () => {
  it('remembers a folder’s view mode and restores it on return', async () => {
    await hydrate(HOME)
    stop = startPersistence(now)

    const tab = useWorkspaceStore.getState().tabs[0]
    if (!tab) throw new Error('expected a tab')
    const paneId = tab.activePaneId

    useWorkspaceStore.getState().navigate(paneId, `${HOME}/Pictures`)
    useWorkspaceStore.getState().setViewMode(paneId, 'large-icons')
    await settle()

    expect((await getFolderPrefs(`${HOME}/Pictures`))?.viewMode).toBe('large-icons')

    // Leaving and coming back restores the remembered view.
    useWorkspaceStore.getState().navigate(paneId, `${HOME}/Documents`)
    useWorkspaceStore.getState().setViewMode(paneId, 'details')
    await settle()

    useWorkspaceStore.getState().navigate(paneId, `${HOME}/Pictures`)
    await settle()

    expect(useWorkspaceStore.getState().panes[paneId]?.viewMode).toBe('large-icons')
  })
})

describe('favorites', () => {
  it('survive a relaunch', async () => {
    await hydrate(HOME)
    await addFavorite(`${HOME}/Projects`)

    resetStores()
    await hydrate(HOME)

    const favorites = await listFavorites()
    expect(favorites.map((favorite) => favorite.path)).toEqual([`${HOME}/Projects`])
  })
})

describe('resilience', () => {
  it('leaves no session row when nothing was ever opened', async () => {
    // Migrations run, but nothing is persisted until a workspace exists.
    await hydrate(HOME)
    expect(await loadSession()).toBeNull()
  })
})
