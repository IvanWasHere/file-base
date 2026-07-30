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
    expect(screen.getByRole('group', { name: 'Split layout' })).toBeInTheDocument()
    expect(await rowFor('Documents')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Single \/ Details/)).toBeInTheDocument())
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
  it('creates panes and labels them', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('button', { name: 'Two panes' }))

    expect(await screen.findByRole('region', { name: 'Pane A' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Pane B' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize pane 1' })).toBeInTheDocument()
  })

  it('supports four panes with three dividers', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('button', { name: 'Four panes' }))

    await waitFor(() => expect(screen.getAllByRole('separator')).toHaveLength(3))
    expect(screen.getByRole('region', { name: 'Pane D' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/4-Way/)).toBeInTheDocument())
  })

  it('navigates panes independently', async () => {
    const { user } = renderApp()
    await rowFor('Documents')
    await user.click(screen.getByRole('button', { name: 'Two panes' }))

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

    await user.click(screen.getByRole('button', { name: 'Three panes' }))
    await screen.findByRole('region', { name: 'Pane C' })

    await user.click(screen.getByRole('button', { name: 'Single pane' }))

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Pane B' })).toBeNull())
    expect(await rowFor('Documents')).toBeInTheDocument()
  })

  it('resizes with the divider keyboard controls', async () => {
    const { user } = renderApp()
    await rowFor('Documents')
    await user.click(screen.getByRole('button', { name: 'Two panes' }))

    const before = [...(useWorkspaceStore.getState().tabs[0]?.paneSizes ?? [])]
    const divider = await screen.findByRole('separator', { name: 'Resize pane 1' })
    divider.focus()
    await user.keyboard('{ArrowRight}')

    const after = useWorkspaceStore.getState().tabs[0]?.paneSizes ?? []
    expect(after[0]).toBeGreaterThan(before[0] ?? 0)
    expect(after.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
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
    await waitFor(() => expect(screen.getByText(/Single \/ Large Icons/)).toBeInTheDocument())
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
  it('opens the preview on selection and shows metadata', async () => {
    const { user } = renderApp()

    await user.click(await rowFor('Documents'))

    const preview = await screen.findByRole('complementary', { name: 'Preview' })
    expect(within(preview).getByText('Documents')).toBeInTheDocument()
    expect(within(preview).getByText('Folder')).toBeInTheDocument()
  })

  it('reports the selected count', async () => {
    const { user } = renderApp()

    await user.click(await rowFor('Documents'))
    await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument())
  })

  it('clears the selection when the pane navigates', async () => {
    const { user } = renderApp()

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
