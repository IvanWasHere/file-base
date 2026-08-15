/**
 * M18 acceptance: browsing, compressing and uncompressing, driven through the
 * real chrome against the mock filesystem.
 *
 * The mock's archives are JSON manifests rather than real zip bytes, and that
 * is the point: what is tested here is the *app* — mounting, navigating,
 * reference counting, the password prompt, the dialog — while whether the bytes
 * are genuinely deflated is `backend/archive`'s business, checked there against
 * the real `unzip`, `tar` and an independent AES implementation.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { DEFAULT_ALGORITHM } from '@/constants/hashAlgorithms'
import { bridge } from '@/services/bridge'
import { startCreate } from '@/services/archives/archiveService'
import { __mountState, __releaseAllMounts } from '@/services/archives/mountRegistry'
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

function activePane() {
  const state = useWorkspaceStore.getState()
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
  return tab ? state.panes[tab.activePaneId] : undefined
}

async function goToDocuments(user: User) {
  await user.dblClick(await rowFor('Documents'))
  await rowFor('Resume\\.pdf')
}

/**
 * Puts an archive in Documents through the app's own service.
 *
 * Deliberately `startCreate` rather than the bridge directly: the mock finishes
 * on a microtask, before the promise carrying the job id has resolved, so a
 * helper that subscribed *after* calling would never see the Done — which is
 * the M8 race the service exists to absorb, and which this helper hit the first
 * time it was written the obvious way.
 */
async function makeArchive(name: string, sources: string[], password = '') {
  await new Promise<void>((resolve, reject) => {
    startCreate(
      {
        sources,
        destination: `${DOCUMENTS}/${name}`,
        format: 'zip',
        level: 5,
        password,
        splitBytes: 0,
      },
      {
        onProgress: () => undefined,
        onDone: (done) => (done.error ? reject(done.error) : resolve()),
        onFailed: reject,
      },
    )
  })
}

beforeEach(() => {
  __releaseAllMounts()
  useWorkspaceStore.setState({ tabs: [], panes: {}, activeTabId: null })
  useSelectionStore.setState({ byPane: {} })
  useUiStore.setState({
    previewOpen: false,
    sidebarOpen: true,
    showHiddenFiles: false,
    dialog: null,
    hashJob: null,
    newFile: null,
    compress: null,
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

describe('browsing an archive', () => {
  // The whole payoff of decision 3: the pane navigates into a real folder, so
  // everything else keeps working because it cannot tell.
  it('opens on double-click and shows its contents like a folder', async () => {
    await makeArchive('bundle.zip', [`${DOCUMENTS}/Resume.pdf`, `${DOCUMENTS}/Meeting Notes.docx`])

    const { user } = renderApp()
    await goToDocuments(user)
    await user.dblClick(await rowFor('bundle\\.zip'))

    // Landed in a mount, with the archive's name in the path.
    await waitFor(() => expect(activePane()?.path).toMatch(/bundle\.zip$/))
    expect(await rowFor('Resume\\.pdf')).toBeInTheDocument()
    expect(await rowFor('Meeting Notes\\.docx')).toBeInTheDocument()
    expect(__mountState()).toHaveLength(1)
  })

  it('holds a reference while the pane is inside and releases it on the way out', async () => {
    await makeArchive('bundle.zip', [`${DOCUMENTS}/Resume.pdf`])

    const { user } = renderApp()
    await goToDocuments(user)
    await user.dblClick(await rowFor('bundle\\.zip'))
    await waitFor(() => expect(activePane()?.path).toMatch(/bundle\.zip$/))
    await waitFor(() => expect(__mountState()[0]?.refs).toBeGreaterThan(0))

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(activePane()?.path).toBe(DOCUMENTS))
    // Still registered — the grace period is what makes Forward instant.
    await waitFor(() => expect(__mountState()[0]?.refs).toBe(0))
  })

  it('reuses the extraction when the same archive is opened again', async () => {
    await makeArchive('bundle.zip', [`${DOCUMENTS}/Resume.pdf`])

    const { user } = renderApp()
    await goToDocuments(user)
    await user.dblClick(await rowFor('bundle\\.zip'))
    await waitFor(() => expect(activePane()?.path).toMatch(/bundle\.zip$/))
    const first = activePane()?.path

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(activePane()?.path).toBe(DOCUMENTS))
    await user.dblClick(await rowFor('bundle\\.zip'))

    await waitFor(() => expect(activePane()?.path).toBe(first))
    expect(__mountState()).toHaveLength(1)
  })

  // An ordinary file must still open in its application rather than mounting.
  it('leaves a non-archive alone', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await user.dblClick(await rowFor('Resume\\.pdf'))

    await waitFor(() => expect(activePane()?.path).toBe(DOCUMENTS))
    expect(__mountState()).toHaveLength(0)
  })
})

describe('protected archives', () => {
  it('asks for the password and opens once it is right', async () => {
    await makeArchive('secret.zip', [`${DOCUMENTS}/Resume.pdf`], 'hunter2')

    const { user } = renderApp()
    await goToDocuments(user)
    await user.dblClick(await rowFor('secret\\.zip'))

    const prompt = await screen.findByRole('dialog', { name: 'Archive password' })
    expect(within(prompt).getByText(/This archive is protected/)).toBeInTheDocument()

    await user.type(within(prompt).getByLabelText('Password'), 'hunter2')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(activePane()?.path).toMatch(/secret\.zip$/))
    expect(await rowFor('Resume\\.pdf')).toBeInTheDocument()
  })

  // A wrong password says so rather than silently asking again.
  it('says the password was wrong before asking a second time', async () => {
    await makeArchive('secret.zip', [`${DOCUMENTS}/Resume.pdf`], 'hunter2')

    const { user } = renderApp()
    await goToDocuments(user)
    await user.dblClick(await rowFor('secret\\.zip'))

    let prompt = await screen.findByRole('dialog', { name: 'Archive password' })
    await user.type(within(prompt).getByLabelText('Password'), 'nope')
    await user.keyboard('{Enter}')

    prompt = await screen.findByRole('dialog', { name: 'Archive password' })
    await waitFor(() => expect(within(prompt).getByText(/did not work/)).toBeInTheDocument())
  })

  it('gives up quietly when the prompt is dismissed', async () => {
    await makeArchive('secret.zip', [`${DOCUMENTS}/Resume.pdf`], 'hunter2')

    const { user } = renderApp()
    await goToDocuments(user)
    await user.dblClick(await rowFor('secret\\.zip'))

    const prompt = await screen.findByRole('dialog', { name: 'Archive password' })
    await user.click(within(prompt).getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Archive password' })).toBeNull(),
    )
    expect(activePane()?.path).toBe(DOCUMENTS)
    expect(__mountState()).toHaveLength(0)
  })
})

