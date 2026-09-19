/**
 * §M26 acceptance: a newly created, pasted or duplicated item sits at the top
 * of the listing until it has been seen — driven through the real chrome
 * against the mock filesystem.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { useClipboardStore } from '@/stores/clipboardStore'
import { useFreshStore } from '@/stores/freshStore'
import { useHistoryStore } from '@/stores/historyStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useToastStore } from '@/stores/toastStore'
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

type User = ReturnType<typeof userEvent.setup>

const rowFor = (name: string) => screen.findByRole('row', { name: new RegExp(`^${name}\\b`) })
const listing = () => screen.getByRole('grid', { name: 'Folder contents' })

/**
 * The listing in the order it is drawn — the whole point of this milestone.
 *
 * A row being renamed has a text field where its name cell's text would be, so
 * that one is read from the field. Without it the row a creation test is about
 * is the one row that reads as blank.
 */
const names = () =>
  within(listing())
    .getAllByRole('row')
    .map((row) => {
      const editor = within(row).queryByRole('textbox')
      if (editor) return (editor as HTMLInputElement).value
      return within(row).getAllByRole('gridcell')[0]?.textContent?.trim() ?? ''
    })

async function goToDocuments(user: User) {
  await user.dblClick(await rowFor('Documents'))
  await rowFor('Resume\\.pdf')
}

async function openMenu(user: User, menu: string): Promise<HTMLElement> {
  const menubar = screen.getByRole('menubar', { name: 'Application' })
  await user.click(within(menubar).getByRole('menuitem', { name: menu }))
  return screen.findByRole('menu', { name: menu })
}

async function runMenuCommand(user: User, menu: string, item: string) {
  const popup = await openMenu(user, menu)
  await user.click(within(popup).getByRole('menuitem', { name: item }))
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
  useFreshStore.getState().clear()
  useToastStore.getState().clear()
  __resetIdCounter()
})

describe('a newly created item', () => {
  it('sits at the top while its name is being edited', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    // Sorted, "untitled folder" would land between Personal and Work — and in
    // a folder of four hundred items, off the bottom of the pane entirely.
    await user.click(screen.getByRole('button', { name: 'New Folder' }))
    await screen.findByRole('textbox', { name: 'Rename untitled folder' })

    expect(names()[0]).toBe('untitled folder')
  })

  it('drops into its sorted place once the name is settled', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(screen.getByRole('button', { name: 'New Folder' }))
    const editor = await screen.findByRole('textbox', { name: 'Rename untitled folder' })
    expect(names()[0]).toBe('untitled folder')

    await user.clear(editor)
    await user.type(editor, 'Taxes{Enter}')

    // Folders first, then alphabetical: Personal, Taxes, Work.
    await waitFor(() => expect(names()[1]).toBe('Taxes'))
    expect(names()[0]).toBe('Personal')
  })

  it('drops back when the rename is abandoned', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(screen.getByRole('button', { name: 'New Folder' }))
    const editor = await screen.findByRole('textbox', { name: 'Rename untitled folder' })
    await user.type(editor, '{Escape}')

    // Escape keeps the folder — it was already created — and only closes the
    // editor, which is what un-pins it.
    await waitFor(() => expect(names()[1]).toBe('untitled folder'))
    expect(names()).toContain('untitled folder')
  })

  it('leaves the pin behind when the pane navigates away', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(screen.getByRole('button', { name: 'New Folder' }))
    const editor = await screen.findByRole('textbox', { name: 'Rename untitled folder' })
    await user.clear(editor)
    await user.type(editor, 'Zebra{Enter}')
    await rowFor('Zebra')

    await user.dblClick(await rowFor('Personal'))
    await rowFor('Travel Plans\\.docx')
    await user.click(screen.getByRole('button', { name: 'Back' }))

    // Sorted where it belongs, not held at the top from last time.
    await waitFor(() => expect(names()[2]).toBe('Zebra'))
  })
})

describe('pasted and duplicated items', () => {
  it('puts a pasted file at the top of the destination', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Resume\\.pdf'))
    await runMenuCommand(user, 'Edit', 'Copy')

    // Into Personal, where it would otherwise sort last of three.
    await user.dblClick(await rowFor('Personal'))
    await rowFor('Travel Plans\\.docx')
    listing().focus()
    await user.keyboard('{Meta>}v{/Meta}')

    await waitFor(() => expect(names()[0]).toBe('Resume.pdf'))
    // And the rest keep the order the sort gave them.
    expect(names().slice(1)).toEqual(['Tax Returns', 'Travel Plans.docx'])
  })

  it('puts a duplicate at the top rather than beside its original', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Annual Report 2024\\.pdf'))
    await runMenuCommand(user, 'File', 'Duplicate')

    await waitFor(() => expect(names()[0]).toBe('Annual Report 2024 copy.pdf'))
  })

  it('drops them back on the next thing the user does', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Annual Report 2024\\.pdf'))
    await runMenuCommand(user, 'File', 'Duplicate')
    await waitFor(() => expect(names()[0]).toBe('Annual Report 2024 copy.pdf'))

    // Any selection counts as the next move — this one is a click on another
    // row, but an arrow key or Select All lands in the same place.
    await user.click(await rowFor('Resume\\.pdf'))

    await waitFor(() => expect(names()[0]).toBe('Personal'))
    // Folders first, then "Annual Report 2024 copy.pdf" ahead of the original,
    // because a space sorts before a dot.
    expect(names()[2]).toBe('Annual Report 2024 copy.pdf')
  })

  it('drops them back when the sort changes', async () => {
    const { user } = renderApp()
    await goToDocuments(user)

    await user.click(await rowFor('Annual Report 2024\\.pdf'))
    await runMenuCommand(user, 'File', 'Duplicate')
    await waitFor(() => expect(names()[0]).toBe('Annual Report 2024 copy.pdf'))

    // Asking for a different order is asking for the real one.
    await user.click(screen.getByRole('columnheader', { name: /^Size/ }))

    await waitFor(() => expect(names()[0]).not.toBe('Annual Report 2024 copy.pdf'))
  })
})
