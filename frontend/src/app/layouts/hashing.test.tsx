/**
 * M14 acceptance: the hash modal, driven through the real chrome against the
 * mock filesystem.
 *
 * Digest *correctness* is not tested here and cannot be — the mock returns
 * synthetic digests on purpose (PLAN.md M14 decision 15), and the real
 * algorithms are pinned in backend/hashing against published vectors. What is
 * tested here is everything around them: which files become rows, what happens
 * to the ones that cannot be hashed, and whether the answers reach the user.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { DEFAULT_ALGORITHM } from '@/constants/hashAlgorithms'
import { bridge } from '@/services/bridge'
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
const listing = () => screen.getByRole('grid', { name: 'Folder contents' })
const modal = () => screen.getByRole('dialog', { name: 'Calculate Hashes' })
const hashButton = () => screen.getByRole('button', { name: 'Calculate Hashes' })
const table = () => within(modal()).getByRole('table', { name: 'Files and digests' })
const hashRows = () => within(table()).getAllByRole('row')

/**
 * A row's digest, read off the screen the way a user would.
 *
 * Matched as an element whose *whole* text is hex, not by scanning the row's
 * text: "Resume.pdf" ends in "df", and a loose search happily returns the
 * filename's last two characters glued to the front of the digest.
 */
function digestIn(name: string): string {
  const row = within(table()).getByRole('row', { name })
  return within(row).getByText(/^[0-9a-f]+$/).textContent ?? ''
}

async function goToDocuments(user: User) {
  await user.dblClick(await rowFor('Documents'))
  await rowFor('Resume\\.pdf')
}

/** Selects the named rows, Cmd-clicking every one after the first. */
async function select(user: User, ...names: string[]) {
  const [first, ...rest] = names
  if (!first) return
  await user.click(await rowFor(first))
  if (rest.length === 0) return

  await user.keyboard('{Meta>}')
  for (const name of rest) await user.click(await rowFor(name))
  await user.keyboard('{/Meta}')
}

/** Opens the modal and waits for every row to have finished. */
async function openHashes(user: User) {
  await user.click(hashButton())
  await screen.findByRole('dialog', { name: 'Calculate Hashes' })
  await waitFor(() => {
    expect(within(table()).queryByText('Waiting…')).toBeNull()
  })
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
    hashAlgorithm: DEFAULT_ALGORITHM,
    renaming: null,
    contextMenu: null,
  })
  useClipboardStore.setState({ paths: [], mode: null, sourceDir: null })
  useHistoryStore.setState({ entries: [] })
  useToastStore.getState().clear()
  __resetIdCounter()
})

describe('opening the hash modal', () => {
  it('is offered only once the selection could hold a file', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    expect(hashButton()).toBeDisabled()

    await select(user, 'Resume\\.pdf')
    expect(hashButton()).toBeEnabled()
  })

  it('opens with a row per file, each showing its digest', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await select(user, 'Resume.pdf', 'Meeting Notes.docx')
    await openHashes(user)

    expect(hashRows()).toHaveLength(2)
    // SHA-256 is the default, and 64 hex characters is what that means.
    expect(digestIn('Resume.pdf')).toMatch(/^[0-9a-f]{64}$/)
    expect(digestIn('Meeting Notes.docx')).toMatch(/^[0-9a-f]{64}$/)
  })

  // Four routes, one command. The toolbar, the shortcut and the native menu are
  // covered elsewhere in this file and in backend/appmenu's drift test; this is
  // the fourth.
  it('is offered in the file and folder context menus', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Resume\\.pdf') })
    const menu = await screen.findByRole('menu', { name: 'Context menu' })
    expect(within(menu).getByRole('menuitem', { name: 'Calculate Hashes…' })).toBeEnabled()

    await user.click(within(menu).getByRole('menuitem', { name: 'Calculate Hashes…' }))
    await screen.findByRole('dialog', { name: 'Calculate Hashes' })
  })

  it('opens from Cmd+Alt+H as well as the toolbar', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await select(user, 'Resume.pdf')

    listing().focus()
    await user.keyboard('{Meta>}{Alt>}h{/Alt}{/Meta}')

    await screen.findByRole('dialog', { name: 'Calculate Hashes' })
  })

  // A folder has no checksum, and a recursive digest is a different feature.
  // Dropping them silently would look like a bug, so the count is reported.
  it('drops folders from the list and says how many', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await select(user, 'Resume.pdf', 'Work')
    await openHashes(user)

    expect(hashRows()).toHaveLength(1)
    expect(within(modal()).getByText(/1 folder skipped/)).toBeInTheDocument()
  })

  it('reports a selected item that has gone away', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await select(user, 'Resume.pdf', 'Meeting Notes.docx')

    // Deleted behind the app's back, as another process would.
    await bridge.fs.delete([`${DOCUMENTS}/Meeting Notes.docx`])
    await openHashes(user)

    expect(hashRows()).toHaveLength(1)
    expect(within(modal()).getByText(/1 item no longer there/)).toBeInTheDocument()
  })
})

