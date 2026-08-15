/**
 * M2/M3 acceptance: the full chrome, driven by the workspace store, against the
 * mock filesystem.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { __resetIdCounter, useWorkspaceStore } from '@/stores/workspaceStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'

function renderApp() {
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={createQueryClient()}>
        <ExplorerLayout />
      </QueryClientProvider>,
    ),
  }
}

type User = ReturnType<typeof userEvent.setup>

const rowFor = (name: string) => screen.findByRole('row', { name: new RegExp(`^${name}\\b`) })

beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], panes: {}, activeTabId: null })
  useSelectionStore.setState({ byPane: {} })
  useUiStore.setState({ previewOpen: false, sidebarOpen: true, showHiddenFiles: false })
  __resetIdCounter()
})

describe('chrome', () => {
  it('renders tab bar, toolbar, sidebar, panes and status bar', async () => {
    renderApp()

    expect(await screen.findByRole('tablist', { name: 'Open tabs' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Places' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Split layout:/ })).toBeInTheDocument()
    expect(await rowFor('Documents')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Single Pane \/ Details/)).toBeInTheDocument())
  })

  it('starts at the home directory', async () => {
    renderApp()
    await rowFor('Documents')
    expect(useWorkspaceStore.getState().tabs).toHaveLength(1)
  })
})

describe('navigation', () => {
  it('enables Back after navigating and returns on click', async () => {
    const { user } = renderApp()

    const back = await screen.findByRole('button', { name: 'Back' })
    expect(back).toBeDisabled()

    await user.dblClick(await rowFor('Documents'))
    expect(await rowFor('Annual Report 2024\\.pdf')).toBeInTheDocument()
    expect(back).toBeEnabled()

    await user.click(back)
    expect(await rowFor('Downloads')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Forward' })).toBeEnabled()
  })

  it('goes up to the parent folder', async () => {
    const { user } = renderApp()

    await user.dblClick(await rowFor('Documents'))
    await rowFor('Annual Report 2024\\.pdf')

    await user.click(screen.getByRole('button', { name: 'Up' }))
    expect(await rowFor('Downloads')).toBeInTheDocument()
  })

  it('navigates from the sidebar', async () => {
    const { user } = renderApp()

    const sidebar = await screen.findByRole('navigation', { name: 'Places' })
    await user.click(within(sidebar).getByRole('button', { name: 'Downloads' }))

    expect(await rowFor('project-backup-jan\\.zip')).toBeInTheDocument()
  })
})

describe('tabs', () => {
  it('opens and switches tabs', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2))

    const [first, second] = screen.getAllByRole('tab')
    expect(second).toHaveAttribute('aria-selected', 'true')

    if (!first) throw new Error('expected a first tab')
    await user.click(first)
    expect(first).toHaveAttribute('aria-selected', 'true')
  })

  it('closes a tab', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2))

    const closeButtons = screen.getAllByRole('button', { name: /^Close / })
    await user.click(closeButtons[1] as HTMLElement)

    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1))
  })

  it('keeps navigation independent between tabs', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('button', { name: 'New tab' }))
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2))

    await user.dblClick(await rowFor('Downloads'))
    expect(await rowFor('project-backup-jan\\.zip')).toBeInTheDocument()

    const [first] = screen.getAllByRole('tab')
    if (!first) throw new Error('expected a first tab')
    await user.click(first)

    // The first tab never left home.
    expect(await rowFor('Documents')).toBeInTheDocument()
  })
})

describe('splits', () => {
  /** The split control is a dropdown since §M16, not four buttons. */
  async function chooseSplit(user: User, label: string) {
    await user.click(screen.getByRole('button', { name: /^Split layout:/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: label }))
  }

  it('creates panes and labels them', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await chooseSplit(user, '2 Columns')

    expect(await screen.findByRole('region', { name: 'Pane A' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Pane B' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize columns' })).toBeInTheDocument()
  })

  // The heart of §M16: four panes are two rows of two, so there is one column
  // divider spanning both rows and one row divider — not three column dividers.
  it('lays four panes out as a 2 × 2 grid', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await chooseSplit(user, '2 × 2 Grid')

    expect(await screen.findByRole('region', { name: 'Pane D' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByRole('separator')).toHaveLength(2))

    const columnDivider = screen.getByRole('separator', { name: 'Resize columns' })
    const rowDivider = screen.getByRole('separator', { name: 'Resize rows' })
    expect(columnDivider).toHaveAttribute('aria-orientation', 'vertical')
    expect(rowDivider).toHaveAttribute('aria-orientation', 'horizontal')

    const layout = useWorkspaceStore.getState().tabs[0]?.layout
    expect(layout?.columns).toHaveLength(2)
    expect(layout?.rows).toHaveLength(2)

    // Scoped to the status bar's "split / view" pair: the dropdown button now
    // prints the same name, which is the single-source change working.
    await waitFor(() => expect(screen.getByText(/2 × 2 Grid \/ Details/)).toBeInTheDocument())
  })

  // §M17: the menu is pictograms only. The tiles have no text, so their
  // accessible names are the only thing naming them — which is also what makes
  // them findable here.
  it('offers nine layouts as unlabelled tiles', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('button', { name: /^Split layout:/ }))
    const menu = await screen.findByRole('menu', { name: 'Split layout' })
    const tiles = within(menu).getAllByRole('menuitemradio')

    expect(tiles).toHaveLength(9)
    // No visible text anywhere in the menu; the pictograms carry it.
    expect(menu.textContent).toBe('')
    expect(tiles.map((tile) => tile.getAttribute('aria-label'))).toEqual([
      'Single Pane',
      '2 Columns',
      '2 Rows',
      '3 Columns',
      'Split Top',
      'Split Bottom',
      'Split Left',
      'Split Right',
      '2 × 2 Grid',
    ])
  })

  // The control is pictograms end to end: the button prints no name either, so
  // its width cannot change with the layout and shunt the breadcrumb along.
  it('shows no text on the button, whatever is selected', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    const button = screen.getByRole('button', { name: /^Split layout:/ })
    expect(button.textContent).toBe('')

    await chooseSplit(user, 'Split Bottom')
    await waitFor(() =>
      expect(useWorkspaceStore.getState().tabs[0]?.splitMode).toBe('split-bottom'),
    )

    // Still no text, and the name is still reachable — as the accessible name
    // and the tooltip, and in the status bar.
    const after = screen.getByRole('button', { name: 'Split layout: Split Bottom' })
    expect(after.textContent).toBe('')
    expect(after).toHaveAttribute('title', 'Split layout: Split Bottom')
    expect(screen.getByText(/Split Bottom \/ Details/)).toBeInTheDocument()
  })

  it('stacks two panes for 2 Rows', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await chooseSplit(user, '2 Rows')

    await screen.findByRole('region', { name: 'Pane B' })
    expect(useWorkspaceStore.getState().tabs[0]?.layout).toEqual({
      columns: [1],
      rows: [0.5, 0.5],
    })
    // One divider, and it is the horizontal one.
    const dividers = screen.getAllByRole('separator')
    expect(dividers).toHaveLength(1)
    expect(dividers[0]).toHaveAttribute('aria-orientation', 'horizontal')
  })

  // The heart of §M17: a divider stops where the panes on either side of it
  // stop being different.
  it('stops Split Top’s column divider at the row boundary', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await chooseSplit(user, 'Split Top')
    await screen.findByRole('region', { name: 'Pane C' })

    expect(screen.getAllByRole('separator')).toHaveLength(2)
    const columnDivider = screen.getByRole('separator', { name: 'Resize columns' })
    const rowDivider = screen.getByRole('separator', { name: 'Resize rows' })

    // The column divider covers the top row only; the row divider spans both
    // columns and so is marked as a full-length one.
    expect(columnDivider).not.toHaveAttribute('data-full-span')
    expect(columnDivider).toHaveStyle({ top: '0%', height: '50%' })
    expect(rowDivider).toHaveAttribute('data-full-span')
    expect(rowDivider).toHaveStyle({ left: '0%', width: '100%' })
  })

  it('confines Split Left’s row divider to the left column', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await chooseSplit(user, 'Split Left')
    await screen.findByRole('region', { name: 'Pane C' })

    const rowDivider = screen.getByRole('separator', { name: 'Resize rows' })
    expect(rowDivider).not.toHaveAttribute('data-full-span')
    expect(rowDivider).toHaveStyle({ left: '0%', width: '50%' })
    // …while the column divider still runs the whole way down.
    expect(screen.getByRole('separator', { name: 'Resize columns' })).toHaveAttribute(
      'data-full-span',
    )
  })

  // Dragging the divider inside the subdivided half must not disturb the pane
  // that spans across it.
  it('leaves Split Top’s wide pane alone when the column split moves', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await chooseSplit(user, 'Split Top')
    const divider = await screen.findByRole('separator', { name: 'Resize columns' })
    divider.focus()
    await user.keyboard('{ArrowRight}')

    const layout = useWorkspaceStore.getState().tabs[0]?.layout
    expect(layout?.columns[0]).toBeGreaterThan(0.5)
    expect(layout?.columns.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
    // The rows — which is what the full-width pane's height follows — untouched.
    expect(layout?.rows).toEqual([0.5, 0.5])
  })

  it('switches between two three-pane layouts without disturbing the panes', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await chooseSplit(user, '3 Columns')
    await screen.findByRole('region', { name: 'Pane C' })
    const before = [...(useWorkspaceStore.getState().tabs[0]?.paneIds ?? [])]

    await chooseSplit(user, 'Split Right')
    await waitFor(() => expect(useWorkspaceStore.getState().tabs[0]?.splitMode).toBe('split-right'))

    expect(useWorkspaceStore.getState().tabs[0]?.paneIds).toEqual(before)
    expect(screen.getByRole('region', { name: 'Pane C' })).toBeInTheDocument()
  })

  // Three columns still means three columns; only the fourth mode changed.
  it('keeps three columns in one row', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await chooseSplit(user, '3 Columns')

    await screen.findByRole('region', { name: 'Pane C' })
    expect(useWorkspaceStore.getState().tabs[0]?.layout.rows).toEqual([1])
    // Two dividers between three columns, and no row divider at all.
    await waitFor(() => expect(screen.getAllByRole('separator')).toHaveLength(2))
    expect(screen.queryByRole('separator', { name: 'Resize rows' })).toBeNull()
  })

  it('navigates panes independently', async () => {
    const { user } = renderApp()
    await rowFor('Documents')
    await chooseSplit(user, '2 Columns')

    const paneA = await screen.findByRole('region', { name: 'Pane A' })
    await user.dblClick(await within(paneA).findByRole('row', { name: /^Downloads/ }))

    expect(await within(paneA).findByRole('row', { name: /project-backup/ })).toBeInTheDocument()

    // Pane B stayed at home.
    const paneB = screen.getByRole('region', { name: 'Pane B' })
    expect(await within(paneB).findByRole('row', { name: /^Documents/ })).toBeInTheDocument()
  })

  it('collapsing back to one pane keeps the active pane', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await chooseSplit(user, '3 Columns')
    await screen.findByRole('region', { name: 'Pane C' })

    await chooseSplit(user, 'Single Pane')

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Pane B' })).toBeNull())
    expect(await rowFor('Documents')).toBeInTheDocument()
  })

  it('resizes columns with the divider keyboard controls', async () => {
    const { user } = renderApp()
    await rowFor('Documents')
    await chooseSplit(user, '2 Columns')

    const before = [...(useWorkspaceStore.getState().tabs[0]?.layout.columns ?? [])]
    const divider = await screen.findByRole('separator', { name: 'Resize columns' })
    divider.focus()
    await user.keyboard('{ArrowRight}')

    const after = useWorkspaceStore.getState().tabs[0]?.layout.columns ?? []
    expect(after[0]).toBeGreaterThan(before[0] ?? 0)
    expect(after.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
  })

  // A horizontal divider that answered to Left/Right would be the kind of
  // detail that makes keyboard support feel bolted on (§M16 decision 5).
  it('resizes rows with Up and Down, and ignores Left and Right', async () => {
    const { user } = renderApp()
    await rowFor('Documents')
    await chooseSplit(user, '2 × 2 Grid')

    const divider = await screen.findByRole('separator', { name: 'Resize rows' })
    divider.focus()

    await user.keyboard('{ArrowRight}')
    expect(useWorkspaceStore.getState().tabs[0]?.layout.rows).toEqual([0.5, 0.5])

    await user.keyboard('{ArrowDown}')
    const rows = useWorkspaceStore.getState().tabs[0]?.layout.rows ?? []
    expect(rows[0]).toBeGreaterThan(0.5)
    expect(rows.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)

    // The columns were not touched by a row drag.
    expect(useWorkspaceStore.getState().tabs[0]?.layout.columns).toEqual([0.5, 0.5])
  })
})

