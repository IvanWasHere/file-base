/**
 * §M29 acceptance: the icon rail — the six places it holds, and the button
 * that hides the wide sidebar beside it — through the real chrome against the
 * mock filesystem.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import { __resetIdCounter, useWorkspaceStore } from '@/stores/workspaceStore'

const HOME = '/Users/dev'

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

const rail = () => screen.getByRole('navigation', { name: 'Quick places' })
const sidebar = () => screen.queryByRole('navigation', { name: 'Places' })
const rowFor = (name: string) => screen.findByRole('row', { name: new RegExp(`^${name}\\b`) })

/** Where the pane the rail acts on is currently looking. */
function activePath(): string | undefined {
  const state = useWorkspaceStore.getState()
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
  return tab ? state.panes[tab.activePaneId]?.path : undefined
}

beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], panes: {}, activeTabId: null })
  useSelectionStore.setState({ byPane: {} })
  useUiStore.setState({ sidebarOpen: true, previewOpen: false, renaming: null, contextMenu: null })
  __resetIdCounter()
})

describe('the icon rail', () => {
  it('lists the collapse button and six places, in that order', async () => {
    renderApp()
    await rowFor('Documents')

    await waitFor(() =>
      expect(within(rail()).getByRole('button', { name: 'Home' })).toBeInTheDocument(),
    )
    expect(
      within(rail())
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Hide sidebar',
      'Home',
      'Desktop',
      'Documents',
      'Applications',
      'Downloads',
      'Trash',
    ])
  })

  it('sends the active pane to a place when one is pressed', async () => {
    const { user } = renderApp()
    await rowFor('Documents')
    await waitFor(() => within(rail()).getByRole('button', { name: 'Downloads' }))

    await user.click(within(rail()).getByRole('button', { name: 'Downloads' }))
    await waitFor(() => expect(activePath()).toBe(`${HOME}/Downloads`))

    // Applications is not under home, so this also proves the rail uses the
    // paths Go resolved rather than building them from the home directory.
    await user.click(within(rail()).getByRole('button', { name: 'Applications' }))
    await waitFor(() => expect(activePath()).toBe('/Applications'))
  })

  it('marks the place the pane is showing', async () => {
    const { user } = renderApp()
    await rowFor('Documents')
    await waitFor(() => within(rail()).getByRole('button', { name: 'Desktop' }))

    expect(within(rail()).getByRole('button', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'location',
    )

    await user.click(within(rail()).getByRole('button', { name: 'Desktop' }))
    await waitFor(() =>
      expect(within(rail()).getByRole('button', { name: 'Desktop' })).toHaveAttribute(
        'aria-current',
        'location',
      ),
    )
    expect(within(rail()).getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('hides and restores the wide sidebar, and stays put itself', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    expect(sidebar()).toBeInTheDocument()
    await user.click(within(rail()).getByRole('button', { name: 'Hide sidebar' }))

    await waitFor(() => expect(sidebar()).toBeNull())
    // The whole reason the button lives out here: a control that disappeared
    // with the thing it controls could not bring it back.
    expect(rail()).toBeInTheDocument()

    await user.click(within(rail()).getByRole('button', { name: 'Show sidebar' }))
    await waitFor(() => expect(sidebar()).toBeInTheDocument())
  })

  it('agrees with View ▸ Show Sidebar about which way the button points', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    // One piece of state, two controls — the label has to follow the menu as
    // well as its own press.
    useUiStore.getState().toggleSidebar()
    await waitFor(() =>
      expect(within(rail()).getByRole('button', { name: 'Show sidebar' })).toBeInTheDocument(),
    )

    await user.click(within(rail()).getByRole('button', { name: 'Show sidebar' }))
    await waitFor(() =>
      expect(within(rail()).getByRole('button', { name: 'Hide sidebar' })).toBeInTheDocument(),
    )
  })

  it('takes a drag the way the wide sidebar does', async () => {
    renderApp()
    await rowFor('Documents')
    await waitFor(() => within(rail()).getByRole('button', { name: 'Documents' }))

    // Hiding the sidebar must not take away the ability to drag a file into
    // Documents, so the rail carries the same drop path its twin does.
    expect(within(rail()).getByRole('button', { name: 'Documents' })).toHaveAttribute(
      'data-drop-path',
      `${HOME}/Documents`,
    )
  })
})
