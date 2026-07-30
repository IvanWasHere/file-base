import { beforeEach, describe, expect, it } from 'vitest'
import { useSelectionStore } from './selectionStore'

const PANE = 'pane-1'
const ORDERED = ['/a', '/b', '/c', '/d', '/e']

const store = () => useSelectionStore.getState()
const selectionOf = (paneId = PANE) => store().byPane[paneId]
const selectedPaths = (paneId = PANE) => [...(selectionOf(paneId)?.selected ?? [])]

beforeEach(() => {
  useSelectionStore.setState({ byPane: {} })
})

describe('select', () => {
  it('replaces the selection and sets anchor and lead', () => {
    store().select(PANE, '/b')
    store().select(PANE, '/d')

    expect(selectedPaths()).toEqual(['/d'])
    expect(selectionOf()?.anchor).toBe('/d')
    expect(selectionOf()?.lead).toBe('/d')
  })
})

describe('toggle', () => {
  it('adds without disturbing the rest', () => {
    store().select(PANE, '/a')
    store().toggle(PANE, '/c')
    expect(selectedPaths().sort()).toEqual(['/a', '/c'])
  })

  it('removes an already-selected item', () => {
    store().select(PANE, '/a')
    store().toggle(PANE, '/c')
    store().toggle(PANE, '/a')
    expect(selectedPaths()).toEqual(['/c'])
  })

  it('moves the anchor off a deselected item so Shift still works', () => {
    store().select(PANE, '/a')
    store().toggle(PANE, '/c')
    store().toggle(PANE, '/c')

    expect(selectionOf()?.anchor).toBe('/a')
  })

  it('clears the anchor when the last item is deselected', () => {
    store().select(PANE, '/a')
    store().toggle(PANE, '/a')

    expect(selectedPaths()).toEqual([])
    expect(selectionOf()?.anchor).toBeNull()
  })
})

describe('extendTo', () => {
  it('selects the range from the anchor', () => {
    store().select(PANE, '/b')
    store().extendTo(PANE, '/d', ORDERED)
    expect(selectedPaths()).toEqual(['/b', '/c', '/d'])
  })

  it('keeps the anchor so the range can shrink again', () => {
    store().select(PANE, '/b')
    store().extendTo(PANE, '/e', ORDERED)
    expect(selectedPaths()).toHaveLength(4)

    store().extendTo(PANE, '/c', ORDERED)
    expect(selectedPaths()).toEqual(['/b', '/c'])
    expect(selectionOf()?.anchor).toBe('/b')
  })

  it('anchors on the target when nothing was selected', () => {
    store().extendTo(PANE, '/c', ORDERED)
    expect(selectedPaths()).toEqual(['/c'])
  })

  it('moves the lead to the far end of the range', () => {
    store().select(PANE, '/b')
    store().extendTo(PANE, '/d', ORDERED)
    expect(selectionOf()?.lead).toBe('/d')
  })
})

describe('selectAll and clear', () => {
  it('selects everything', () => {
    store().selectAll(PANE, ORDERED)
    expect(selectedPaths()).toEqual(ORDERED)
  })

  it('clears everything', () => {
    store().selectAll(PANE, ORDERED)
    store().clear(PANE)
    expect(selectedPaths()).toEqual([])
    expect(selectionOf()?.anchor).toBeNull()
  })
})

describe('pane isolation', () => {
  it('keeps selections independent', () => {
    store().select(PANE, '/a')
    store().select('pane-2', '/c')

    expect(selectedPaths(PANE)).toEqual(['/a'])
    expect(selectedPaths('pane-2')).toEqual(['/c'])
  })

  it('discards a pane without touching others', () => {
    store().select(PANE, '/a')
    store().select('pane-2', '/c')

    store().discardPane(PANE)
    expect(selectionOf(PANE)).toBeUndefined()
    expect(selectedPaths('pane-2')).toEqual(['/c'])
  })
})

describe('setSelection', () => {
  it('replaces wholesale, as a marquee drag does', () => {
    store().select(PANE, '/a')
    store().setSelection(PANE, ['/c', '/d'])
    expect(selectedPaths()).toEqual(['/c', '/d'])
  })
})