describe('view modes', () => {
  it('switches to an icon grid via the view menu', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('button', { name: /Details/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Large Icons' }))

    // Icon views have no column headers.
    await waitFor(() => expect(screen.queryByRole('columnheader')).toBeNull())
    expect(await rowFor('Documents')).toBeInTheDocument()
    // Scoped to the status bar — "Large Icons" also labels the menu button.
    await waitFor(() => expect(screen.getByText(/Single Pane \/ Large Icons/)).toBeInTheDocument())
  })

  it('closes the view menu on Escape', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('button', { name: /Details/ }))
    expect(await screen.findByRole('menu', { name: 'View mode' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'View mode' })).toBeNull())
  })
})

describe('preview and status bar', () => {
  it('opens the preview when a file is selected, and shows its metadata', async () => {
    const { user } = renderApp()

    await user.dblClick(await rowFor('Documents'))
    await user.click(await rowFor('Resume\\.pdf'))

    const preview = await screen.findByRole('complementary', { name: 'Preview' })
    expect(within(preview).getByText('Resume.pdf')).toBeInTheDocument()
  })

  /**
   * Browsing is mostly clicking through folders, and the panel has nothing to
   * add about one that the listing does not already show — so taking width away
   * from the listing every time is the wrong trade.
   */
  it('leaves the preview shut when a folder is selected', async () => {
    const { user } = renderApp()

    await user.click(await rowFor('Documents'))
    await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument())

    expect(screen.queryByRole('complementary', { name: 'Preview' })).toBeNull()
  })

  // Adding a file to a selection that began with a folder still reveals it,
  // which is why the guard tracks whether a *file* is selected rather than
  // whether anything is.
  it('opens the preview when a file joins a folder selection', async () => {
    const { user } = renderApp()

    await user.dblClick(await rowFor('Documents'))
    await user.click(await rowFor('Work'))
    expect(screen.queryByRole('complementary', { name: 'Preview' })).toBeNull()

    await user.keyboard('{Meta>}')
    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{/Meta}')

    expect(await screen.findByRole('complementary', { name: 'Preview' })).toBeInTheDocument()
  })

  it('reports the selected count', async () => {
    const { user } = renderApp()

    await user.click(await rowFor('Documents'))
    await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument())
  })

  it('clears the selection when the pane navigates', async () => {
    const { user } = renderApp()

    // Opened by hand: a folder no longer reveals it, and this test is about the
    // selection being dropped rather than about what opens the panel.
    await rowFor('Documents')
    await user.click(screen.getByRole('button', { name: 'Toggle preview' }))
    await screen.findByRole('complementary', { name: 'Preview' })

    await user.click(await rowFor('Documents'))
    await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument())

    // Navigating elsewhere must not leave a stale count pointing at an item
    // that is no longer listed.
    await user.dblClick(await rowFor('Downloads'))
    await rowFor('project-backup-jan\\.zip')

    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull())
    const preview = screen.getByRole('complementary', { name: 'Preview' })
    expect(within(preview).getByText('Select an item to see its details')).toBeInTheDocument()
  })

  it('toggles the preview from the toolbar', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('button', { name: 'Toggle preview' }))
    expect(await screen.findByRole('complementary', { name: 'Preview' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close preview' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Preview' })).toBeNull())
  })
})
