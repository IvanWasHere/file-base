import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetIdCounter,
  canGoBack,
  canGoForward,
  canGoUp,
  useWorkspaceStore,
} from './workspaceStore'

const HOME = '/Users/dev'

const store = () => useWorkspaceStore.getState()

/** The active tab, asserted non-null for readability in tests. */
function activeTab() {
  const state = store()
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
  if (!tab) throw new Error('no active tab')
  return tab
}

function activePane() {
  const pane = store().panes[activeTab().activePaneId]
  if (!pane) throw new Error('no active pane')
  return pane
}

beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], panes: {}, activeTabId: null })
  __resetIdCounter()
})

describe('initialize', () => {
  it('creates one tab at home', () => {
    store().initialize(HOME)
    expect(store().tabs).toHaveLength(1)
    expect(activePane().path).toBe(HOME)
  })

  it('is idempotent, so StrictMode double-invoke is harmless', () => {
    store().initialize(HOME)
    store().initialize(HOME)
    expect(store().tabs).toHaveLength(1)
  })
})

describe('navigation', () => {
  beforeEach(() => store().initialize(HOME))

  it('pushes history and moves back and forward', () => {
    const paneId = activePane().id

    store().navigate(paneId, `${HOME}/Documents`)
    store().navigate(paneId, `${HOME}/Documents/Work`)
    expect(activePane().path).toBe(`${HOME}/Documents/Work`)

    store().goBack(paneId)
    expect(activePane().path).toBe(`${HOME}/Documents`)

    store().goBack(paneId)
    expect(activePane().path).toBe(HOME)
    expect(canGoBack(activePane())).toBe(false)

    store().goForward(paneId)
    expect(activePane().path).toBe(`${HOME}/Documents`)
  })

  it('truncates the forward stack when navigating after going back', () => {
    const paneId = activePane().id

    store().navigate(paneId, `${HOME}/A`)
    store().navigate(paneId, `${HOME}/B`)
    store().goBack(paneId)
    expect(canGoForward(activePane())).toBe(true)

    store().navigate(paneId, `${HOME}/C`)
    expect(canGoForward(activePane())).toBe(false)
    expect(activePane().history).toEqual([HOME, `${HOME}/A`, `${HOME}/C`])
  })

  it('ignores navigating to the path already shown', () => {
    const paneId = activePane().id
    store().navigate(paneId, HOME)
    expect(activePane().history).toEqual([HOME])
  })

  it('goes up to the parent', () => {
    const paneId = activePane().id
    store().navigate(paneId, `${HOME}/Documents/Work`)
    store().goUp(paneId)
    expect(activePane().path).toBe(`${HOME}/Documents`)
  })

  it('cannot go up from root', () => {
    const paneId = activePane().id
    store().navigate(paneId, '/')
    expect(canGoUp(activePane())).toBe(false)

    store().goUp(paneId)
    expect(activePane().path).toBe('/')
  })

  it('keeps each pane history independent', () => {
    const tab = activeTab()
    store().setSplitMode(tab.id, 'columns-2')

    const [firstId, secondId] = activeTab().paneIds
    if (!firstId || !secondId) throw new Error('expected two panes')

    store().navigate(firstId, `${HOME}/Documents`)
    expect(store().panes[firstId]?.path).toBe(`${HOME}/Documents`)
    expect(store().panes[secondId]?.path).toBe(HOME)
    expect(canGoBack(store().panes[secondId])).toBe(false)
  })
})

describe('tabs', () => {
  beforeEach(() => store().initialize(HOME))

  it('opens a tab and makes it active', () => {
    const tabId = store().openTab(`${HOME}/Downloads`)
    expect(store().tabs).toHaveLength(2)
    expect(store().activeTabId).toBe(tabId)
    expect(activePane().path).toBe(`${HOME}/Downloads`)
  })

  it('discards a closed tab’s panes', () => {
    const tabId = store().openTab(`${HOME}/Downloads`)
    const paneIds = activeTab().paneIds

    store().closeTab(tabId)
    for (const paneId of paneIds) {
      expect(store().panes[paneId]).toBeUndefined()
    }
  })

  it('activates a neighbour when closing the active tab', () => {
    const first = store().tabs[0]?.id
    const second = store().openTab(`${HOME}/A`)
    store().openTab(`${HOME}/B`)

    store().setActiveTab(second)
    store().closeTab(second)

    expect(store().tabs).toHaveLength(2)
    expect(store().activeTabId).not.toBe(second)
    expect(store().tabs.map((tab) => tab.id)).toContain(first)
  })

  it('reopens at the same location rather than leaving nothing to render', () => {
    const only = store().tabs[0]
    if (!only) throw new Error('expected a tab')
    const paneId = only.activePaneId
    store().navigate(paneId, `${HOME}/Documents`)

    store().closeTab(only.id)

    expect(store().tabs).toHaveLength(1)
    expect(activePane().path).toBe(`${HOME}/Documents`)
  })
})