describe('the algorithm sidebar', () => {
  it('switches algorithm and recomputes', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await select(user, 'Resume.pdf')
    await openHashes(user)

    const sha256 = digestIn('Resume.pdf')
    expect(sha256).toHaveLength(64)

    await user.click(within(modal()).getByRole('radio', { name: /MD5/ }))
    await waitFor(() => expect(digestIn('Resume.pdf')).toHaveLength(32))
    expect(digestIn('Resume.pdf')).not.toBe(sha256)

    // Switching back is answered from the session cache rather than recomputed,
    // which is the whole reason the cache exists.
    await user.click(within(modal()).getByRole('radio', { name: /SHA-256/ }))
    await waitFor(() => expect(digestIn('Resume.pdf')).toBe(sha256))
  })

  // CRC32 is not a hash, and a checksum tool that lets someone verify a
  // download with it believing it proves authenticity is worse than one that
  // leaves it out (decision 11).
  it('says what CRC32 is for, and what MD5 and SHA-1 are not', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await select(user, 'Resume.pdf')
    await openHashes(user)

    expect(within(modal()).getByText('Integrity check')).toBeInTheDocument()
    expect(within(modal()).getByText(/proves nothing about origin/)).toBeInTheDocument()
    expect(within(modal()).getAllByText(/Broken for security/)).toHaveLength(2)
  })
})

describe('comparing digests', () => {
  it('badges two identical files as matching', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    // Duplicate makes a real copy: same size, same content, different name —
    // which is exactly the question this badge answers.
    await select(user, 'Resume.pdf')
    await user.keyboard('{Meta>}d{/Meta}')
    await rowFor('Resume copy\\.pdf')

    await select(user, 'Resume.pdf', 'Resume copy.pdf')
    await openHashes(user)

    expect(digestIn('Resume.pdf')).toBe(digestIn('Resume copy.pdf'))
    expect(within(table()).getAllByText('2 files match')).toHaveLength(2)
  })

  it('highlights the row matching a pasted checksum', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await select(user, 'Resume.pdf', 'Meeting Notes.docx')
    await openHashes(user)

    const expected = digestIn('Resume.pdf')
    const field = within(modal()).getByRole('textbox', { name: 'Expected checksum' })

    // As it comes off a download page: uppercase, with the filename beside it.
    await user.click(field)
    await user.paste(`${expected.toUpperCase()}  Resume.pdf`)

    await within(modal()).findByText('Match')
    const row = within(table()).getByRole('row', { name: 'Resume.pdf' })
    expect(within(row).getByText('verified')).toBeInTheDocument()
    expect(
      within(within(table()).getByRole('row', { name: 'Meeting Notes.docx' })).queryByText(
        'verified',
      ),
    ).toBeNull()
  })

  // "No match" is the wrong thing to say when the paste is a perfectly good
  // digest of a different algorithm — which is the mistake people actually make.
  it('recognises a checksum pasted against the wrong algorithm', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await select(user, 'Resume.pdf')
    await openHashes(user)

    const field = within(modal()).getByRole('textbox', { name: 'Expected checksum' })
    await user.click(field)
    await user.paste('d41d8cd98f00b204e9800998ecf8427e')

    expect(await within(modal()).findByText(/looks like a MD5 digest, not SHA-256/)).toBeVisible()
  })

  it('copies one digest, and all of them as shasum lines', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await select(user, 'Resume.pdf', 'Meeting Notes.docx')
    await openHashes(user)

    await user.click(within(modal()).getByRole('button', { name: 'Copy Resume.pdf digest' }))
    expect(await navigator.clipboard.readText()).toBe(digestIn('Resume.pdf'))

    await user.click(within(modal()).getByRole('button', { name: 'Copy All' }))
    const copied = await navigator.clipboard.readText()
    // `<hash>  <name>`, two spaces — what `shasum -c` reads.
    expect(copied.split('\n')).toHaveLength(2)
    expect(copied).toContain(`${digestIn('Resume.pdf')}  Resume.pdf`)
  })
})

describe('failures', () => {
  // Permission denied on one file in a selection of forty must not kill the
  // batch. The mock cannot refuse a read, so the file is removed from under the
  // job instead — the same shape of failure, and the same row-level outcome.
  it('fails one row and completes the rest', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await select(user, 'Resume.pdf', 'Meeting Notes.docx')
    await openHashes(user)
    expect(hashRows()).toHaveLength(2)

    await bridge.fs.delete([`${DOCUMENTS}/Meeting Notes.docx`])
    // Switching algorithm re-runs the job over the same rows, and one of them
    // is no longer there.
    await user.click(within(modal()).getByRole('radio', { name: /MD5/ }))

    await waitFor(() => {
      expect(within(table()).getByText('This item no longer exists.')).toBeInTheDocument()
    })
    expect(hashRows()).toHaveLength(2)
    expect(digestIn('Resume.pdf')).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('the modal itself', () => {
  it('owns the keyboard while it is open', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await select(user, 'Resume.pdf')
    const before = useWorkspaceStore.getState()
    const paneId = before.panes[Object.keys(before.panes)[0] ?? '']?.id ?? ''

    await openHashes(user)
    await user.keyboard('{Meta>}2{/Meta}')

    // Cmd+2 is "as Large Icons". Nothing global fires while a modal is up.
    expect(useWorkspaceStore.getState().panes[paneId]?.viewMode).toBe('details')
  })

  it('closes on Escape', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await select(user, 'Resume.pdf')
    await openHashes(user)

    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Calculate Hashes' })).toBeNull(),
    )
    expect(useUiStore.getState().hashJob).toBeNull()
  })
})
