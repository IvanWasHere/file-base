/**
 * M6 acceptance: file operations driven through the real chrome — toolbar,
 * menus, inline rename, keyboard shortcuts, dialogs and toasts — against the
 * mock filesystem.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { bridge } from '@/services/bridge'
import { __watchCount } from '@/services/filesystem/watch'
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

const rowFor = (name: string) => screen.findByRole('row', { name: new RegExp(`^${name}\\b`) })

type User = ReturnType<typeof userEvent.setup>

/**
 * Opens a top-level menu and returns its popup.
 *
 * The menu-bar buttons carry `role="menuitem"` themselves, so both lookups are
 * scoped — otherwise "File" would be ambiguous with the items inside it.
 */
async function openMenu(user: User, menu: string): Promise<HTMLElement> {
  const menubar = screen.getByRole('menubar', { name: 'Application' })
  await user.click(within(menubar).getByRole('menuitem', { name: menu }))
  return screen.findByRole('menu', { name: menu })
}

async function runMenuCommand(user: User, menu: string, item: string) {
  const popup = await openMenu(user, menu)
  await user.click(within(popup).getByRole('menuitem', { name: item }))
}

/** The seed tree has no files at home, so most operations happen in Documents. */
async function goToDocuments(user: User) {
  await user.dblClick(await rowFor('Documents'))
  await rowFor('Resume\\.pdf')
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
  })
  useClipboardStore.setState({ paths: [], mode: null, sourceDir: null })
  useHistoryStore.setState({ entries: [] })
  useToastStore.getState().clear()
  __resetIdCounter()
})

describe('new folder', () => {
  it('creates one from the toolbar and opens its name for editing', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('button', { name: 'New Folder' }))

    const editor = await screen.findByRole('textbox', { name: 'Rename untitled folder' })
    expect(editor).toHaveFocus()

    await user.keyboard('Reports{Enter}')

    expect(await rowFor('Reports')).toBeInTheDocument()
    expect(await bridge.fs.exists(`${HOME}/Reports`)).toBe(true)
  })

  it('Escape leaves the default name in place rather than discarding the folder', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('button', { name: 'New Folder' }))
    await screen.findByRole('textbox', { name: 'Rename untitled folder' })
    await user.keyboard('{Escape}')

    expect(await bridge.fs.exists(`${HOME}/untitled folder`)).toBe(true)
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  })
})

describe('rename', () => {
  it('renames from the File menu and keeps the extension out of the selection', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await runMenuCommand(user, 'File', 'Rename')

    const editor: HTMLInputElement = await screen.findByRole('textbox', {
      name: 'Rename Resume.pdf',
    })
    // Only the stem is preselected, so typing does not eat the extension.
    expect(editor.selectionStart).toBe(0)
    expect(editor.selectionEnd).toBe('Resume'.length)

    await user.keyboard('CV{Enter}')

    expect(await rowFor('CV\\.pdf')).toBeInTheDocument()
    expect(await bridge.fs.exists(`${DOCUMENTS}/CV.pdf`)).toBe(true)
  })

  // The editor unmounting drops focus to the body, and every shortcut is
  // handled by the pane — so without an explicit hand-back, the first thing the
  // user does after renaming silently does nothing.
  it('returns focus to the list so shortcuts still work afterwards', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    await screen.findByRole('textbox', { name: 'Rename Resume.pdf' })
    await user.keyboard('{Escape}')

    expect(document.activeElement).toBe(screen.getByRole('grid', { name: 'Folder contents' }))

    // Proof it is more than focus bookkeeping: a shortcut lands.
    await user.keyboard('{Meta>}c{/Meta}')
    expect(useClipboardStore.getState().paths).toEqual([`${DOCUMENTS}/Resume.pdf`])
  })

  it('reports a collision without losing either file', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await runMenuCommand(user, 'File', 'Rename')
    const editor = await screen.findByRole('textbox', { name: 'Rename Resume.pdf' })

    await user.clear(editor)
    await user.keyboard('Meeting Notes.docx{Enter}')

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/already exists/)).toBeInTheDocument()
    expect(await bridge.fs.exists(`${DOCUMENTS}/Resume.pdf`)).toBe(true)
    expect(await bridge.fs.exists(`${DOCUMENTS}/Meeting Notes.docx`)).toBe(true)
  })
})

