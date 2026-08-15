/**
 * M13 acceptance: the Photos view, driven through the real chrome against the
 * mock filesystem.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { bridge } from '@/services/bridge'
import { useClipboardStore } from '@/stores/clipboardStore'
import { useHistoryStore } from '@/stores/historyStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useToastStore } from '@/stores/toastStore'
import { useUiStore } from '@/stores/uiStore'
import { __resetIdCounter, useWorkspaceStore } from '@/stores/workspaceStore'

const HOME = '/Users/dev'
const PICTURES = `${HOME}/Pictures`
const CAMERA_ROLL = `${PICTURES}/Camera Roll`

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
const filmstrip = () => screen.getByRole('listbox', { name: 'Photos' })
/** The stage, scoped: the preview panel renders the same photo (decision 2). */
const stage = () => screen.getByRole('figure')
const onStage = (name: string) =>
  waitFor(() => expect(within(stage()).getByRole('img', { name })).toBeInTheDocument())

function activePane() {
  const state = useWorkspaceStore.getState()
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId)
  return tab ? state.panes[tab.activePaneId] : undefined
}

function selectedPaths(): string[] {
  return Object.values(useSelectionStore.getState().byPane).flatMap((pane) => [...pane.selected])
}

/** Cmd+5 rather than the view menu, so the shortcut is exercised on the way in. */
async function switchToPhotos(user: User) {
  listing().focus()
  await user.keyboard('{Meta>}5{/Meta}')
  await waitFor(() => expect(activePane()?.viewMode).toBe('photos'))
}

async function goToCameraRoll(user: User) {
  await user.dblClick(await rowFor('Pictures'))
  await user.dblClick(await rowFor('Camera Roll'))
  await waitFor(() => expect(activePane()?.path).toBe(CAMERA_ROLL))
  await switchToPhotos(user)
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
  })
  useClipboardStore.setState({ paths: [], mode: null, sourceDir: null })
  useHistoryStore.setState({ entries: [] })
  useToastStore.getState().clear()
  __resetIdCounter()
})

describe('the Photos view', () => {
  it('opens on the first photo with the strip showing it as active', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)

    // The stage carries the filename; the 512 thumbnail beneath it is aria-hidden.
    await onStage('IMG_20250101_001.jpg')

    const options = within(filmstrip()).getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('makes the active photo the pane selection', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)

    // Decision 2: the status bar, preview panel and file operations all read the
    // selection, so Photos writing to it is what makes them work here for free.
    await waitFor(() =>
      expect(selectedPaths()).toEqual([`${CAMERA_ROLL}/IMG_20250101_001.jpg`]),
    )
  })

  it('steps with the arrow keys', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)
    await onStage('IMG_20250101_001.jpg')

    await user.keyboard('{ArrowRight}')
    await onStage('IMG_20250105_002.jpg')

    await user.keyboard('{ArrowLeft}')
    await onStage('IMG_20250101_001.jpg')
  })

  it('jumps to the ends with Home and End', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)
    await onStage('IMG_20250101_001.jpg')

    await user.keyboard('{End}')
    await onStage('IMG_20250110_003.jpg')

    await user.keyboard('{Home}')
    await onStage('IMG_20250101_001.jpg')
  })

  it('steps with the nav buttons, which are absent at the ends', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)
    await onStage('IMG_20250101_001.jpg')

    // The mockup removes the button rather than disabling it.
    expect(screen.queryByRole('button', { name: 'Previous photo' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Next photo' }))
    await onStage('IMG_20250105_002.jpg')
    expect(screen.getByRole('button', { name: 'Previous photo' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next photo' }))
    await onStage('IMG_20250110_003.jpg')
    expect(screen.queryByRole('button', { name: 'Next photo' })).toBeNull()
  })

  it('makes a thumbnail click the active photo', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)

    const third = within(filmstrip()).getAllByRole('option')[2]
    expect(third).toBeDefined()
    await user.click(third!)

    await onStage('IMG_20250110_003.jpg')
    expect(third).toHaveAttribute('aria-selected', 'true')
  })

  it('leaves folders out of the strip', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Pictures'))
    await waitFor(() => expect(activePane()?.path).toBe(PICTURES))
    await switchToPhotos(user)

    // Pictures holds three folders and one image. The filter has already removed
    // the folders that folders-first would have hoisted (decision 10).
    const options = within(filmstrip()).getAllByRole('option')
    expect(options).toHaveLength(1)
    await onStage('vacation-sunset.jpg')
  })

  it('shows its own empty state when the folder holds no images', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Documents'))
    await switchToPhotos(user)

    // Distinct from "This folder is empty" — the folder is full of PDFs.
    await screen.findByText('No images in this folder')
    expect(screen.queryByText('This folder is empty')).toBeNull()
  })

  it('virtualizes the strip rather than mounting every thumb', async () => {
    const folder = `${PICTURES}/Bulk`
    await bridge.fs.createFolder(PICTURES, 'Bulk')
    await Promise.all(
      Array.from({ length: 2000 }, (_, index) =>
        bridge.fs.createFile(folder, `photo-${String(index).padStart(4, '0')}.jpg`),
      ),
    )

    const { user } = renderApp()
    await user.dblClick(await rowFor('Pictures'))
    await user.dblClick(await rowFor('Bulk'))
    await waitFor(() => expect(activePane()?.path).toBe(folder))
    await switchToPhotos(user)

    await waitFor(() => expect(within(filmstrip()).getAllByRole('option').length).toBeGreaterThan(0))
    // 80px thumbs across a 1000px stub viewport, plus overscan — nowhere near 2000.
    expect(within(filmstrip()).getAllByRole('option').length).toBeLessThan(60)
  })

  // jsdom does no layout, so this pins the declared floors rather than the
  // resulting geometry — the sizes themselves were measured in the running app.
  it('gives the strip and its thumbs their minimum sizes', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)

    expect(filmstrip()).toHaveStyle({ minHeight: '150px' })
    for (const thumb of within(filmstrip()).getAllByRole('option')) {
      expect(thumb).toHaveStyle({ minWidth: '50px', minHeight: '50px' })
    }
  })

  it('keeps plain arrows away from the shortcut registry', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)
    await onStage('IMG_20250101_001.jpg')

    // Left/Right step here, so they must not also reach Cmd-less bindings or the
    // pane's back/forward. The path is the check: stepping is not navigation.
    await user.keyboard('{ArrowRight}')
    await onStage('IMG_20250105_002.jpg')
    expect(activePane()?.path).toBe(CAMERA_ROLL)
  })
})
