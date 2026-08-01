/**
 * M9 acceptance: drag and drop through the real chrome.
 *
 * jsdom has no drag implementation, so the events are dispatched by hand with a
 * `DataTransfer` stand-in. What is being tested is the app's handling — which
 * target is resolved, whether it accepts, and what operation runs — not the
 * browser's drag machinery.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { bridge } from '@/services/bridge'
import { __emitFileDrop } from '@/services/bridge/impl/mock'
import { useDragStore } from '@/stores/dragStore'
import { useSearchStore } from '@/stores/searchStore'
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

const rowFor = (name: string) => screen.findByRole('row', { name: new RegExp(`^${name}\\b`) })

/**
 * The minimum of `DataTransfer` the app touches. jsdom does not implement it,
 * and `fireEvent` will not synthesise one.
 */
function dataTransfer() {
  const store = new Map<string, string>()
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    types: [...store.keys()],
  }
}

/**
 * Fires a drag event carrying a modifier.
 *
 * jsdom has no `DragEvent`, so the event testing-library synthesises drops
 * `altKey` on the floor — it has to be defined onto the event by hand, or every
 * Option-drag would look like a plain one and silently assert the wrong thing.
 */
function fireDragEvent(
  kind: 'dragStart' | 'dragOver' | 'drop' | 'dragEnd',
  target: Element,
  init: Record<string, unknown>,
) {
  const event = createEvent[kind](target, init)
  Object.defineProperty(event, 'altKey', { get: () => init.altKey === true })
  fireEvent(target, event)
}

/** Drags `source` onto `target` and returns the effect the app settled on. */
function drag(source: Element, target: Element, options: { altKey?: boolean } = {}) {
  const transfer = dataTransfer()
  fireDragEvent('dragStart', source, { dataTransfer: transfer, ...options })
  fireDragEvent('dragOver', target, { dataTransfer: transfer, ...options })
  const effect = transfer.dropEffect
  fireDragEvent('drop', target, { dataTransfer: transfer, ...options })
  fireDragEvent('dragEnd', source, { dataTransfer: transfer, ...options })
  return effect
}

beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], panes: {}, activeTabId: null })
  useSelectionStore.setState({ byPane: {} })
  useSearchStore.setState({ byPane: {} })
  useDragStore.setState({ paths: [], sourceDir: '', over: null, effect: null })
  useUiStore.setState({
    previewOpen: false,
    sidebarOpen: true,
    showHiddenFiles: false,
    dialog: null,
    renaming: null,
  })
  __resetIdCounter()
})

describe('dragging within a pane', () => {
  it('moves a file onto a folder', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Documents'))
    const file = await rowFor('Resume\\.pdf')
    const folder = await rowFor('Work')

    drag(file, folder)

    await waitFor(async () =>
      expect(await bridge.fs.exists(`${HOME}/Documents/Work/Resume.pdf`)).toBe(true),
    )
    expect(await bridge.fs.exists(`${HOME}/Documents/Resume.pdf`)).toBe(false)
  })

  // Same volume moves; Option copies. Getting this backwards would silently
  // destroy the original.
  it('copies instead when Option is held', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Documents'))
    const file = await rowFor('Resume\\.pdf')
    const folder = await rowFor('Work')

    const effect = drag(file, folder, { altKey: true })
    expect(effect).toBe('copy')

    await waitFor(async () =>
      expect(await bridge.fs.exists(`${HOME}/Documents/Work/Resume.pdf`)).toBe(true),
    )
    expect(await bridge.fs.exists(`${HOME}/Documents/Resume.pdf`)).toBe(true)
  })

  it('takes the whole selection when a selected row is dragged', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Documents'))

    await user.click(await rowFor('Resume\\.pdf'))
    await user.keyboard('{Meta>}')
    await user.click(await rowFor('Meeting Notes\\.docx'))
    await user.keyboard('{/Meta}')

    drag(await rowFor('Resume\\.pdf'), await rowFor('Work'))

    await waitFor(async () =>
      expect(await bridge.fs.exists(`${HOME}/Documents/Work/Resume.pdf`)).toBe(true),
    )
    expect(await bridge.fs.exists(`${HOME}/Documents/Work/Meeting Notes.docx`)).toBe(true)
  })

  // Finder drags just the row under the pointer when it is not part of the
  // selection, rather than the selection it was not in.
  it('drags only the row under the pointer when it is unselected', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Documents'))
    await user.click(await rowFor('Meeting Notes\\.docx'))

    drag(await rowFor('Resume\\.pdf'), await rowFor('Work'))

    await waitFor(async () =>
      expect(await bridge.fs.exists(`${HOME}/Documents/Work/Resume.pdf`)).toBe(true),
    )
    expect(await bridge.fs.exists(`${HOME}/Documents/Meeting Notes.docx`)).toBe(true)
  })
})

