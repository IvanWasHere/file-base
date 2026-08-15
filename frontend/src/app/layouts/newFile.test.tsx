/**
 * M15 acceptance: quick file creation, driven through the real chrome against
 * the mock filesystem.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { DEFAULT_ALGORITHM } from '@/constants/hashAlgorithms'
import { bridge } from '@/services/bridge'
import { ensureTemplatesFolder } from '@/services/templates/templateService'
import { useClipboardStore } from '@/stores/clipboardStore'
import { useHistoryStore } from '@/stores/historyStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useToastStore } from '@/stores/toastStore'
import { useUiStore } from '@/stores/uiStore'
import { __resetIdCounter, useWorkspaceStore } from '@/stores/workspaceStore'

const HOME = '/Users/dev'
const DOCUMENTS = `${HOME}/Documents`
const TEMPLATES = `${HOME}/Library/Application Support/MacFileExplorer/Templates`

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
const listing = () => screen.getByRole('grid', { name: 'Folder contents' })
const dialog = () => screen.getByRole('dialog', { name: 'New File' })
const nameField = () => within(dialog()).getByLabelText('Name')

async function goToDocuments(user: User) {
  await user.dblClick(await rowFor('Documents'))
  await rowFor('Resume\\.pdf')
}

/** Cmd+Alt+N rather than the menu, so the shortcut is exercised on the way in. */
async function openDialog(user: User) {
  listing().focus()
  await user.keyboard('{Meta>}{Alt>}n{/Alt}{/Meta}')
  await screen.findByRole('dialog', { name: 'New File' })
  // The templates read resolves before anything is asserted on the list.
  await within(dialog()).findByRole('radio', { name: /Markdown Document/ })
}

/** What was actually written to the mock filesystem. */
async function contentsOf(path: string) {
  return bridge.fs.readTextFile(path, 64 * 1024)
}

beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], panes: {}, activeTabId: null })
  useSelectionStore.setState({ byPane: {} })
  useUiStore.setState({
    previewOpen: false,
    sidebarOpen: true,
    showHiddenFiles: false,
    dialog: null,
    hashJob: null,
    newFile: null,
    hashAlgorithm: DEFAULT_ALGORITHM,
    lastTemplate: '',
    renaming: null,
    contextMenu: null,
  })
  useClipboardStore.setState({ paths: [], mode: null, sourceDir: null })
  useHistoryStore.setState({ entries: [] })
  useToastStore.getState().clear()
  __resetIdCounter()
})

describe('opening the dialog', () => {
  it('opens on the pane’s folder from Cmd+Alt+N', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    expect(useUiStore.getState().newFile?.parent).toBe(DOCUMENTS)
  })

  // Cmd+N is the fastest thing in the app and must not grow a dialog in front
  // of it (decision 1).
  it('leaves Cmd+N making an untitled file in one keystroke', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    listing().focus()
    await user.keyboard('{Meta>}n{/Meta}')

    expect(screen.queryByRole('dialog', { name: 'New File' })).toBeNull()
    await rowFor('untitled file')
  })

  it('is offered in the background context menu', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.pointer({ keys: '[MouseRight]', target: listing() })
    const menu = await screen.findByRole('menu', { name: 'Context menu' })
    await user.click(within(menu).getByRole('menuitem', { name: 'New File from Template…' }))

    await screen.findByRole('dialog', { name: 'New File' })
  })
})

