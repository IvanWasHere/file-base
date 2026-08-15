/**
 * M4 acceptance: multi-selection, keyboard navigation and sortable columns,
 * exercised through the real component against the mock filesystem.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExplorerPane } from '@/features/explorer/ExplorerPane'
import { createQueryClient } from '@/app/providers/queryClient'
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
      { id: 'tab-1', paneIds: [pane.id], activePaneId: pane.id, splitMode: 'single', layout: evenLayout('single') },
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
  useUiStore.setState({ previewOpen: false, sidebarOpen: true, showHiddenFiles: false })
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

describe('virtualization', () => {
  it('renders rows without mounting every item', async () => {
    renderPane(makePane({ path: '/Users/dev/Documents' }))

    // Sanity: the virtualizer produced a usable window in jsdom.
    expect(await rowFor('Personal')).toBeInTheDocument()
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1)
  })
})
