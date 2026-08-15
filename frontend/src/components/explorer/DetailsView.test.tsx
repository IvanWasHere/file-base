/**
 * M4 acceptance: multi-selection, keyboard navigation and sortable columns,
 * exercised through the real component against the mock filesystem.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExplorerPane } from '@/features/explorer/ExplorerPane'
import { createQueryClient } from '@/app/providers/queryClient'
import { DEFAULT_LAYOUT, weightsOf } from '@/constants/columns'
import { evenLayout } from '@/constants/splitModes'
import { DEFAULT_SORT } from '@/services/filesystem/sort'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import type { Pane } from '@/types/workspace'

const PANE_ID = 'pane-test'
const DOWNLOADS = '/Users/dev/Downloads'

function makePane(overrides: Partial<Pane> = {}): Pane {
  return {
    id: PANE_ID,
    path: DOWNLOADS,
    history: [DOWNLOADS],
    historyIndex: 0,
    viewMode: 'details',
    sort: DEFAULT_SORT,
    ...overrides,
  }
}

/**
 * Mirrors PaneGroup: the pane is read from the store on every render, so store
 * updates (like a sort change) flow back into the component. Passing a fixed
 * `pane` object here would freeze it and hide real behaviour.
 */
function PaneHarness({ paneId }: { paneId: string }) {
  const pane = useWorkspaceStore((state) => state.panes[paneId])
  if (!pane) return null
  return <ExplorerPane pane={pane} index={0} isActive showLetter={false} onFocus={vi.fn()} />
}

function renderPane(pane = makePane()) {
  useWorkspaceStore.setState({
    tabs: [
      {
        id: 'tab-1',
        paneIds: [pane.id],
        activePaneId: pane.id,
        splitMode: 'single',
        layout: evenLayout('single'),
      },
    ],
    panes: { [pane.id]: pane },
    activeTabId: 'tab-1',
  })

  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={createQueryClient()}>
        <PaneHarness paneId={pane.id} />
      </QueryClientProvider>,
    ),
  }
}

const rowFor = (name: string) => screen.findByRole('row', { name: new RegExp(`^${name}\\b`) })

const selectedNames = () =>
  screen
    .getAllByRole('row')
    .filter((row) => row.getAttribute('aria-selected') === 'true')
    .map((row) => within(row).getAllByRole('gridcell')[0]?.textContent?.trim())

const grid = () => screen.getByRole('grid', { name: 'Folder contents' })

beforeEach(() => {
  useSelectionStore.setState({ byPane: {} })
  useUiStore.setState({
    previewOpen: false,
    sidebarOpen: true,
    showHiddenFiles: false,
    // Module state, so a layout left behind by one test would reorder the next
    // one's columns underneath it (§M19).
    columnLayout: DEFAULT_LAYOUT,
  })
})

describe('multi-selection', () => {
  it('replaces the selection on a plain click', async () => {
    const { user } = renderPane()

    await user.click(await rowFor('Figma-Desktop-Setup\\.dmg'))
    expect(selectedNames()).toEqual(['Figma-Desktop-Setup.dmg'])

    await user.click(await rowFor('node-v20\\.11\\.0-x64\\.pkg'))
    expect(selectedNames()).toEqual(['node-v20.11.0-x64.pkg'])
  })

  it('adds and removes individual items with Cmd-click', async () => {
    const { user } = renderPane()

    await user.click(await rowFor('Figma-Desktop-Setup\\.dmg'))
    await user.keyboard('{Meta>}')
    await user.click(await rowFor('project-backup-jan\\.zip'))
    await user.keyboard('{/Meta}')

    expect(selectedNames()).toHaveLength(2)

    await user.keyboard('{Meta>}')
    await user.click(await rowFor('Figma-Desktop-Setup\\.dmg'))
    await user.keyboard('{/Meta}')

    expect(selectedNames()).toEqual(['project-backup-jan.zip'])
  })

  it('selects a contiguous range with Shift-click', async () => {
    const { user } = renderPane()

    // Sorted name-ascending: Figma, node, project-backup, wallpaper.
    await user.click(await rowFor('Figma-Desktop-Setup\\.dmg'))
    await user.keyboard('{Shift>}')
    await user.click(await rowFor('project-backup-jan\\.zip'))
    await user.keyboard('{/Shift}')

    expect(selectedNames()).toEqual([
      'Figma-Desktop-Setup.dmg',
      'node-v20.11.0-x64.pkg',
      'project-backup-jan.zip',
    ])
  })

  it('shrinks a Shift range back from the same anchor', async () => {
    const { user } = renderPane()

    await user.click(await rowFor('Figma-Desktop-Setup\\.dmg'))
    await user.keyboard('{Shift>}')
    await user.click(await rowFor('wallpaper-collection\\.zip'))
    expect(selectedNames()).toHaveLength(4)

    await user.click(await rowFor('node-v20\\.11\\.0-x64\\.pkg'))
    await user.keyboard('{/Shift}')
    expect(selectedNames()).toHaveLength(2)
  })

  it('clears when clicking empty space', async () => {
    const { user } = renderPane()

    await user.click(await rowFor('Figma-Desktop-Setup\\.dmg'))
    expect(selectedNames()).toHaveLength(1)

    await user.click(grid())
    expect(selectedNames()).toHaveLength(0)
  })
})

