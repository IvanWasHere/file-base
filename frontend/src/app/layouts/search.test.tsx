/**
 * M8 acceptance: search driven through the real chrome against the mock
 * filesystem — the toolbar, the search bar, both scopes, the filters and the
 * results strip.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { useSearchStore } from '@/stores/searchStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUiStore } from '@/stores/uiStore'
import { __resetIdCounter, useWorkspaceStore } from '@/stores/workspaceStore'

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
const rowNames = () =>
  screen.queryAllByRole('row').map((row) => row.textContent?.trim().split('—')[0]?.trim() ?? '')

type User = ReturnType<typeof userEvent.setup>

async function openSearch(user: User) {
  await user.click(screen.getByRole('button', { name: 'Search' }))
  return screen.findByRole('searchbox', { name: 'Search' })
}

/**
 * Types into the field explicitly rather than relying on focus. Clicking a
 * scope or filter control moves focus to that control, so `user.keyboard`
 * afterwards would type into a button.
 */
async function searchFor(user: User, text: string) {
  await user.type(screen.getByRole('searchbox', { name: 'Search' }), text)
}

async function searchSubfolders(user: User, text: string) {
  await user.click(screen.getByRole('button', { name: 'Subfolders' }))
  await searchFor(user, text)
}

async function goTo(user: User, folder: string, expectRow: string) {
  await user.dblClick(await rowFor(folder))
  await rowFor(expectRow)
}

beforeEach(() => {
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

describe('opening', () => {
  it('opens from the toolbar with the field focused', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    const input = await openSearch(user)
    expect(input).toHaveFocus()
  })

  it('opens with Cmd+F', async () => {
    const { user } = renderApp()
    await user.click(await rowFor('Documents'))
    await user.keyboard('{Meta>}f{/Meta}')

    expect(await screen.findByRole('searchbox', { name: 'Search' })).toBeInTheDocument()
  })

  it('Escape closes it and restores the full listing', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await openSearch(user)
    await searchFor(user, 'budget')
    await waitFor(() => expect(screen.queryByRole('row', { name: /^Documents/ })).toBeNull())

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('searchbox')).toBeNull())
    expect(await rowFor('Documents')).toBeInTheDocument()
  })
})

describe('filtering the current folder', () => {
  it('narrows the listing as you type, without leaving the folder', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Budget Template\\.xlsx')

    await openSearch(user)
    await searchFor(user, 'budget')

    expect(await rowFor('Budget Template\\.xlsx')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('row', { name: /^Resume/ })).toBeNull())
  })

  it('reports the match count', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Budget Template\\.xlsx')

    await openSearch(user)
    await searchFor(user, 'budget')

    expect(await screen.findByText(/1 match in this folder/)).toBeInTheDocument()
  })

  it('matches case-insensitively', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Budget Template\\.xlsx')

    await openSearch(user)
    await searchFor(user, 'BUDGET')

    expect(await rowFor('Budget Template\\.xlsx')).toBeInTheDocument()
  })

  // The folder filter never descends, however much it looks like search.
  it('does not reach into subfolders', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Budget Template\\.xlsx')

    await openSearch(user)
    await searchFor(user, 'acme')

    await waitFor(() => expect(rowNames().filter(Boolean)).toHaveLength(0))
  })
})

describe('searching subfolders', () => {
  it('finds matches across the whole tree', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await openSearch(user)
    await searchSubfolders(user, 'report')

    // Two different subtrees: Documents/ and Pictures/Screenshots/.
    expect(await rowFor('Annual Report 2024\\.pdf')).toBeInTheDocument()
    expect(await rowFor('bug-report-01\\.png')).toBeInTheDocument()
  })

  it('shows which folder was searched and how many matched', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await openSearch(user)
    await searchSubfolders(user, 'report')

    await screen.findByText(/2 matches/)
    expect(screen.getByText(/Searched dev/)).toBeInTheDocument()
  })

  it('starts from the folder the pane is showing', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Budget Template\\.xlsx')

    await openSearch(user)
    // "acme" is deliberately nothing in Documents itself: the only match lives
    // two levels down, so finding it proves the walk descended rather than the
    // row having been in the listing all along.
    await searchSubfolders(user, 'acme')

    expect(await rowFor('Acme Corp Proposal\\.pdf')).toBeInTheDocument()
  })

  it('does not reach outside the folder the pane is showing', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Budget Template\\.xlsx')

    await openSearch(user)
    await searchSubfolders(user, 'report')

    // Annual Report is under Documents; the screenshot in Pictures is not.
    expect(await rowFor('Annual Report 2024\\.pdf')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('row', { name: /^bug-report/ })).toBeNull())
  })

  it('reports finding nothing rather than looking empty', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await openSearch(user)
    await searchSubfolders(user, 'zzzznothing')

    expect(await screen.findByText(/0 matches/)).toBeInTheDocument()
  })
})

describe('filters', () => {
  it('narrows by file type', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Budget Template\\.xlsx')

    await openSearch(user)
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    await user.type(screen.getByRole('textbox', { name: 'Extensions' }), 'xlsx')

    expect(await rowFor('Budget Template\\.xlsx')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('row', { name: /^Resume/ })).toBeNull())
  })

  it('narrows to folders only', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Budget Template\\.xlsx')

    await openSearch(user)
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /Show/ }), 'folder')

    expect(await rowFor('Work')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('row', { name: /^Resume/ })).toBeNull())
  })

  // Filters alone are a question in the current folder, even with no words.
  it('applies with an empty query', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Budget Template\\.xlsx')

    await openSearch(user)
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /Show/ }), 'folder')

    expect(await screen.findByText(/2 matches in this folder/)).toBeInTheDocument()
  })

  it('reveals hidden files when asked', async () => {
    const { user } = renderApp()
    await goTo(user, 'Downloads', 'project-backup-jan\\.zip')

    await openSearch(user)
    await searchFor(user, 'ds_store')
    await waitFor(() => expect(rowNames().filter(Boolean)).toHaveLength(0))

    await user.click(screen.getByRole('button', { name: 'Filters' }))
    await user.click(screen.getByRole('checkbox', { name: /Hidden files/ }))

    expect(await rowFor('\\.DS_Store')).toBeInTheDocument()
  })
})

describe('scope changes', () => {
  it('discards results that belonged to the other scope', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await openSearch(user)
    await searchSubfolders(user, 'report')
    await rowFor('bug-report-01\\.png')

    // Back to folder scope: nothing at home is called "report".
    await user.click(screen.getByRole('button', { name: 'This Folder' }))

    await waitFor(() => expect(screen.queryByRole('row', { name: /^bug-report/ })).toBeNull())
  })
})