describe('creating a file', () => {
  it('creates from the template the typed extension implies', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    await user.type(nameField(), 'release notes.md')
    // Typing the extension picks the template — the other half of decision 2.
    await waitFor(() =>
      expect(within(dialog()).getByRole('radio', { name: /Markdown Document/ })).toBeChecked(),
    )
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New File' })).toBeNull())
    await rowFor('release notes\\.md')
    // `{{name}}` became the stem, not the whole filename.
    expect(await contentsOf(`${DOCUMENTS}/release notes.md`)).toBe('# release notes\n\n')
  })

  it('fills in the extension and keeps the stem when a template is picked', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    await user.type(nameField(), 'landing')
    await user.click(within(dialog()).getByRole('radio', { name: /HTML Document/ }))

    expect(nameField()).toHaveValue('landing.html')
    await user.click(within(dialog()).getByRole('button', { name: 'Create' }))

    await rowFor('landing\\.html')
    const html = await contentsOf(`${DOCUMENTS}/landing.html`)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<title>landing</title>')
  })

  // "Any type" has to mean any type, template or not.
  it('creates an empty file for an extension no template claims', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    await user.type(nameField(), 'data.xyz')
    await user.keyboard('{Enter}')

    await rowFor('data\\.xyz')
    expect(await contentsOf(`${DOCUMENTS}/data.xyz`)).toBe('')
  })

  /**
   * Found by running the app, not by a test: with a template already selected —
   * from the list, or restored from last time — typing an extension it does not
   * claim used to write that template's content into the new file anyway. A
   * Markdown boilerplate inside an `.opml` file is the exact opposite of "any
   * type", which is the whole claim of the feature.
   */
  it('drops a selected template when the typed extension contradicts it', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    await user.click(within(dialog()).getByRole('radio', { name: /Markdown Document/ }))
    await user.clear(nameField())
    await user.type(nameField(), 'readings.opml')

    await waitFor(() =>
      expect(within(dialog()).getByRole('radio', { name: /^None/ })).toBeChecked(),
    )
    await user.keyboard('{Enter}')

    await rowFor('readings\\.opml')
    expect(await contentsOf(`${DOCUMENTS}/readings.opml`)).toBe('')
  })

  // The other side of that rule: an extensionless name contradicts nothing, so
  // a deliberately chosen template survives it.
  it('keeps a selected template for a name with no extension', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    await user.click(within(dialog()).getByRole('radio', { name: /Markdown Document/ }))
    await user.clear(nameField())
    await user.type(nameField(), 'LICENSE')
    await user.keyboard('{Enter}')

    await rowFor('LICENSE')
    expect(await contentsOf(`${DOCUMENTS}/LICENSE`)).toBe('# LICENSE\n\n')
  })

  it('takes the whole name from a filename template', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    await user.click(within(dialog()).getByRole('radio', { name: /Dockerfile/ }))
    expect(nameField()).toHaveValue('Dockerfile')

    await user.keyboard('{Enter}')
    await rowFor('Dockerfile')
    expect(await contentsOf(`${DOCUMENTS}/Dockerfile`)).toContain('FROM alpine')
  })

  // A shell script that comes out non-executable is the most annoying way this
  // can fail (decision 5). The mode is reported in `permissions`.
  it('makes a shell script executable', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    await user.type(nameField(), 'deploy.sh')
    await user.keyboard('{Enter}')

    await rowFor('deploy\\.sh')
    const info = await bridge.fs.readFileInfo(`${DOCUMENTS}/deploy.sh`)
    expect(info.permissions).toContain('x')
    expect(await contentsOf(info.path)).toContain('#!/usr/bin/env bash')
  })

  it('selects the new file and opens its name for editing', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    await user.type(nameField(), 'notes.md')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(useUiStore.getState().renaming?.path).toBe(`${DOCUMENTS}/notes.md`)
    })
  })

  it('is undone by Cmd+Z', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    await user.type(nameField(), 'notes.md')
    await user.keyboard('{Enter}')
    await rowFor('notes\\.md')

    // The rename editor is open on the new file, so it owns the keyboard until
    // it is dismissed — as it does after Cmd+N.
    await user.keyboard('{Escape}')
    listing().focus()
    await user.keyboard('{Meta>}z{/Meta}')

    await waitFor(() => expect(screen.queryByRole('row', { name: /^notes\.md/ })).toBeNull())
  })
})

describe('names that are already taken', () => {
  // M6 can auto-number `untitled file 2` because nobody chose that name. Here
  // the user typed it, and creating `notes copy.md` answers a question they did
  // not ask (decision 11).
  it('refuses in the field rather than renaming', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    await user.type(nameField(), 'Resume.pdf')

    expect(await within(dialog()).findByText(/already exists here/)).toBeInTheDocument()
    expect(within(dialog()).getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('compares case-insensitively, as the filesystem does', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    await user.type(nameField(), 'resume.PDF')
    expect(await within(dialog()).findByText(/already exists here/)).toBeInTheDocument()
  })
})

describe('custom templates', () => {
  it('picks up a file dropped into the Templates folder', async () => {
    // As if the user had put it there with any editor.
    await ensureTemplatesFolder(TEMPLATES)
    await bridge.fs.createFile(TEMPLATES, 'meeting.md', '# {{name}}\n\nAttendees:\n')

    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    // Listed under "Yours", ahead of the built-ins.
    await user.click(await within(dialog()).findByRole('radio', { name: /meeting\.md/ }))
    await user.clear(nameField())
    await user.type(nameField(), 'standup.md')
    await user.keyboard('{Enter}')

    await rowFor('standup\\.md')
    expect(await contentsOf(`${DOCUMENTS}/standup.md`)).toBe('# standup\n\nAttendees:\n')
  })

  it('shows a broken template with its reason and refuses to use it', async () => {
    await ensureTemplatesFolder(TEMPLATES)
    await bridge.fs.createFile(TEMPLATES, 'icon.png', 'PNG\0binary')

    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    const broken = await within(dialog()).findByRole('radio', { name: /icon\.png/ })
    expect(broken).toBeDisabled()
    expect(within(dialog()).getByText('Not a text file')).toBeInTheDocument()
  })
})

describe('the dialog itself', () => {
  it('owns the keyboard while it is open', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    const paneId = useWorkspaceStore.getState().tabs[0]?.activePaneId ?? ''
    await openDialog(user)

    await user.keyboard('{Meta>}2{/Meta}')

    // Cmd+2 is "as Large Icons". Nothing global fires while a modal is up.
    expect(useWorkspaceStore.getState().panes[paneId]?.viewMode).toBe('details')
  })

  it('closes on Escape without creating anything', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    await user.type(nameField(), 'notes.md')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New File' })).toBeNull())
    expect(await bridge.fs.exists(`${DOCUMENTS}/notes.md`)).toBe(false)
  })

  it('remembers the template last used', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await openDialog(user)

    await user.type(nameField(), 'app.py')
    await user.keyboard('{Enter}')
    await rowFor('app\\.py')

    await waitFor(() => expect(useUiStore.getState().lastTemplate).toBe('python'))

    // Reopening starts on it, so ten Python files cost one choice.
    await user.keyboard('{Escape}')
    listing().focus()
    await openDialog(user)
    expect(within(dialog()).getByRole('radio', { name: /Python Script/ })).toBeChecked()
  })
})