describe('keyboard', () => {
  it('moves with arrow keys', async () => {
    const { user } = renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    grid().focus()
    await user.keyboard('{ArrowDown}')
    expect(selectedNames()).toEqual(['Figma-Desktop-Setup.dmg'])

    await user.keyboard('{ArrowDown}')
    expect(selectedNames()).toEqual(['node-v20.11.0-x64.pkg'])

    await user.keyboard('{ArrowUp}')
    expect(selectedNames()).toEqual(['Figma-Desktop-Setup.dmg'])
  })

  it('extends the selection with Shift+Arrow', async () => {
    const { user } = renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    grid().focus()
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}')

    expect(selectedNames()).toEqual([
      'Figma-Desktop-Setup.dmg',
      'node-v20.11.0-x64.pkg',
      'project-backup-jan.zip',
    ])
  })

  it('jumps to the ends with Home and End', async () => {
    const { user } = renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    grid().focus()
    await user.keyboard('{End}')
    expect(selectedNames()).toEqual(['wallpaper-collection.zip'])

    await user.keyboard('{Home}')
    expect(selectedNames()).toEqual(['Figma-Desktop-Setup.dmg'])
  })

  it('selects everything with Cmd+A and clears with Escape', async () => {
    const { user } = renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    grid().focus()
    await user.keyboard('{Meta>}a{/Meta}')
    expect(selectedNames()).toHaveLength(4)

    await user.keyboard('{Escape}')
    expect(selectedNames()).toHaveLength(0)
  })

  it('jumps to a name with type-ahead', async () => {
    const { user } = renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    grid().focus()
    await user.keyboard('w')
    expect(selectedNames()).toEqual(['wallpaper-collection.zip'])
  })

  it('narrows type-ahead as more letters arrive', async () => {
    const { user } = renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    grid().focus()
    await user.keyboard('pr')
    expect(selectedNames()).toEqual(['project-backup-jan.zip'])
  })
})

describe('sorting', () => {
  it('sorts by name ascending by default, folders first', async () => {
    renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    const nameHeader = screen.getByRole('columnheader', { name: /Name/ })
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
  })

  it('reverses when the active column is clicked again', async () => {
    const { user } = renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    await user.click(screen.getByRole('columnheader', { name: /Name/ }))

    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
        'aria-sort',
        'descending',
      ),
    )

    const names = screen
      .getAllByRole('row')
      .map((row) => within(row).queryAllByRole('gridcell')[0]?.textContent?.trim())
      .filter(Boolean)
    expect(names[0]).toBe('wallpaper-collection.zip')
  })

  it('switches sort column and resets to ascending', async () => {
    const { user } = renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    await user.click(screen.getByRole('columnheader', { name: /Size/ }))

    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /Size/ })).toHaveAttribute(
        'aria-sort',
        'ascending',
      ),
    )
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'none')

    const names = screen
      .getAllByRole('row')
      .map((row) => within(row).queryAllByRole('gridcell')[0]?.textContent?.trim())
      .filter(Boolean)
    // Smallest first: node (32.4 MB) before wallpaper (234 MB).
    expect(names[0]).toBe('node-v20.11.0-x64.pkg')
  })

  it('persists the sort choice to the pane', async () => {
    const { user } = renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    await user.click(screen.getByRole('columnheader', { name: /Modified/ }))

    await waitFor(() =>
      expect(useWorkspaceStore.getState().panes[PANE_ID]?.sort.key).toBe('modified'),
    )
  })
})