describe('compressing', () => {
  it('creates an archive from the selection', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    listing().focus()
    await user.keyboard('{Meta>}{Alt>}k{/Alt}{/Meta}')

    const dialog = await screen.findByRole('dialog', { name: 'Compress' })
    const name = within(dialog).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'archived')
    await user.click(within(dialog).getByRole('button', { name: 'Compress' }))

    await rowFor('archived\\.zip')
  })

  // Named rather than silently absent: nobody can write these, and a user who
  // looks for 7z deserves the reason.
  it('says why 7z and rar are not offered', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await user.click(await rowFor('Resume\\.pdf'))
    listing().focus()
    await user.keyboard('{Meta>}{Alt>}k{/Alt}{/Meta}')

    const dialog = await screen.findByRole('dialog', { name: 'Compress' })
    expect(within(dialog).getByText(/7z and rar can be opened but not created/)).toBeInTheDocument()

    const formats = within(dialog).getByLabelText('Format')
    expect(within(formats).queryByText(/7z/)).toBeNull()
  })

  // A password on a tar.gz would mean inventing an envelope, and a file nobody
  // else can open is worse than no encryption.
  it('offers a password only where the format has a real answer', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await user.click(await rowFor('Resume\\.pdf'))
    listing().focus()
    await user.keyboard('{Meta>}{Alt>}k{/Alt}{/Meta}')

    const dialog = await screen.findByRole('dialog', { name: 'Compress' })
    expect(within(dialog).getByLabelText('Password')).toBeEnabled()

    await user.selectOptions(within(dialog).getByLabelText('Format'), 'tar.gz')
    expect(within(dialog).getByLabelText('Password')).toBeDisabled()
  })

  // People are routinely surprised by this.
  it('warns that an encrypted zip still shows its filenames', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await user.click(await rowFor('Resume\\.pdf'))
    listing().focus()
    await user.keyboard('{Meta>}{Alt>}k{/Alt}{/Meta}')

    const dialog = await screen.findByRole('dialog', { name: 'Compress' })
    await user.type(within(dialog).getByLabelText('Password'), 'hunter2')

    expect(within(dialog).getByText(/file names stay readable/i)).toBeInTheDocument()
  })

  it('warns that split parts are not openable on their own', async () => {
    const { user } = renderApp()
    await goToDocuments(user)
    await user.click(await rowFor('Resume\\.pdf'))
    listing().focus()
    await user.keyboard('{Meta>}{Alt>}k{/Alt}{/Meta}')

    const dialog = await screen.findByRole('dialog', { name: 'Compress' })
    await user.selectOptions(within(dialog).getByLabelText('Split into parts'), '100')

    expect(within(dialog).getByText(/not openable on its own/)).toBeInTheDocument()
  })
})

describe('uncompressing', () => {
  // Permanent, unlike browsing: what it extracts stays where it lands.
  it('extracts beside the archive and leaves the result there', async () => {
    await makeArchive('bundle.zip', [`${DOCUMENTS}/Resume.pdf`, `${DOCUMENTS}/Meeting Notes.docx`])

    const { user } = renderApp()
    await goToDocuments(user)

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('bundle\\.zip') })
    const menu = await screen.findByRole('menu', { name: 'Context menu' })
    await user.click(within(menu).getByRole('menuitem', { name: 'Uncompress' }))

    // Two entries, so they go in a folder named after the archive rather than
    // scattering into Documents.
    await rowFor('bundle')
    await waitFor(async () => {
      expect(await bridge.fs.exists(`${DOCUMENTS}/bundle/Resume.pdf`)).toBe(true)
    })
    expect(__mountState()).toHaveLength(0)
  })

  it('is not offered for an ordinary file', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Resume\\.pdf') })
    const menu = await screen.findByRole('menu', { name: 'Context menu' })
    expect(within(menu).getByRole('menuitem', { name: 'Uncompress' })).toBeDisabled()
  })
})
