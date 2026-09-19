/**
 * §M25 acceptance: Open With — the context menu's submenu, the picker it opens
 * onto, and the shell call underneath both — driven through the real chrome
 * against the mock bridge.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { bridge } from '@/services/bridge'
import { __emitMenuCommand } from '@/services/bridge/impl/mock'
import { useClipboardStore } from '@/stores/clipboardStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useToastStore } from '@/stores/toastStore'
import { useUiStore } from '@/stores/uiStore'
import { FsError } from '@/types/errors'
import { __resetIdCounter, useWorkspaceStore } from '@/stores/workspaceStore'

const HOME = '/Users/dev'
const DOCUMENTS = `${HOME}/Documents`
const MUSIC = `${HOME}/Music`

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
const contextMenu = () => screen.findByRole('menu', { name: 'Context menu' })
const picker = () => screen.findByRole('dialog', { name: 'Open With' })

async function goTo(user: User, folder: string, landmark: string) {
  await user.dblClick(await rowFor(folder))
  await rowFor(landmark)
}

/** Right-clicks a file and opens the Open With flyout beside it. */
async function openFlyout(user: User, file: string) {
  await user.pointer({ keys: '[MouseRight]', target: await rowFor(file) })
  const menu = await contextMenu()
  const row = within(menu).getByRole('menuitem', { name: 'Open With' })
  await user.hover(row)
  return { menu, row }
}

beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], panes: {}, activeTabId: null })
  useSelectionStore.setState({ byPane: {} })
  useUiStore.setState({
    previewOpen: false,
    sidebarOpen: true,
    showHiddenFiles: false,
    dialog: null,
    renaming: null,
    contextMenu: null,
    openWithJob: null,
    hiddenContextCommands: [],
  })
  useClipboardStore.setState({ paths: [], mode: null, sourceDir: null })
  useToastStore.getState().clear()
  __resetIdCounter()
  vi.restoreAllMocks()
})

describe('the Open With submenu', () => {
  it('lists what the system suggests, with the default named', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Resume\\.pdf')

    await openFlyout(user, 'Resume\\.pdf')

    const flyout = await screen.findByRole('menu', { name: 'Open With' })
    await waitFor(() =>
      expect(
        within(flyout).getByRole('menuitem', { name: 'Preview (default)' }),
      ).toBeInTheDocument(),
    )
    expect(within(flyout).getByRole('menuitem', { name: 'TextEdit' })).toBeInTheDocument()
    // The door to everything else, always last.
    expect(within(flyout).getByRole('menuitem', { name: 'Other…' })).toBeInTheDocument()
  })

  it('hands the whole selection to one application', async () => {
    const openWith = vi.spyOn(bridge.shell, 'openWith')
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Resume\\.pdf')

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Meta>}')
    await user.click(await rowFor('Meeting Notes\\.docx'))
    await user.keyboard('{/Meta}')

    await openFlyout(user, 'Resume\\.pdf')
    const flyout = await screen.findByRole('menu', { name: 'Open With' })
    await user.click(await within(flyout).findByRole('menuitem', { name: 'TextEdit' }))

    // One call with both files, not one call each: a dozen photos should
    // arrive in one window (§M25 decision 6).
    expect(openWith).toHaveBeenCalledTimes(1)
    expect(openWith.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([`${DOCUMENTS}/Resume.pdf`, `${DOCUMENTS}/Meeting Notes.docx`]),
    )
    expect(openWith.mock.calls[0]?.[1]).toBe('/Applications/TextEdit.app')
  })

  it('says so when nothing can open the file', async () => {
    const { user } = renderApp()
    await goTo(user, 'Music', 'Midnight Drive\\.mp3')

    await openFlyout(user, 'Midnight Drive\\.mp3')

    const flyout = await screen.findByRole('menu', { name: 'Open With' })
    // A sentence rather than an empty flyout, and Other… still reachable.
    await waitFor(() =>
      expect(
        within(flyout).getByRole('menuitem', { name: 'No applications available' }),
      ).toBeDisabled(),
    )
    expect(within(flyout).getByRole('menuitem', { name: 'Other…' })).toBeEnabled()
  })

  it('is offered on a file and not on a folder', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Resume\\.pdf')

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Resume\\.pdf') })
    expect(
      within(await contextMenu()).getByRole('menuitem', { name: 'Open With' }),
    ).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Context menu' })).toBeNull())

    // A folder resolves to the handful of tools that claim one, and the row
    // that reads "Open With ▸ Finder" is not worth the explanation (§M25
    // decision 9).
    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Work') })
    expect(within(await contextMenu()).queryByRole('menuitem', { name: 'Open With' })).toBeNull()
  })

  it('opens and closes from the keyboard', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Resume\\.pdf')

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Resume\\.pdf') })
    const menu = await contextMenu()

    // Down to Open With, then right into the flyout.
    await user.keyboard('{ArrowDown}{ArrowRight}')
    const flyout = await screen.findByRole('menu', { name: 'Open With' })
    await waitFor(() =>
      expect(menu).toHaveAttribute('aria-activedescendant', expect.stringMatching(/-\d+$/)),
    )

    // Left comes back out, leaving the cursor on the row that owns it.
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Open With' })).toBeNull())
    expect(menu).toHaveAttribute('aria-activedescendant', 'context-menu-item-1')
    expect(flyout).not.toBeInTheDocument()

    // And Escape from there dismisses the menu itself rather than a flyout
    // that is no longer open.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Context menu' })).toBeNull())
  })

  it('can be switched off in Settings like any other row', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Resume\\.pdf')

    useUiStore.getState().setContextCommandVisible('file.openWith', false)

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Resume\\.pdf') })
    const menu = await contextMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Open With' })).toBeNull()
    // The rest of the group is untouched.
    expect(within(menu).getByRole('menuitem', { name: 'Open' })).toBeInTheDocument()
  })
})

