/**
 * The M1 acceptance criterion, as a test: one pane lists a real directory in
 * Details view and navigates into folders.
 *
 * Runs against the mock bridge, so it exercises the same component tree the app
 * uses without needing a Go process.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ExplorerPane } from './ExplorerPane'
import { createQueryClient } from '@/app/providers/queryClient'

const HOME = '/Users/dev'

function renderPane(initialPath = HOME) {
  const client = createQueryClient()
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={client}>
        <ExplorerPane initialPath={initialPath} />
      </QueryClientProvider>,
    ),
  }
}

async function rowFor(name: string) {
  return await screen.findByRole('row', { name: new RegExp(`^${name}\\b`) })
}

describe('ExplorerPane', () => {
  it('lists the directory in Details view with metadata columns', async () => {
    renderPane()

    expect(await screen.findByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Size' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Modified' })).toBeInTheDocument()

    expect(await rowFor('Documents')).toBeInTheDocument()
    expect(await rowFor('Downloads')).toBeInTheDocument()
  })

  it('sorts folders first, then alphabetically', async () => {
    renderPane(`${HOME}/Projects/vault-explorer`)

    await screen.findByRole('row', { name: /^src/ })
    const names = screen
      .getAllByRole('row')
      .slice(1) // drop the header row
      .map((row) => within(row).getAllByRole('gridcell')[0]?.textContent?.trim())

    // "src" is the only directory here, so it leads despite sorting last by name.
    expect(names[0]).toBe('src')
    expect(names.slice(1)).toEqual(['package.json', 'README.md'])
  })

  it('hides dotfiles by default', async () => {
    renderPane(`${HOME}/Downloads`)

    await screen.findByRole('row', { name: /project-backup-jan\.zip/ })
    expect(screen.queryByRole('row', { name: /\.DS_Store/ })).not.toBeInTheDocument()
  })

  it('formats sizes and shows an em dash for folders', async () => {
    renderPane(`${HOME}/Downloads`)

    const zip = await rowFor('project-backup-jan\\.zip')
    expect(within(zip).getByText('64.7 MB')).toBeInTheDocument()
    expect(within(zip).getByText('ZIP')).toBeInTheDocument()
  })

  it('selects a row on single click', async () => {
    const { user } = renderPane()

    const documents = await rowFor('Documents')
    expect(documents).toHaveAttribute('aria-selected', 'false')

    await user.click(documents)
    expect(documents).toHaveAttribute('aria-selected', 'true')
  })

  it('navigates into a folder on double click and updates the breadcrumb', async () => {
    const { user } = renderPane()

    await user.dblClick(await rowFor('Documents'))

    expect(await rowFor('Annual Report 2024\\.pdf')).toBeInTheDocument()

    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByRole('button', { name: 'Documents' })).toBeInTheDocument()
  })

  it('navigates back up via a breadcrumb segment', async () => {
    const { user } = renderPane(`${HOME}/Documents/Work`)

    await rowFor('Contract Draft\\.pdf')

    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    await user.click(within(breadcrumb).getByRole('button', { name: 'Documents' }))

    expect(await rowFor('Annual Report 2024\\.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /Contract Draft/ })).not.toBeInTheDocument()
  })

  it('shows an empty state for a folder with no children', async () => {
    renderPane(`${HOME}/Desktop`)
    expect(await screen.findByText('This folder is empty')).toBeInTheDocument()
  })

  it('reports the item count', async () => {
    renderPane(`${HOME}/Projects`)
    await waitFor(() => {
      expect(screen.getByText('3 items')).toBeInTheDocument()
    })
  })
})
