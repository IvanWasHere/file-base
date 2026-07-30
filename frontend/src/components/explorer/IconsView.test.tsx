/**
 * Icon-grid specifics: Up/Down must move a whole row, Left/Right one item.
 *
 * The test viewport is 1000px wide (see src/test/setup.ts); with the 108px
 * minimum tile of the large grid that yields 9 columns.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExplorerPane } from '@/features/explorer/ExplorerPane'
import { createQueryClient } from '@/app/providers/queryClient'
import { DEFAULT_SORT } from '@/services/filesystem/sort'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import type { Pane, ViewMode } from '@/types/workspace'

const PANE_ID = 'pane-icons'
const DOWNLOADS = '/Users/dev/Downloads'

function PaneHarness({ paneId }: { paneId: string }) {
  const pane = useWorkspaceStore((state) => state.panes[paneId])
  if (!pane) return null
  return <ExplorerPane pane={pane} index={0} isActive showLetter={false} onFocus={vi.fn()} />
}

function renderGrid(viewMode: ViewMode = 'large-icons', path = DOWNLOADS) {
  const pane: Pane = {
    id: PANE_ID,
    path,
    history: [path],
    historyIndex: 0,
    viewMode,
    sort: DEFAULT_SORT,
  }

  useWorkspaceStore.setState({
    tabs: [
      { id: 'tab-1', paneIds: [PANE_ID], activePaneId: PANE_ID, splitMode: 1, paneSizes: [1] },
    ],
    panes: { [PANE_ID]: pane },
    activeTabId: 'tab-1',
  })

  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={createQueryClient()}>
        <PaneHarness paneId={PANE_ID} />
      </QueryClientProvider>,
    ),
  }
}

const selectedNames = () =>
  screen
    .getAllByRole('row')
    .filter((row) => row.getAttribute('aria-selected') === 'true')
    .map((row) => within(row).getAllByRole('gridcell')[0]?.parentElement?.textContent?.trim())

const grid = () => screen.getByRole('grid', { name: 'Folder contents' })

beforeEach(() => {
  useSelectionStore.setState({ byPane: {} })
  useUiStore.setState({ previewOpen: false, sidebarOpen: true, showHiddenFiles: false })
})

describe('icon grid', () => {
  it('renders tiles rather than a column header row', async () => {
    renderGrid()
    expect(await screen.findByRole('row', { name: /Figma-Desktop-Setup/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader')).toBeNull()
  })

  it('moves one item at a time with Left/Right', async () => {
    const { user } = renderGrid()
    await screen.findByRole('row', { name: /Figma-Desktop-Setup/ })

    grid().focus()
    await user.keyboard('{ArrowRight}')
    expect(selectedNames()).toEqual(['Figma-Desktop-Setup.dmg'])

    await user.keyboard('{ArrowRight}')
    expect(selectedNames()).toEqual(['node-v20.11.0-x64.pkg'])
  })

  it('clamps a row jump to the last item when the grid is one row deep', async () => {
    const { user } = renderGrid()
    await screen.findByRole('row', { name: /Figma-Desktop-Setup/ })

    grid().focus()
    await user.keyboard('{ArrowRight}')
    // Four items across nine columns: one row, so Down clamps to the end
    // rather than moving to a row that does not exist.
    await user.keyboard('{ArrowDown}')
    expect(selectedNames()).toEqual(['wallpaper-collection.zip'])
  })

  it('supports Cmd+A and Escape like the list view', async () => {
    const { user } = renderGrid()
    await screen.findByRole('row', { name: /Figma-Desktop-Setup/ })

    grid().focus()
    await user.keyboard('{Meta>}a{/Meta}')
    expect(selectedNames()).toHaveLength(4)

    await user.keyboard('{Escape}')
    expect(selectedNames()).toHaveLength(0)
  })

  it('Shift-click selects a range in display order', async () => {
    const { user } = renderGrid()

    await user.click(await screen.findByRole('row', { name: /Figma-Desktop-Setup/ }))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('row', { name: /project-backup-jan/ }))
    await user.keyboard('{/Shift}')

    expect(selectedNames()).toHaveLength(3)
  })

  it('renders every icon size', async () => {
    for (const mode of ['medium-icons', 'small-icons'] as const) {
      const { unmount } = renderGrid(mode)
      expect(await screen.findByRole('row', { name: /Figma-Desktop-Setup/ })).toBeInTheDocument()
      unmount()
    }
  })
})
