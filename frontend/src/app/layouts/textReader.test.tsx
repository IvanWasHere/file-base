/**
 * §M31 acceptance: the chunked text reader, driven through the real chrome
 * against the mock bridge.
 *
 * The mock generates only the window that is asked for, exactly as Go reads
 * only the window that is asked for, so a file with a size and no bytes behind
 * it behaves here the way a 100GB log behaves there. That is what makes the
 * central claim testable: the assertions below are about *what was read*, not
 * only about what ended up on screen.
 *
 * Its filler is 64-byte lines that each state the offset they begin at, which
 * is why a window can be identified by its first line.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { DEFAULT_CHUNK_SIZE } from '@/constants/chunkSizes'
import { bridge } from '@/services/bridge'
import { __emitMenuCommand } from '@/services/bridge/impl/mock'
import { useClipboardStore } from '@/stores/clipboardStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useToastStore } from '@/stores/toastStore'
import { useUiStore } from '@/stores/uiStore'
import { __resetIdCounter, useWorkspaceStore } from '@/stores/workspaceStore'

const HOME = '/Users/dev'
const DOCUMENTS = `${HOME}/Documents`

/** 156,800 bytes of the mock's filler — two and a bit 64KB windows. */
const NOTES = 'Meeting Notes\\.docx'
/** 890,000,000 bytes that exist only as a number, which is the point. */
const HUGE = 'conference-talk-2024\\.mkv'

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
const reader = () => screen.getByRole('dialog', { name: 'Text Reader' })
const contents = () => within(reader()).getByLabelText('File contents')
const readout = () => within(reader()).getByText(/of [\d,]+ bytes/)
const button = (name: string) => within(reader()).getByRole('button', { name })

async function goTo(user: User, folder: string, landmark: string) {
  await user.dblClick(await rowFor(folder))
  await rowFor(landmark)
}

/** Right-clicks a file and picks Open in Text Reader. */
async function openReader(user: User, file: string) {
  await user.pointer({ keys: '[MouseRight]', target: await rowFor(file) })
  const menu = await contextMenu()
  await user.click(within(menu).getByRole('menuitem', { name: 'Open in Text Reader' }))
  return screen.findByRole('dialog', { name: 'Text Reader' })
}

/** The offset the window's first filler line states. */
function firstLineOffset(): number {
  const [first = ''] = (contents().textContent ?? '').split('\n')
  return Number(first.slice(0, 12))
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
    textReader: null,
    readerChunkSize: DEFAULT_CHUNK_SIZE,
    readerSnapToLine: true,
    hiddenContextCommands: [],
  })
  useClipboardStore.setState({ paths: [], mode: null, sourceDir: null })
  useToastStore.getState().clear()
  __resetIdCounter()
  vi.restoreAllMocks()
})

describe('opening the reader', () => {
  it('is offered on a file and not on a folder', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', NOTES)

    await user.pointer({ keys: '[MouseRight]', target: await rowFor(NOTES) })
    expect(
      within(await contextMenu()).getByRole('menuitem', { name: 'Open in Text Reader' }),
    ).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Work') })
    // A folder has nothing to read, so the row is absent rather than dead —
    // the rule Open With settled in §M25.
    expect(
      within(await contextMenu()).queryByRole('menuitem', { name: 'Open in Text Reader' }),
    ).toBeNull()
  })

  it('opens on the first window of the file', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', NOTES)
    await openReader(user, NOTES)

    await waitFor(() => expect(firstLineOffset()).toBe(0))
    expect(within(reader()).getByText('Meeting Notes.docx')).toBeInTheDocument()
    // 64KB of a 153KB file, stated in bytes: the reader never claims to know a
    // line number, because nothing has counted the lines.
    expect(readout()).toHaveTextContent('0–65,535 of 156,800 bytes (153.1 KB)')
  })

  it('opens from the native menu command', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', NOTES)
    await user.click(await rowFor(NOTES))

    __emitMenuCommand('file.openInTextReader')

    expect(await screen.findByRole('dialog', { name: 'Text Reader' })).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', NOTES)
    await openReader(user, NOTES)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Text Reader' })).toBeNull()
  })
})

