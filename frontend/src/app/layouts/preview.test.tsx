/**
 * M10 acceptance: the preview panel and thumbnails through the real chrome.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { bridge } from '@/services/bridge'
import { __resetThumbnailRequests } from '@/services/thumbs/thumbCache'
import { previewKindFor, TEXT_CAP } from '@/features/preview/previewKind'
import { useSearchStore } from '@/stores/searchStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import { __resetIdCounter, useWorkspaceStore } from '@/stores/workspaceStore'
import type { FileItem } from '@/types/file'

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
const preview = () => screen.findByRole('complementary', { name: 'Preview' })

function fileLike(overrides: Partial<FileItem>): FileItem {
  return {
    id: '/x',
    path: '/x',
    name: 'x',
    extension: '',
    size: 10,
    isDirectory: false,
    createdAt: 0,
    modifiedAt: 0,
    permissions: '-rw-r--r--',
    hidden: false,
    symlink: false,
    mimeType: '',
    tags: [],
    category: 'default',
    broken: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  __resetThumbnailRequests()
  useWorkspaceStore.setState({ tabs: [], panes: {}, activeTabId: null })
  useSelectionStore.setState({ byPane: {} })
  useSearchStore.setState({ byPane: {} })
  useUiStore.setState({
    previewOpen: false,
    sidebarOpen: true,
    showHiddenFiles: false,
    dialog: null,
    renaming: null,
    contextMenu: null,
  })
  __resetIdCounter()
})

describe('previewKindFor', () => {
  it('routes by extension', () => {
    expect(previewKindFor(fileLike({ extension: 'png' }))).toBe('image')
    expect(previewKindFor(fileLike({ extension: 'svg' }))).toBe('image')
    expect(previewKindFor(fileLike({ extension: 'pdf' }))).toBe('pdf')
    expect(previewKindFor(fileLike({ extension: 'ts' }))).toBe('text')
    expect(previewKindFor(fileLike({ extension: 'mp4' }))).toBe('none')
  })

  it('shows small extensionless files as text — README, LICENSE, Makefile', () => {
    expect(previewKindFor(fileLike({ extension: '', size: 400 }))).toBe('text')
    // But not an extensionless multi-gigabyte blob.
    expect(previewKindFor(fileLike({ extension: '', size: TEXT_CAP * 10 }))).toBe('none')
  })

  it('never previews folders or broken entries', () => {
    expect(previewKindFor(fileLike({ extension: 'png', isDirectory: true }))).toBe('none')
    expect(previewKindFor(fileLike({ extension: 'png', broken: true }))).toBe('none')
  })
})

describe('text preview', () => {
  it('shows the contents of a selected text file', async () => {
    vi.spyOn(bridge.fs, 'readTextFile').mockResolvedValue('export const answer = 42')

    const { user } = renderApp()
    await user.dblClick(await rowFor('Projects'))
    await user.dblClick(await rowFor('vault-explorer'))
    await user.click(await rowFor('README\\.md'))

    expect(await within(await preview()).findByText(/export const answer = 42/)).toBeInTheDocument()
  })

  // Go reads at most the cap and says nothing about it; the panel compares
  // against the size it already knows.
  it('says when a large file was truncated', async () => {
    vi.spyOn(bridge.fs, 'readTextFile').mockResolvedValue('x'.repeat(100))
    vi.spyOn(bridge.fs, 'readDirectory').mockResolvedValue([
      fileLike({
        id: `${HOME}/huge.log`,
        path: `${HOME}/huge.log`,
        name: 'huge.log',
        extension: 'log',
        size: TEXT_CAP * 4,
      }),
    ])

    const { user } = renderApp()
    await user.click(await rowFor('huge\\.log'))

    expect(await screen.findByText(/Showing the first/)).toBeInTheDocument()
  })

  it('reports a read failure instead of showing an empty box', async () => {
    const { FsError } = await import('@/types/errors')
    vi.spyOn(bridge.fs, 'readTextFile').mockRejectedValue(
      new FsError('permission-denied', 'nope', `${HOME}/x`),
    )

    const { user } = renderApp()
    await user.dblClick(await rowFor('Projects'))
    await user.dblClick(await rowFor('vault-explorer'))
    await user.click(await rowFor('README\\.md'))

    expect(await screen.findByText(/Privacy & Security/)).toBeInTheDocument()
  })
})

describe('image preview', () => {
  it('renders the image inline', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Pictures'))
    await user.dblClick(await rowFor('Wallpapers'))
    await user.click(await rowFor('neon-city\\.jpg'))

    const image = await within(await preview()).findByRole('img', { name: 'neon-city.jpg' })
    expect(image).toHaveAttribute('src', expect.stringContaining('data:image/jpeg;base64,'))
  })

  it('refuses an oversized image with a reason rather than a blank frame', async () => {
    const { FsError } = await import('@/types/errors')
    vi.spyOn(bridge.fs, 'readFileBase64').mockRejectedValue(
      new FsError('too-large', 'too big', `${HOME}/x`),
    )

    const { user } = renderApp()
    await user.dblClick(await rowFor('Pictures'))
    await user.dblClick(await rowFor('Wallpapers'))
    await user.click(await rowFor('neon-city\\.jpg'))

    expect(await screen.findByText(/too large to preview/)).toBeInTheDocument()
  })
})

describe('metadata', () => {
  // The listing already carries it, so it must not wait on a content read.
  it('shows without waiting for the content', async () => {
    let release: (value: string) => void = () => {}
    vi.spyOn(bridge.fs, 'readTextFile').mockReturnValue(
      new Promise<string>((resolve) => {
        release = resolve
      }),
    )

    const { user } = renderApp()
    await user.dblClick(await rowFor('Projects'))
    await user.dblClick(await rowFor('vault-explorer'))
    await user.click(await rowFor('README\\.md'))

    const panel = await preview()
    expect(await within(panel).findByText('README.md')).toBeInTheDocument()
    expect(within(panel).getByText('MD')).toBeInTheDocument()

    release('done')
  })

  it('falls back to the file icon for a type with no preview', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Movies'))
    await user.click(await rowFor('tutorial-react-hooks\\.mp4'))

    const panel = await preview()
    expect(within(panel).getByText('tutorial-react-hooks.mp4')).toBeInTheDocument()
    // No content reader was involved, so nothing is loading and nothing failed.
    expect(within(panel).queryByRole('img')).toBeNull()
  })
})

// §M23: what an image editor shows about an image, read from the file's header.
describe('image metadata', () => {
  const metadata = async () =>
    within(await preview()).findByRole('region', { name: 'Image metadata' })

  const rowValue = async (label: string) => {
    const section = await metadata()
    const term = within(section).getByText(label)
    // The value is the `dd` beside the `dt`, which is the row's other child.
    return term.parentElement?.lastElementChild?.textContent
  }

  it('shows the camera data a photograph carries', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Pictures'))
    await user.dblClick(await rowFor('Camera Roll'))
    await user.click(await rowFor('IMG_20250101_001\\.jpg'))

    const section = await metadata()
    expect(within(section).getByText('Image')).toBeInTheDocument()
    expect(within(section).getByText('Camera')).toBeInTheDocument()

    expect(await rowValue('Dimensions')).toBe('4,032 × 3,024 px')
    expect(await rowValue('Megapixels')).toBe('12.2 MP')
    expect(await rowValue('Aspect ratio')).toBe('4:3')
    expect(await rowValue('Color mode')).toBe('RGB, 8-bit')
    expect(await rowValue('Color profile')).toBe('Display P3')
    expect(await rowValue('Model')).toBe('Apple iPhone 15 Pro')
    expect(await rowValue('Shutter')).toBe('1/250 s')
    expect(await rowValue('Aperture')).toBe('ƒ/1.8')
    expect(await rowValue('ISO')).toBe('64')
    expect(await rowValue('Focal length')).toBe('6.8 mm (24 mm equivalent)')
  })

  it('shows where a geotagged photo was taken, in hemispheres', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Pictures'))
    await user.dblClick(await rowFor('Camera Roll'))
    await user.click(await rowFor('IMG_20250101_001\\.jpg'))

    const section = await metadata()
    expect(within(section).getByText('Location')).toBeInTheDocument()
    expect(await rowValue('Coordinates')).toBe('22.90680° S, 43.17290° W')
    expect(await rowValue('Altitude')).toBe('12.5 m')
  })

  // A screenshot has dimensions and nothing else, and the panel has to say so
  // by falling silent rather than by printing a column of dashes (§M23).
  it('shows only what a screenshot actually knows', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Pictures'))
    await user.dblClick(await rowFor('Screenshots'))
    await user.click(await rowFor('bug-report-01\\.png'))

    const section = await metadata()
    expect(within(section).getByText('Image')).toBeInTheDocument()
    expect(within(section).queryByText('Camera')).toBeNull()
    expect(within(section).queryByText('Location')).toBeNull()
    expect(await rowValue('Color mode')).toBe('RGB, 8-bit + alpha')
  })

  it('says nothing at all about a file that is not an image', async () => {
    const { user } = renderApp()
    await user.dblClick(await rowFor('Movies'))
    await user.click(await rowFor('tutorial-react-hooks\\.mp4'))

    await preview()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Image metadata' })).toBeNull())
  })

  // An image the system cannot identify — an SVG, or a text file named .png —
  // is not an error worth showing: the rows above already said what is known.
  it('stays quiet when the metadata cannot be read', async () => {
    const { FsError } = await import('@/types/errors')
    vi.spyOn(bridge.images, 'read').mockRejectedValue(
      new FsError('unknown', 'not an image', `${HOME}/x`),
    )

    const { user } = renderApp()
    await user.dblClick(await rowFor('Pictures'))
    await user.dblClick(await rowFor('Wallpapers'))
    await user.click(await rowFor('neon-city\\.jpg'))

    const panel = await preview()
    expect(await within(panel).findByText('neon-city.jpg')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Image metadata' })).toBeNull())
  })
})

describe('thumbnails', () => {
  it('shows rendered thumbnails in an icon grid, not for every file', async () => {
    const generate = vi.spyOn(bridge.thumbs, 'generate')

    const { user } = renderApp()
    await user.dblClick(await rowFor('Pictures'))
    await user.dblClick(await rowFor('Wallpapers'))

    await user.click(screen.getByRole('button', { name: /Details/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Large Icons' }))

    await waitFor(() => expect(generate).toHaveBeenCalled())
    // Three images in the folder, and nothing asked for anything else.
    await waitFor(() => expect(generate.mock.calls.length).toBe(3))
    for (const [path] of generate.mock.calls) {
      expect(path).toMatch(/\.(jpg|png)$/)
    }
  })
})

// An extension is a claim, not a fact: reading the bytes of a text file named
// `.png` succeeds, and only the decoder knows better.
describe('a file that is not really an image', () => {
  it('falls back to the icon instead of showing an empty frame', async () => {
    vi.spyOn(bridge.fs, 'readFileBase64').mockResolvedValue('bm90IGFuIGltYWdl')

    const { user } = renderApp()
    await user.dblClick(await rowFor('Pictures'))
    await user.dblClick(await rowFor('Wallpapers'))
    await user.click(await rowFor('neon-city\\.jpg'))

    const image = await within(await preview()).findByRole('img', { name: 'neon-city.jpg' })
    fireEvent.error(image)

    expect(await screen.findByText('This image could not be shown.')).toBeInTheDocument()
  })
})
