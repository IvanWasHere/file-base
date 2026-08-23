/**
 * M11 acceptance: context menus, the shortcut registry and the native menu,
 * driven through the real chrome against the mock filesystem.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { bridge } from '@/services/bridge'
import { __emitMenuCommand } from '@/services/bridge/impl/mock'
import { useClipboardStore } from '@/stores/clipboardStore'
import { useHistoryStore } from '@/stores/historyStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useToastStore } from '@/stores/toastStore'
import { useUiStore } from '@/stores/uiStore'
import { __resetIdCounter, useWorkspaceStore } from '@/stores/workspaceStore'

const HOME = '/Users/dev'
const DOCUMENTS = `${HOME}/Documents`

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

/** The pane the commands act on, read straight from the store. */
function activePane() {
  const state = useWorkspaceStore.getState()
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
  return tab ? state.panes[tab.activePaneId] : undefined
}

function selectedPaths(): string[] {
  return Object.values(useSelectionStore.getState().byPane).flatMap((pane) => [...pane.selected])
}

async function goToDocuments(user: User) {
  await user.dblClick(await rowFor('Documents'))
  await rowFor('Resume\\.pdf')
}

/** The scrollable listing — the element the shortcut guards care about. */
const listing = () => screen.getByRole('grid', { name: 'Folder contents' })

/** The sidebar. Scoped lookups, because the breadcrumb repeats folder names. */
const places = () => screen.getByRole('navigation', { name: 'Places' })

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
  })
  useClipboardStore.setState({ paths: [], mode: null, sourceDir: null })
  useHistoryStore.setState({ entries: [] })
  useToastStore.getState().clear()
  __resetIdCounter()
})

describe('context menus', () => {
  it('offers file commands on a file and folder commands on a folder', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Resume\\.pdf') })
    let menu = await contextMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    // Only a folder can be opened in a tab.
    expect(within(menu).queryByRole('menuitem', { name: 'Open in New Tab' })).toBeNull()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Context menu' })).toBeNull())

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Work') })
    menu = await contextMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Open in New Tab' })).toBeInTheDocument()
  })

  it('selects the item under the pointer when it was not already selected', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Meeting Notes\\.docx') })

    // Right-clicking elsewhere moves the selection, so the menu's commands act
    // on what the user pointed at rather than on what happened to be selected.
    expect(selectedPaths()).toEqual([`${DOCUMENTS}/Meeting Notes.docx`])
  })

  // Finder's behaviour, and the reason the row's mousedown ignores button 2:
  // collapsing a six-item selection because the user right-clicked inside it
  // would turn "Move to Trash" into a one-file operation.
  it('leaves an existing multi-selection alone', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Meta>}')
    await user.click(await rowFor('Meeting Notes\\.docx'))
    await user.keyboard('{/Meta}')
    expect(selectedPaths()).toHaveLength(2)

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Resume\\.pdf') })
    expect(selectedPaths()).toHaveLength(2)
  })

  it('shows the background menu on empty space, with nothing selected', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.pointer({ keys: '[MouseRight]', target: listing() })

    const menu = await contextMenu()
    expect(within(menu).getByRole('menuitem', { name: 'New Folder' })).toBeInTheDocument()
    expect(selectedPaths()).toEqual([])
  })

  // The details rows span the full width, so the 10px strip down the left edge
  // is the only "empty space" there is — right-clicking it must reach the
  // folder being shown even though a row sits underneath.
  it('shows the background menu from the details gutter', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('details-gutter') })

    const menu = await contextMenu()
    expect(within(menu).getByRole('menuitem', { name: 'New Folder' })).toBeInTheDocument()
    expect(selectedPaths()).toEqual([])
  })

  // Paste follows the selection, and a right-click selects what it points at —
  // so this row is "paste into that folder" without opening it.
  it('offers Paste on a folder', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Meta>}c{/Meta}')

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Work') })
    const menu = await contextMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Paste' })).toBeEnabled()
  })

  it('runs the command that was picked', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Resume\\.pdf') })
    const menu = await contextMenu()
    await user.click(within(menu).getByRole('menuitem', { name: 'Copy' }))

    expect(useClipboardStore.getState().paths).toEqual([`${DOCUMENTS}/Resume.pdf`])
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Context menu' })).toBeNull())
  })

  it('traverses with the keyboard and activates with Enter', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Resume\\.pdf') })
    const menu = await contextMenu()

    // Focus is on the panel, and the cursor is reported through
    // aria-activedescendant rather than by moving focus row to row.
    await waitFor(() => expect(document.activeElement).toBe(menu))
    const first = menu.getAttribute('aria-activedescendant')
    await user.keyboard('{ArrowDown}')
    expect(menu.getAttribute('aria-activedescendant')).not.toBe(first)

    // Type-ahead jumps by first letter, as menus do.
    await user.keyboard('c')
    await user.keyboard('{Enter}')
    expect(useClipboardStore.getState().paths).toEqual([`${DOCUMENTS}/Resume.pdf`])
  })

  it('greys out commands that cannot run instead of hiding them', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.pointer({ keys: '[MouseRight]', target: listing() })
    const menu = await contextMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Paste' })).toBeDisabled()
  })

  it('shows only the half of the favorites toggle that applies', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Work') })
    let menu = await contextMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Remove from Favorites' })).toBeNull()
    await user.click(within(menu).getByRole('menuitem', { name: 'Add to Favorites' }))

    // The sidebar is the visible half of the same state.
    await waitFor(() =>
      expect(within(places()).getByRole('button', { name: 'Work' })).toBeInTheDocument(),
    )

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Work') })
    menu = await contextMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Remove from Favorites' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Add to Favorites' })).toBeNull()
  })
})

