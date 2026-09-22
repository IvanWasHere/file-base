/**
 * M13 acceptance: the Photos view, driven through the real chrome against the
 * mock filesystem.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
/** The zoom transform, which both image layers sit under (§M30). */
const transform = () => (stage().firstElementChild as HTMLElement).style.transform
/** Its three numbers, because floating point makes string matching a lottery. */
function transformed() {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(transform())
  expect(match).not.toBeNull()
  return { x: Number(match![1]), y: Number(match![2]), scale: Number(match![3]) }
}

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
    await waitFor(() => expect(selectedPaths()).toEqual([`${CAMERA_ROLL}/IMG_20250101_001.jpg`]))
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

    await waitFor(() =>
      expect(within(filmstrip()).getAllByRole('option').length).toBeGreaterThan(0),
    )
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

  it('gives every card the same 16:9 frame', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)

    const cards = within(filmstrip()).getAllByRole('option')
    const sizes = cards.map((card) => ({
      width: Number.parseFloat(card.style.width),
      height: Number.parseFloat(card.style.height),
    }))

    // One frame for the whole strip, whatever shape the photos in it are.
    expect(new Set(sizes.map((size) => `${size.width}x${size.height}`)).size).toBe(1)

    const [first] = sizes
    expect(first).toBeDefined()
    expect(first!.width / first!.height).toBeCloseTo(16 / 9, 2)
  })

  it('zooms the stage in and out, and back to fit', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)
    await onStage('IMG_20250101_001.jpg')

    // Fit is the floor, so there is nothing to zoom out of yet.
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('100%')
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('156%')
    expect(transform()).toContain('scale(1.5625)')

    await user.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('125%')

    // The readout is the way back to the whole picture.
    await user.click(screen.getByRole('button', { name: 'Reset zoom' }))
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('100%')
    expect(transform()).toContain('scale(1)')
  })

  it('zooms with the keyboard and puts the photo back with Escape', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)
    await onStage('IMG_20250101_001.jpg')

    await user.keyboard('+')
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('125%')

    await user.keyboard('-')
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('100%')

    await user.keyboard('+0')
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('100%')

    await user.keyboard('+{Escape}')
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('100%')
    // Escape only reset the zoom; the photo is still selected (decision 5).
    expect(selectedPaths()).toEqual([`${CAMERA_ROLL}/IMG_20250101_001.jpg`])
  })

  it('pans with the arrows while zoomed, and steps again once it is not', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)
    await onStage('IMG_20250101_001.jpg')

    await user.keyboard('+')
    await user.keyboard('{ArrowRight}')

    // A fifth of the 1000px frame is 200px, moved left to show what is off to
    // the right, and clamped to the 125% overhang of 125px either side.
    expect(transformed()).toMatchObject({ x: -125, y: 0 })
    // Still the same photo: while zoomed the arrows move the picture, not the
    // selection (§M30 decision 5).
    await onStage('IMG_20250101_001.jpg')

    await user.keyboard('{Escape}')
    await user.keyboard('{ArrowRight}')
    await onStage('IMG_20250105_002.jpg')
  })

  it('zooms about the pointer on a wheel', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)
    await onStage('IMG_20250101_001.jpg')

    // The stub frame is 1000×800 at the origin, so this is 250px right of centre.
    fireEvent.wheel(stage(), { deltaY: -100, clientX: 750, clientY: 400 })

    // exp(100 × 0.0025) = 1.284×, and the point under the cursor stays put:
    // x = 250 − 1.284 × 250, well inside the overhang at this scale.
    const scale = Math.exp(0.25)
    const moved = transformed()
    expect(moved.scale).toBeCloseTo(scale, 6)
    expect(moved.x).toBeCloseTo(250 * (1 - scale), 6)
    expect(moved.y).toBeCloseTo(0, 6)
  })

  it('drags the zoomed photo around, stopping at its edges', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)
    await onStage('IMG_20250101_001.jpg')

    await user.keyboard('+')
    const layers = stage().firstElementChild as HTMLElement

    fireEvent.pointerDown(layers, { button: 0, clientX: 500, clientY: 400 })
    fireEvent.pointerMove(window, { clientX: 560, clientY: 430 })
    expect(transformed()).toMatchObject({ x: 60, y: 30 })

    // Past the 125px overhang the picture stops rather than leaving a gap.
    fireEvent.pointerMove(window, { clientX: 5000, clientY: 400 })
    expect(transformed()).toMatchObject({ x: 125, y: 0 })

    // The drag ends with the pointer, wherever it is by then.
    fireEvent.pointerUp(window)
    fireEvent.pointerMove(window, { clientX: 0, clientY: 400 })
    expect(transformed()).toMatchObject({ x: 125, y: 0 })
  })

  it('leaves a photo at fit alone when it is dragged', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)
    await onStage('IMG_20250101_001.jpg')

    // Nothing overflows at 100%, so a drag has nowhere to take it.
    const layers = stage().firstElementChild as HTMLElement
    fireEvent.pointerDown(layers, { button: 0, clientX: 500, clientY: 400 })
    fireEvent.pointerMove(window, { clientX: 700, clientY: 400 })
    expect(transformed()).toMatchObject({ x: 0, y: 0, scale: 1 })
    fireEvent.pointerUp(window)
  })

  it('drops the zoom when the photo changes', async () => {
    const { user } = renderApp()
    await goToCameraRoll(user)
    await onStage('IMG_20250101_001.jpg')

    await user.keyboard('+')
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('125%')

    // A crop of one photo means nothing on the next one (§M30 decision 3).
    await user.click(screen.getByRole('button', { name: 'Next photo' }))
    await onStage('IMG_20250105_002.jpg')
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('100%')
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