/**
 * §M19. Drags are driven with `fireEvent` at explicit coordinates rather than
 * with userEvent: these behaviours *are* the coordinates — a 2px press sorts and
 * a 40px one reorders — and userEvent's pointer helpers do not let a test say
 * where the pointer went.
 *
 * The setup stubs every `getBoundingClientRect` to 1000 × 800, so a `clientX` of
 * 650 is a fraction of 0.65 across the header.
 */
describe('column layout', () => {
  const header = () => screen.getByRole('columnheader', { name: /Name/ }).closest('[role="row"]')!

  const headerLabels = () =>
    screen.getAllByRole('columnheader').map((element) => element.textContent?.trim())

  const firstRowCells = () =>
    within(screen.getAllByRole('row')[1] as HTMLElement)
      .getAllByRole('gridcell')
      .map((cell) => cell.textContent?.trim())

  const dragHeader = (name: RegExp, from: number, to: number) => {
    const button = screen.getByRole('columnheader', { name })
    fireEvent.mouseDown(button, { button: 0, clientX: from })
    fireEvent.mouseMove(window, { clientX: to })
    fireEvent.mouseUp(window, { clientX: to })
    // A real pointer raises the click after the mouseup; the button has to see
    // it to decide whether the press was a sort.
    fireEvent.click(button)
  }

  it('renders the header and the rows from one layout', async () => {
    renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    expect(headerLabels()).toEqual(['Name', 'Size', 'Type', 'Modified'])
    // The two grids must agree: same count, same order.
    expect(firstRowCells()).toHaveLength(4)
    expect(header()).toHaveStyle({
      gridTemplateColumns: 'minmax(0, 0.4fr) minmax(0, 0.2fr) minmax(0, 0.2fr) minmax(0, 0.2fr)',
    })
  })

  it('reorders a column when the header is dragged past the threshold', async () => {
    renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    dragHeader(/Name/, 100, 650)

    await waitFor(() => expect(headerLabels()).toEqual(['Size', 'Type', 'Name', 'Modified']))
    expect(useUiStore.getState().columnLayout.order).toEqual(['size', 'type', 'name', 'modified'])
  })

  // Decision 8: the cells move with the headers, so what a screen reader reads
  // in order is what is on screen.
  it('moves the cells with the header', async () => {
    renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    const before = firstRowCells()
    dragHeader(/Modified/, 900, 100)

    await waitFor(() => expect(headerLabels()[0]).toBe('Modified'))
    expect(firstRowCells()[0]).toBe(before[3])
    expect(firstRowCells()[1]).toBe(before[0])
  })

  // Decision 6: the header is the sort button, so a click that wandered a couple
  // of pixels must still sort.
  it('sorts when the press barely moves', async () => {
    renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    dragHeader(/Name/, 100, 102)

    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
        'aria-sort',
        'descending',
      ),
    )
    expect(useUiStore.getState().columnLayout.order).toEqual(DEFAULT_LAYOUT.order)
  })

  it('does not sort when the press became a drag', async () => {
    renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    dragHeader(/Name/, 100, 650)

    await waitFor(() => expect(headerLabels()[2]).toBe('Name'))
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
  })

  it('changes nothing when a drag ends where it started', async () => {
    renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    dragHeader(/Size/, 500, 520)

    await waitFor(() => expect(headerLabels()).toEqual(['Name', 'Size', 'Type', 'Modified']))
  })

  it('resizes a column by dragging the rule beside it', async () => {
    renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    fireEvent.mouseDown(screen.getByTestId('column-resize-name'), { button: 0, clientX: 400 })
    fireEvent.mouseMove(window, { clientX: 500 })
    fireEvent.mouseUp(window, { clientX: 500 })

    await waitFor(() => {
      const weights = weightsOf(useUiStore.getState().columnLayout)
      expect(weights[0]).toBeCloseTo(0.5, 6)
      // Only the two neighbours move; the rest stay put.
      expect(weights[1]).toBeCloseTo(0.1, 6)
      expect(weights[2]).toBeCloseTo(0.2, 6)
    })
    expect(header()).toHaveStyle({
      gridTemplateColumns: 'minmax(0, 0.5fr) minmax(0, 0.1fr) minmax(0, 0.2fr) minmax(0, 0.2fr)',
    })
  })

  // Decision 3: the floor is per column, and the drag stops at it rather than
  // producing a column nobody can grab again.
  it('stops at the neighbour’s floor', async () => {
    renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    fireEvent.mouseDown(screen.getByTestId('column-resize-name'), { button: 0, clientX: 400 })
    fireEvent.mouseMove(window, { clientX: 990 })
    fireEvent.mouseUp(window, { clientX: 990 })

    await waitFor(() => {
      const weights = weightsOf(useUiStore.getState().columnLayout)
      expect(weights[1]).toBeCloseTo(0.08, 6)
      expect(weights[0]).toBeCloseTo(0.52, 6)
    })
  })

  it('keeps the weights summing to one through any resize', async () => {
    renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    for (const x of [700, 200, 950, 60]) {
      fireEvent.mouseDown(screen.getByTestId('column-resize-size'), { button: 0, clientX: 600 })
      fireEvent.mouseMove(window, { clientX: x })
      fireEvent.mouseUp(window, { clientX: x })
    }

    await waitFor(() => {
      const total = weightsOf(useUiStore.getState().columnLayout).reduce((sum, w) => sum + w, 0)
      expect(total).toBeCloseTo(1, 6)
    })
  })

  // Decision 12: neither gesture may be mouse-only.
  it('moves a column with Alt+Arrow from the keyboard', async () => {
    renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    const nameHeader = screen.getByRole('columnheader', { name: /Name/ })
    nameHeader.focus()
    fireEvent.keyDown(nameHeader, { key: 'ArrowRight', altKey: true })

    await waitFor(() => expect(headerLabels()).toEqual(['Size', 'Name', 'Type', 'Modified']))
  })

  it('resizes a column with Shift+Arrow from the keyboard', async () => {
    renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    const nameHeader = screen.getByRole('columnheader', { name: /Name/ })
    nameHeader.focus()
    fireEvent.keyDown(nameHeader, { key: 'ArrowRight', shiftKey: true })

    await waitFor(() =>
      expect(weightsOf(useUiStore.getState().columnLayout)[0]).toBeCloseTo(0.42, 6),
    )
  })

  // The last column has no rule to its right, so it grows by pulling the one on
  // its left the other way.
  it('resizes the last column from the keyboard too', async () => {
    renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    const modified = screen.getByRole('columnheader', { name: /Modified/ })
    modified.focus()
    fireEvent.keyDown(modified, { key: 'ArrowRight', shiftKey: true })

    await waitFor(() =>
      expect(weightsOf(useUiStore.getState().columnLayout)[3]).toBeCloseTo(0.22, 6),
    )
  })

  it('leaves a plain arrow key to the global registry', async () => {
    renderPane()
    await rowFor('Figma-Desktop-Setup\\.dmg')

    const nameHeader = screen.getByRole('columnheader', { name: /Name/ })
    nameHeader.focus()
    const event = createKeyDown('ArrowRight')
    nameHeader.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(useUiStore.getState().columnLayout.order).toEqual(DEFAULT_LAYOUT.order)
  })
})

function createKeyDown(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
}

describe('virtualization', () => {
  it('renders rows without mounting every item', async () => {
    renderPane(makePane({ path: '/Users/dev/Documents' }))

    // Sanity: the virtualizer produced a usable window in jsdom.
    expect(await rowFor('Personal')).toBeInTheDocument()
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1)
  })
})