describe('splits', () => {
  beforeEach(() => store().initialize(HOME))

  it('adds panes at the active pane’s location', () => {
    const tab = activeTab()
    store().navigate(tab.activePaneId, `${HOME}/Documents`)
    store().setSplitMode(tab.id, 'columns-3')

    const updated = activeTab()
    expect(updated.paneIds).toHaveLength(3)
    for (const paneId of updated.paneIds) {
      expect(store().panes[paneId]?.path).toBe(`${HOME}/Documents`)
    }
  })

  it('distributes sizes evenly and keeps each axis summing to 1', () => {
    store().setSplitMode(activeTab().id, 'columns-3')
    const { columns, rows } = activeTab().layout

    expect(columns).toHaveLength(3)
    expect(rows).toEqual([1])
    expect(columns.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
  })

  // The point of §M16: four panes are two rows of two, not four columns.
  it('lays four panes out as a 2 × 2 grid', () => {
    store().setSplitMode(activeTab().id, 'grid-2x2')
    const tab = activeTab()

    expect(tab.paneIds).toHaveLength(4)
    expect(tab.layout.columns).toHaveLength(2)
    expect(tab.layout.rows).toHaveLength(2)
    expect(tab.layout.columns.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
    expect(tab.layout.rows.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
  })

  // §M17: five of the nine layouts hold three panes, so switching between two
  // of them must keep the panes and change only the arrangement.
  it('keeps the same panes when switching between two three-pane layouts', () => {
    const tabId = activeTab().id
    store().setSplitMode(tabId, 'columns-3')
    const before = [...activeTab().paneIds]

    store().setSplitMode(tabId, 'split-top')
    expect(activeTab().paneIds).toEqual(before)
    expect(activeTab().splitMode).toBe('split-top')
    // Split Top is a 2 × 2 of tracks holding three panes.
    expect(activeTab().layout).toEqual({ columns: [0.5, 0.5], rows: [0.5, 0.5] })
  })

  it('adds a pane going from 2 Rows to Split Left', () => {
    const tabId = activeTab().id
    store().setSplitMode(tabId, 'rows-2')
    expect(activeTab().paneIds).toHaveLength(2)

    store().setSplitMode(tabId, 'split-left')
    expect(activeTab().paneIds).toHaveLength(3)
  })

  // A layout dragged in one mode must not be carried into another, where its
  // fractions would describe an arrangement that no longer exists.
  it('resets the layout when the mode changes', () => {
    const tabId = activeTab().id
    store().setSplitMode(tabId, 'columns-2')
    store().setLayout(tabId, { columns: [0.8, 0.2], rows: [1] })

    store().setSplitMode(tabId, 'grid-2x2')
    expect(activeTab().layout).toEqual({ columns: [0.5, 0.5], rows: [0.5, 0.5] })
  })

  it('removes panes and their state when collapsing', () => {
    const tabId = activeTab().id
    store().setSplitMode(tabId, 'columns-3')
    const [, second, third] = activeTab().paneIds

    store().setSplitMode(tabId, 'single')

    expect(activeTab().paneIds).toHaveLength(1)
    expect(second && store().panes[second]).toBeUndefined()
    expect(third && store().panes[third]).toBeUndefined()
  })

  it('reassigns the active pane if it was removed', () => {
    const tabId = activeTab().id
    store().setSplitMode(tabId, 'columns-2')
    const secondPane = activeTab().paneIds[1]
    if (!secondPane) throw new Error('expected two panes')

    store().setActivePane(tabId, secondPane)
    expect(activeTab().activePaneId).toBe(secondPane)

    store().setSplitMode(tabId, 'single')
    expect(activeTab().activePaneId).toBe(activeTab().paneIds[0])
    expect(store().panes[activeTab().activePaneId]).toBeDefined()
  })

  it('ignores setActivePane for a pane in another tab', () => {
    const firstTab = activeTab()
    const otherTabId = store().openTab(`${HOME}/A`)
    const foreignPane = store().tabs.find((tab) => tab.id === otherTabId)?.activePaneId
    if (!foreignPane) throw new Error('expected a pane')

    store().setActivePane(firstTab.id, foreignPane)
    const unchanged = store().tabs.find((tab) => tab.id === firstTab.id)
    expect(unchanged?.activePaneId).toBe(firstTab.activePaneId)
  })
})