describe('rejected drops', () => {
  it('refuses a folder dropped into itself', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Documents'))
    const folder = await rowFor('Work')

    const effect = drag(folder, folder)

    expect(effect).toBe('none')
    expect(await bridge.fs.exists(`${HOME}/Documents/Work/Work`)).toBe(false)
  })

  it('refuses a folder dropped into its own subfolder', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Documents'))
    const outer = await rowFor('Work')
    await user.dblClick(outer)
    const inner = await rowFor('Client Proposals')

    // The drag store still holds Work as the source after navigating in.
    useDragStore.getState().start([`${HOME}/Documents/Work`], `${HOME}/Documents`)
    const transfer = dataTransfer()
    fireEvent.dragOver(inner, { dataTransfer: transfer })

    expect(transfer.dropEffect).toBe('none')
  })

  it('refuses a move back into the folder it came from', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Documents'))
    const file = await rowFor('Resume\\.pdf')

    const grid = screen.getByRole('grid', { name: 'Folder contents' })
    const transfer = dataTransfer()
    fireEvent.dragStart(file, { dataTransfer: transfer })
    fireEvent.dragOver(grid, { dataTransfer: transfer })

    expect(transfer.dropEffect).toBe('none')
  })

  // Dropping a copy back where it came from is Duplicate, which is a real
  // operation and must not be refused.
  it('allows a copy back into the same folder', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Documents'))
    const file = await rowFor('Resume\\.pdf')
    const grid = screen.getByRole('grid', { name: 'Folder contents' })

    drag(file, grid, { altKey: true })

    expect(await rowFor('Resume copy\\.pdf')).toBeInTheDocument()
  })
})

describe('dropping on the sidebar', () => {
  it('moves files into the place that was dropped on', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Documents'))
    const file = await rowFor('Resume\\.pdf')

    const sidebar = screen.getByRole('navigation', { name: 'Places' })
    const downloads = within(sidebar).getByRole('button', { name: 'Downloads' })

    drag(file, downloads)

    await waitFor(async () =>
      expect(await bridge.fs.exists(`${HOME}/Downloads/Resume.pdf`)).toBe(true),
    )
  })
})

describe('dropping between panes', () => {
  it('moves a file from one pane into the other', async () => {
    const { user } = renderApp()
    await rowFor('Documents')
    await user.click(screen.getByRole('button', { name: 'Two panes' }))

    const paneA = await screen.findByRole('region', { name: 'Pane A' })
    const paneB = await screen.findByRole('region', { name: 'Pane B' })

    await user.dblClick(await within(paneA).findByRole('row', { name: /^Documents/ }))
    const file = await within(paneA).findByRole('row', { name: /^Resume/ })
    await user.dblClick(await within(paneB).findByRole('row', { name: /^Downloads/ }))
    await within(paneB).findByRole('row', { name: /project-backup/ })

    drag(file, within(paneB).getByRole('grid', { name: 'Folder contents' }))

    await waitFor(async () =>
      expect(await bridge.fs.exists(`${HOME}/Downloads/Resume.pdf`)).toBe(true),
    )
    expect(await bridge.fs.exists(`${HOME}/Documents/Resume.pdf`)).toBe(false)
  })
})

describe('dropping in from Finder', () => {
  it('copies onto the folder under the pointer', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Documents'))
    const folder = await rowFor('Work')

    // The native layer reports coordinates, not an element; elementFromPoint is
    // stubbed to answer with the row that would be there.
    document.elementFromPoint = () => folder
    __emitFileDrop({ x: 100, y: 100, paths: [`${HOME}/Downloads/project-backup-jan.zip`] })

    await waitFor(async () =>
      expect(await bridge.fs.exists(`${HOME}/Documents/Work/project-backup-jan.zip`)).toBe(true),
    )
    // External drops copy; the original stays in Downloads.
    expect(await bridge.fs.exists(`${HOME}/Downloads/project-backup-jan.zip`)).toBe(true)
  })

  it('says so rather than guessing when dropped on chrome', async () => {
    renderApp()
    await rowFor('Documents')

    document.elementFromPoint = () => document.body
    __emitFileDrop({ x: 0, y: 0, paths: [`${HOME}/Downloads/project-backup-jan.zip`] })

    expect(await screen.findByText('Nothing was copied')).toBeInTheDocument()
  })
})