describe('copy and paste', () => {
  it('copies with Cmd+C and pastes into another folder', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Meta>}c{/Meta}')
    expect(useClipboardStore.getState().paths).toEqual([`${DOCUMENTS}/Resume.pdf`])

    await user.dblClick(await rowFor('Work'))
    await rowFor('Contract Draft\\.pdf')
    await user.keyboard('{Meta>}v{/Meta}')

    expect(await rowFor('Resume\\.pdf')).toBeInTheDocument()
    expect(await bridge.fs.exists(`${DOCUMENTS}/Work/Resume.pdf`)).toBe(true)
    // The original stayed put.
    expect(await bridge.fs.exists(`${DOCUMENTS}/Resume.pdf`)).toBe(true)
  })

  it('moves rather than copies after a cut', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Meta>}x{/Meta}')

    await user.dblClick(await rowFor('Work'))
    await rowFor('Contract Draft\\.pdf')
    await user.keyboard('{Meta>}v{/Meta}')

    expect(await rowFor('Resume\\.pdf')).toBeInTheDocument()
    expect(await bridge.fs.exists(`${DOCUMENTS}/Resume.pdf`)).toBe(false)
    // A cut is spent once pasted.
    expect(useClipboardStore.getState().paths).toHaveLength(0)
  })

  // Copying into the folder an item already lives in is Duplicate, not a
  // conflict — it must not raise the dialog.
  it('duplicates in place with Cmd+D', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Meta>}d{/Meta}')

    expect(await rowFor('Resume copy\\.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks how to resolve a name collision and applies the answer', async () => {
    const { user } = renderApp()
    // Plant the collision: Work already holds something called Resume.pdf.
    await bridge.fs.createFile(`${DOCUMENTS}/Work`, 'Resume.pdf')
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Meta>}c{/Meta}')

    await user.dblClick(await rowFor('Work'))
    await rowFor('Contract Draft\\.pdf')
    await user.keyboard('{Meta>}v{/Meta}')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Resume.pdf')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Keep Both' }))

    expect(await rowFor('Resume copy\\.pdf')).toBeInTheDocument()
    expect(await bridge.fs.exists(`${DOCUMENTS}/Work/Resume.pdf`)).toBe(true)
  })

  it('Skip leaves the existing file untouched', async () => {
    const { user } = renderApp()
    await bridge.fs.createFile(`${DOCUMENTS}/Work`, 'Resume.pdf')
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Meta>}c{/Meta}')
    await user.dblClick(await rowFor('Work'))
    await rowFor('Contract Draft\\.pdf')
    await user.keyboard('{Meta>}v{/Meta}')

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Skip' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await bridge.fs.exists(`${DOCUMENTS}/Work/Resume copy.pdf`)).toBe(false)
  })
})

describe('trash, delete and undo', () => {
  it('moves to the trash with Backspace and restores it with Cmd+Z', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Backspace}')

    await waitFor(() => expect(screen.queryByRole('row', { name: /^Resume/ })).toBeNull())
    expect(await bridge.fs.exists(`${DOCUMENTS}/Resume.pdf`)).toBe(false)
    // The selection must not outlive the row.
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull())

    await user.keyboard('{Meta>}z{/Meta}')

    expect(await rowFor('Resume\\.pdf')).toBeInTheDocument()
    expect(await bridge.fs.exists(`${DOCUMENTS}/Resume.pdf`)).toBe(true)
  })

  it('confirms before deleting permanently, and offers no undo afterwards', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await runMenuCommand(user, 'File', 'Delete Immediately…')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByRole('row', { name: /^Resume/ })).toBeNull())
    expect(await bridge.fs.exists(`${DOCUMENTS}/Resume.pdf`)).toBe(false)
    expect(useHistoryStore.getState().entries).toHaveLength(0)
  })

  it('cancelling the confirmation keeps the file', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await runMenuCommand(user, 'File', 'Delete Immediately…')

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(await bridge.fs.exists(`${DOCUMENTS}/Resume.pdf`)).toBe(true)
    expect(await rowFor('Resume\\.pdf')).toBeInTheDocument()
  })

  it('Escape dismisses the confirmation without deleting', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await runMenuCommand(user, 'File', 'Delete Immediately…')
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await bridge.fs.exists(`${DOCUMENTS}/Resume.pdf`)).toBe(true)
  })

  it('trashing a folder takes its contents and undo brings them back', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Work'))
    await user.keyboard('{Backspace}')

    await waitFor(() => expect(screen.queryByRole('row', { name: /^Work/ })).toBeNull())
    expect(await bridge.fs.exists(`${DOCUMENTS}/Work/Contract Draft.pdf`)).toBe(false)

    await user.keyboard('{Meta>}z{/Meta}')

    expect(await rowFor('Work')).toBeInTheDocument()
    await waitFor(async () =>
      expect(await bridge.fs.exists(`${DOCUMENTS}/Work/Contract Draft.pdf`)).toBe(true),
    )
  })
})