describe('the Open With picker', () => {
  it('opens from Other… and offers everything installed', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Resume\\.pdf')

    await openFlyout(user, 'Resume\\.pdf')
    const flyout = await screen.findByRole('menu', { name: 'Open With' })
    await user.click(within(flyout).getByRole('menuitem', { name: 'Other…' }))

    const dialog = await picker()
    expect(within(dialog).getByRole('option', { name: /Preview/ })).toBeInTheDocument()
    // Not suggested for a PDF, but installed — which is the whole point of
    // this list (§M25 decision 7). Terminal lives in Utilities, so finding it
    // proves the one-level descent.
    await waitFor(() =>
      expect(within(dialog).getByRole('option', { name: 'Terminal' })).toBeInTheDocument(),
    )
  })

  it('opens from the menu bar, which cannot list applications itself', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Resume\\.pdf')
    await user.click(await rowFor('Resume\\.pdf'))

    // The native menu's route (§M25 decision 4).
    __emitMenuCommand('file.openWith')

    const dialog = await picker()
    expect(within(dialog).getByText('Open “Resume.pdf” with')).toBeInTheDocument()
  })

  it('filters by name and opens the chosen application', async () => {
    const openWith = vi.spyOn(bridge.shell, 'openWith')
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Resume\\.pdf')
    await user.click(await rowFor('Resume\\.pdf'))
    __emitMenuCommand('file.openWith')

    const dialog = await picker()
    await user.type(within(dialog).getByRole('textbox', { name: 'Search applications' }), 'acorn')

    await waitFor(() =>
      expect(within(dialog).queryByRole('option', { name: 'Terminal' })).toBeNull(),
    )
    await user.click(within(dialog).getByRole('option', { name: 'Acorn' }))
    await user.click(within(dialog).getByRole('button', { name: 'Open' }))

    expect(openWith).toHaveBeenCalledWith([`${DOCUMENTS}/Resume.pdf`], '/Applications/Acorn.app')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Open With' })).toBeNull())
  })

  it('reports a failure rather than closing quietly', async () => {
    vi.spyOn(bridge.shell, 'openWith').mockRejectedValue(
      new FsError('permission-denied', 'not allowed', `${MUSIC}/Midnight Drive.mp3`),
    )
    const { user } = renderApp()
    await goTo(user, 'Music', 'Midnight Drive\\.mp3')

    await openFlyout(user, 'Midnight Drive\\.mp3')
    const flyout = await screen.findByRole('menu', { name: 'Open With' })
    await user.click(within(flyout).getByRole('menuitem', { name: 'Other…' }))

    const dialog = await picker()
    await user.click(await within(dialog).findByRole('option', { name: 'Preview' }))
    await user.click(within(dialog).getByRole('button', { name: 'Open' }))

    await waitFor(() =>
      expect(
        useToastStore.getState().toasts.some((toast) => toast.message.startsWith('Could not open')),
      ).toBe(true),
    )
  })
})