describe('moving through the file', () => {
  it('steps forward and back a window at a time', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', NOTES)
    await openReader(user, NOTES)
    await waitFor(() => expect(firstLineOffset()).toBe(0))

    await user.click(button('Next chunk'))
    await waitFor(() => expect(firstLineOffset()).toBe(65_536))
    expect(readout()).toHaveTextContent('65,536–131,071')

    await user.click(button('Previous chunk'))
    await waitFor(() => expect(firstLineOffset()).toBe(0))
  })

  it('stops at both ends of the file', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', NOTES)
    await openReader(user, NOTES)
    await waitFor(() => expect(firstLineOffset()).toBe(0))

    expect(button('Previous chunk')).toBeDisabled()

    await user.click(button('Next chunk'))
    await waitFor(() => expect(firstLineOffset()).toBe(65_536))
    await user.click(button('Next chunk'))
    await waitFor(() => expect(firstLineOffset()).toBe(131_072))

    // The last window is the remainder, not a full chunk, and there is nothing
    // after it.
    expect(readout()).toHaveTextContent('131,072–156,799')
    expect(button('Next chunk')).toBeDisabled()
  })

  it('jumps to a typed offset', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', NOTES)
    await openReader(user, NOTES)
    await waitFor(() => expect(firstLineOffset()).toBe(0))

    const field = within(reader()).getByLabelText('Go to offset')
    await user.clear(field)
    await user.type(field, '100,000')
    await user.click(button('Go'))

    // 99,968, not 100,000: whole lines are on, and the line containing byte
    // 100,000 starts there. The readout says where it landed rather than where
    // it was aimed.
    await waitFor(() => expect(firstLineOffset()).toBe(99_968))
    expect(readout()).toHaveTextContent('99,968–')
  })

  it('refuses an offset that is not a number', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', NOTES)
    await openReader(user, NOTES)

    const field = within(reader()).getByLabelText('Go to offset')
    await user.clear(field)
    await user.type(field, 'halfway')

    expect(button('Go')).toBeDisabled()
    expect(field).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('what the reader reads', () => {
  it('reads one chunk of a 890MB file and nothing more', async () => {
    const readChunk = vi.spyOn(bridge.textFile, 'readChunk')
    const { user } = renderApp()
    await goTo(user, 'Movies', HUGE)
    await openReader(user, HUGE)

    await waitFor(() => expect(readout()).toHaveTextContent('of 890,000,000 bytes (848.8 MB)'))

    // The whole claim of the feature, in one assertion: opening it cost one
    // read of one chunk, whatever the file's size.
    expect(readChunk).toHaveBeenCalledTimes(1)
    expect(readChunk.mock.calls[0]?.[1]).toBe(0)
    expect(readChunk.mock.calls[0]?.[2]).toBe(DEFAULT_CHUNK_SIZE)

    await user.click(button('Next chunk'))
    await waitFor(() => expect(firstLineOffset()).toBe(65_536))
    // Still one chunk at a time, not one chunk more held alongside the last.
    expect(readChunk).toHaveBeenCalledTimes(2)
    expect(readChunk.mock.calls[1]?.[2]).toBe(DEFAULT_CHUNK_SIZE)
  })

  it('changes how much it holds, and remembers the choice', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', NOTES)
    await openReader(user, NOTES)
    await waitFor(() => expect(readout()).toHaveTextContent('0–65,535'))

    await user.selectOptions(within(reader()).getByLabelText('Chunk size'), '10240')

    await waitFor(() => expect(readout()).toHaveTextContent('0–10,239'))
    // A property of the machine, not of the file: it outlives this reader.
    expect(useUiStore.getState().readerChunkSize).toBe(10_240)
  })

  it('takes whole lines, or the bytes as asked', async () => {
    // A hundred-byte line divides no chunk size on offer, so the two settings
    // cannot agree about where a window ends.
    const line = `${'x'.repeat(99)}\n`
    await bridge.fs.createFile(DOCUMENTS, 'uneven.log', line.repeat(200))

    const { user } = renderApp()
    await goTo(user, 'Documents', NOTES)
    await openReader(user, 'uneven\\.log')
    await user.selectOptions(within(reader()).getByLabelText('Chunk size'), '10240')

    // 10,240 would cut the 103rd line in half, so the window stops after the
    // 102nd.
    await waitFor(() => expect(readout()).toHaveTextContent('0–10,199 of 20,000 bytes'))

    await user.click(within(reader()).getByLabelText('Whole lines'))
    await waitFor(() => expect(readout()).toHaveTextContent('0–10,239 of 20,000 bytes'))
    expect(useUiStore.getState().readerSnapToLine).toBe(false)
  })

  it('says so when the file has gone', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', NOTES)
    await openReader(user, NOTES)
    await waitFor(() => expect(firstLineOffset()).toBe(0))

    await bridge.fs.delete([`${DOCUMENTS}/Meeting Notes.docx`])
    await user.click(button('Re-read this chunk'))

    expect(await within(reader()).findByText('This item no longer exists.')).toBeInTheDocument()
  })
})