describe('the shortcut registry', () => {
  it('renames with Enter and opens with Cmd+O', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    // The M4 binding, changed here on purpose: Finder renames on Enter.
    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Enter}')
    await screen.findByRole('textbox', { name: 'Rename Resume.pdf' })
    await user.keyboard('{Escape}')

    await user.click(await rowFor('Work'))
    await user.keyboard('{Meta>}o{/Meta}')
    await waitFor(() => expect(activePane()?.path).toBe(`${DOCUMENTS}/Work`))
  })

  it('switches view mode with Cmd+1..4', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    listing().focus()

    await user.keyboard('{Meta>}2{/Meta}')
    await waitFor(() => expect(activePane()?.viewMode).toBe('large-icons'))
    await user.keyboard('{Meta>}1{/Meta}')
    await waitFor(() => expect(activePane()?.viewMode).toBe('details'))
  })

  it('navigates back with Cmd+[ and up with Cmd+Up', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    // Named by key code: `[` and `]` are userEvent's own syntax otherwise.
    await user.keyboard('{Meta>}[BracketLeft]{/Meta}')
    await waitFor(() => expect(activePane()?.path).toBe(HOME))

    await user.keyboard('{Meta>}[BracketRight]{/Meta}')
    await waitFor(() => expect(activePane()?.path).toBe(DOCUMENTS))

    await user.keyboard('{Meta>}{ArrowUp}{/Meta}')
    await waitFor(() => expect(activePane()?.path).toBe(HOME))
  })

  // Cmd+Arrow is navigation between folders; a plain arrow moves the cursor
  // inside one. Before M11 the list claimed the arrows unconditionally and
  // would have shadowed all four of the Cmd variants.
  it('leaves plain arrows to the list', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{ArrowUp}')

    expect(activePane()?.path).toBe(DOCUMENTS)
    expect(selectedPaths()).toEqual([`${DOCUMENTS}/Project Roadmap.pptx`])
  })

  it('toggles the preview panel with Space', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    listing().focus()

    const before = useUiStore.getState().previewOpen
    await user.keyboard(' ')
    await waitFor(() => expect(useUiStore.getState().previewOpen).toBe(!before))
  })

  // Found by pressing Space in the running app: selecting an item opens the
  // preview, and that rule was written as "something is selected and the panel
  // is shut" — so closing it reopened it on the next render. The toggle looked
  // dead whenever a file was highlighted, which is most of the time.
  it('closes the preview even while something is selected', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await waitFor(() => expect(useUiStore.getState().previewOpen).toBe(true))

    await user.keyboard(' ')
    await waitFor(() => expect(useUiStore.getState().previewOpen).toBe(false))
    // Still shut a beat later — the reopen was a render-driven snap-back.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useUiStore.getState().previewOpen).toBe(false)
  })

  // Space is also the first character of no filename anyone searches for, which
  // is why type-ahead gives it up — but only when the buffer is empty.
  it('still types a space into an in-progress type-ahead', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    listing().focus()

    await user.keyboard('meeting notes')
    expect(useUiStore.getState().previewOpen).toBe(true) // opened by the selection
    expect(selectedPaths()).toEqual([`${DOCUMENTS}/Meeting Notes.docx`])
  })

  it('is inert while a name is being typed', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Enter}')
    const editor = await screen.findByRole('textbox', { name: 'Rename Resume.pdf' })
    await user.clear(editor)

    // Cmd+C in a text field copies text. If the registry fired here it would
    // put the *file* on the clipboard instead.
    await user.keyboard('{Meta>}c{/Meta}')
    expect(useClipboardStore.getState().paths).toEqual([])

    await user.keyboard('{Escape}')
  })

  it('is inert while a dialog is open', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Shift>}{Backspace}{/Shift}')
    await screen.findByRole('dialog')

    // The dialog owns the keyboard until it is answered.
    await user.keyboard('{Meta>}c{/Meta}')
    expect(useClipboardStore.getState().paths).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await bridge.fs.exists(`${DOCUMENTS}/Resume.pdf`)).toBe(true)
  })

  it('works with focus outside the listing', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    // Focus lands on a sidebar button — before M11 the operation shortcuts were
    // attached to the pane and every one of them died here. Scoped to the
    // sidebar, since the breadcrumb offers a "Documents" button too.
    within(places()).getByRole('button', { name: 'Documents' }).focus()

    await user.keyboard('{Meta>}c{/Meta}')
    expect(useClipboardStore.getState().paths).toEqual([`${DOCUMENTS}/Resume.pdf`])
  })

  // Enter and Space on a focused button must press the button.
  it('does not steal bare keys from a focused control', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    const downloads = within(places()).getByRole('button', { name: 'Downloads' })
    downloads.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(activePane()?.path).toBe(`${HOME}/Downloads`))
    expect(useUiStore.getState().renaming).toBeNull()
  })
})

describe('the native menu', () => {
  it('dispatches a command id from Go through the same handlers', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await user.click(await rowFor('Resume\\.pdf'))

    __emitMenuCommand('edit.copy')

    await waitFor(() =>
      expect(useClipboardStore.getState().paths).toEqual([`${DOCUMENTS}/Resume.pdf`]),
    )
  })

  it('respects enablement rather than trusting the menu', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    // Nothing selected: the native menu carries no state, so a stale pick has
    // to be refused here rather than acted on.
    __emitMenuCommand('edit.copy')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useClipboardStore.getState().paths).toEqual([])
  })

  it('ignores an id it does not implement', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await user.click(await rowFor('Resume\\.pdf'))

    // A native menu from an older binary. Nothing should happen, and nothing
    // should throw.
    __emitMenuCommand('file.teleport')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useClipboardStore.getState().paths).toEqual([])
  })
})
