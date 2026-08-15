import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ExplorerLayout } from '@/app/layouts/ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { APP_MENUS } from '@/constants/menus'
import { DEFAULT_THEME } from '@/constants/themes'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import { __resetIdCounter, useWorkspaceStore } from '@/stores/workspaceStore'

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
  useUiStore.setState({
    previewOpen: false,
    sidebarOpen: true,
    showHiddenFiles: false,
    theme: DEFAULT_THEME,
  })
  __resetIdCounter()
})

describe('menu bar', () => {
  it('renders every top-level menu', async () => {
    renderApp()
    await rowFor('Documents')

    const menubar = screen.getByRole('menubar', { name: 'Application' })
    for (const menu of APP_MENUS) {
      expect(within(menubar).getByRole('menuitem', { name: menu.label })).toBeInTheDocument()
    }
  })

  it('opens a menu and closes it on Escape', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('menuitem', { name: 'View' }))
    expect(await screen.findByRole('menu', { name: 'View' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'View' })).toBeNull())
  })

  it('switches menus on hover once one is open', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('menuitem', { name: 'File' }))
    expect(await screen.findByRole('menu', { name: 'File' })).toBeInTheDocument()

    await user.hover(screen.getByRole('menuitem', { name: 'Go' }))
    expect(await screen.findByRole('menu', { name: 'Go' })).toBeInTheDocument()
    expect(screen.queryByRole('menu', { name: 'File' })).toBeNull()
  })

  it('opens a new tab from the File menu', async () => {
    const { user } = renderApp()
    await rowFor('Documents')
    expect(screen.getAllByRole('tab')).toHaveLength(1)

    await user.click(screen.getByRole('menuitem', { name: 'File' }))
    await user.click(await screen.findByRole('menuitem', { name: 'New Tab' }))

    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2))
  })

  it('changes the view mode and reflects it as checked', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('menuitem', { name: 'View' }))
    const detailsItem = await screen.findByRole('menuitemcheckbox', { name: 'as Details' })
    expect(detailsItem).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'as Large Icons' }))
    // Scoped to the status bar — the toolbar's view button says this too.
    await waitFor(() => expect(screen.getByText(/Single Pane \/ Large Icons/)).toBeInTheDocument())

    await user.click(screen.getByRole('menuitem', { name: 'View' }))
    expect(await screen.findByRole('menuitemcheckbox', { name: 'as Large Icons' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('toggles the sidebar', async () => {
    const { user } = renderApp()
    await rowFor('Documents')
    expect(screen.getByRole('navigation', { name: 'Places' })).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'View' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Show Sidebar' }))

    await waitFor(() =>
      expect(screen.queryByRole('navigation', { name: 'Places' })).not.toBeInTheDocument(),
    )
  })

  it('shows hidden files when toggled', async () => {
    const { user } = renderApp()
    // Startup is async since M5 (migrations + session query), so the chrome is
    // not queryable until the first listing lands.
    await rowFor('Documents')

    // Downloads holds the seed .DS_Store.
    const sidebar = screen.getByRole('navigation', { name: 'Places' })
    await user.click(within(sidebar).getByRole('button', { name: 'Downloads' }))
    await rowFor('project-backup-jan\\.zip')
    expect(screen.queryByRole('row', { name: /\.DS_Store/ })).toBeNull()

    await user.click(screen.getByRole('menuitem', { name: 'View' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Show Hidden Files' }))

    expect(await rowFor('\\.DS_Store')).toBeInTheDocument()
  })

  // The whole mechanism, end to end: a nested menu row picks a preference, the
  // store carries it, and `services/theme` writes the attribute every colour in
  // the app hangs off (§M12).
  it('changes the theme from the View menu and reflects it as checked', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('menuitem', { name: 'View' }))
    await user.hover(await screen.findByRole('menuitem', { name: 'Theme' }))

    const themeMenu = await screen.findByRole('menu', { name: 'Theme' })
    expect(within(themeMenu).getByRole('menuitemcheckbox', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    // `fireEvent`, not `user.click`, for the row *inside* a flyout: userEvent
    // dispatches the move out of the parent row as `mouseout` with a null
    // `relatedTarget`, so React synthesises a mouseleave on the wrapper that
    // owns the open state and the flyout closes before the click lands. A real
    // pointer reports the element being entered, and the flyout is a DOM
    // descendant of that wrapper, so nothing leaves — checked by hand in the
    // running app (§M12).
    fireEvent.click(within(themeMenu).getByRole('menuitemcheckbox', { name: 'Light' }))

    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'))

    await user.click(screen.getByRole('menuitem', { name: 'View' }))
    await user.hover(await screen.findByRole('menuitem', { name: 'Theme' }))
    const reopened = await screen.findByRole('menu', { name: 'Theme' })
    expect(within(reopened).getByRole('menuitemcheckbox', { name: 'Light' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(reopened).getByRole('menuitemcheckbox', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('navigates from the Go menu', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('menuitem', { name: 'Go' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Downloads' }))

    expect(await rowFor('project-backup-jan\\.zip')).toBeInTheDocument()
  })

  it('disables Back until there is history', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('menuitem', { name: 'Go' }))
    expect(await screen.findByRole('menuitem', { name: 'Back' })).toBeDisabled()

    await user.click(screen.getByRole('menuitem', { name: 'Downloads' }))
    await rowFor('project-backup-jan\\.zip')

    await user.click(screen.getByRole('menuitem', { name: 'Go' }))
    expect(await screen.findByRole('menuitem', { name: 'Back' })).toBeEnabled()
  })

  it('selects and deselects everything from the Edit menu', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    const sidebar = screen.getByRole('navigation', { name: 'Places' })
    await user.click(within(sidebar).getByRole('button', { name: 'Downloads' }))
    await rowFor('project-backup-jan\\.zip')

    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Select All' }))

    await waitFor(() => expect(screen.getByText(/\d+ selected/)).toBeInTheDocument())

    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Deselect All' }))

    await waitFor(() => expect(screen.queryByText(/\d+ selected/)).toBeNull())
  })
})

describe('layout', () => {
  it('puts the tab row below the menu row', async () => {
    renderApp()
    await rowFor('Documents')

    const menubar = screen.getByRole('menubar', { name: 'Application' })
    const tablist = screen.getByRole('tablist', { name: 'Open tabs' })

    // The tab row is a separate sibling element, not nested in the menu strip.
    expect(menubar.contains(tablist)).toBe(false)
    expect(menubar.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