// M7 acceptance: the pane reacts to changes it did not initiate.
describe('live updates', () => {
  it('shows a file created behind the app’s back', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    expect(screen.queryByRole('row', { name: /^appeared/ })).toBeNull()

    // Nothing in the UI did this — it is the watcher that has to notice.
    await bridge.fs.createFile(DOCUMENTS, 'appeared.txt')

    expect(await rowFor('appeared\\.txt')).toBeInTheDocument()
  })

  it('drops a row for a file removed behind the app’s back', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await rowFor('Resume\\.pdf')

    await bridge.fs.delete([`${DOCUMENTS}/Resume.pdf`])

    await waitFor(() => expect(screen.queryByRole('row', { name: /^Resume/ })).toBeNull())
  })

  // Two panes on one folder share a single watch and a single refetch; both
  // must still see the change.
  it('updates every pane showing the changed folder', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await user.click(screen.getByRole('button', { name: 'Two panes' }))

    // A new pane opens on the active pane's folder, so both are on Documents.
    const paneA = await screen.findByRole('region', { name: 'Pane A' })
    const paneB = await screen.findByRole('region', { name: 'Pane B' })
    await within(paneA).findByRole('row', { name: /^Resume/ })
    await within(paneB).findByRole('row', { name: /^Resume/ })

    await bridge.fs.createFile(DOCUMENTS, 'appeared.txt')

    expect(await within(paneA).findByRole('row', { name: /^appeared/ })).toBeInTheDocument()
    expect(await within(paneB).findByRole('row', { name: /^appeared/ })).toBeInTheDocument()
  })

  it('shows an error, and stops counting rows, when the folder itself is deleted', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await rowFor('Resume\\.pdf')

    await bridge.fs.delete([DOCUMENTS])

    expect(await screen.findByText('This item no longer exists.')).toBeInTheDocument()
    // The stale listing is still in the query cache; reporting its length beside
    // "no longer exists" would be counting rows nobody can see.
    await waitFor(() => expect(screen.getAllByText('0 items').length).toBeGreaterThan(0))
  })

  it('stops watching a folder once no pane is showing it', async () => {
    const unwatch = vi.spyOn(bridge.watcher, 'unwatch')
    const { user } = renderApp()
    await goToDocuments(user)
    expect(__watchCount(DOCUMENTS)).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Up' }))
    await rowFor('Downloads')

    await waitFor(() => expect(__watchCount(DOCUMENTS)).toBe(0))
    expect(unwatch).toHaveBeenCalledWith(DOCUMENTS)
  })
})

describe('menu state', () => {
  it('greys out selection commands until something is selected', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    let popup = await openMenu(user, 'File')
    expect(within(popup).getByRole('menuitem', { name: 'Move to Trash' })).toBeDisabled()
    await user.keyboard('{Escape}')

    await user.click(await rowFor('Documents'))
    popup = await openMenu(user, 'File')
    expect(within(popup).getByRole('menuitem', { name: 'Move to Trash' })).toBeEnabled()
  })

  it('enables Paste only once something is on the clipboard', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    let popup = await openMenu(user, 'Edit')
    expect(within(popup).getByRole('menuitem', { name: 'Paste' })).toBeDisabled()
    await user.keyboard('{Escape}')

    await user.click(await rowFor('Documents'))
    await user.keyboard('{Meta>}c{/Meta}')

    popup = await openMenu(user, 'Edit')
    expect(within(popup).getByRole('menuitem', { name: 'Paste' })).toBeEnabled()
  })

  it('enables Undo only after something reversible has happened', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    let popup = await openMenu(user, 'Edit')
    expect(within(popup).getByRole('menuitem', { name: 'Undo' })).toBeDisabled()
    await user.keyboard('{Escape}')

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Backspace}')
    await waitFor(() => expect(screen.queryByRole('row', { name: /^Resume/ })).toBeNull())

    popup = await openMenu(user, 'Edit')
    expect(within(popup).getByRole('menuitem', { name: 'Undo' })).toBeEnabled()
  })
})
