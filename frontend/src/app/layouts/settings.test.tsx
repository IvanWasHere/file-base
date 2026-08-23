/**
 * §M22 and §M24 acceptance: the Settings modal, the columns it can switch on,
 * the tag picker, and the theme list — driven through the real chrome against
 * the mock filesystem.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ExplorerLayout } from './ExplorerLayout'
import { createQueryClient } from '@/app/providers/queryClient'
import { DEFAULT_LAYOUT, visibleColumns } from '@/constants/columns'
import { CONTEXT_COMMANDS, CONTEXT_MENUS } from '@/constants/contextMenus'
import { BUILTIN_THEMES, baseThemeFor } from '@/constants/palette'
import { DEFAULT_THEME } from '@/constants/themes'
import { bridge } from '@/services/bridge'
import { ensureThemesFolder } from '@/services/theme/themeFiles'
import { useThemeStore } from '@/stores/themeStore'
import { useClipboardStore } from '@/stores/clipboardStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useToastStore } from '@/stores/toastStore'
import { useUiStore } from '@/stores/uiStore'
import { __resetIdCounter, useWorkspaceStore } from '@/stores/workspaceStore'

const HOME = '/Users/dev'
const WORK = `${HOME}/Documents/Work`
const THEMES = `${HOME}/Library/Application Support/MacFileExplorer/Themes`

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

const settings = () => screen.findByRole('dialog', { name: 'File Base Settings' })

const headerLabels = () =>
  screen.getAllByRole('columnheader').map((element) => element.textContent?.trim())

/** Opens Settings the way a user does: File → Settings…. */
async function openSettings(user: User) {
  await user.click(screen.getByRole('menuitem', { name: 'File' }))
  await user.click(await screen.findByRole('menuitem', { name: /^Settings/ }))
  return settings()
}

/**
 * Opens Settings and walks to one of its sections.
 *
 * §M24 put Themes first, so the column and context-menu tests below have to say
 * which panel they mean rather than assuming the one that happened to open.
 */
async function openSection(user: User, label: string) {
  const panel = await openSettings(user)
  await user.click(within(panel).getByRole('button', { name: label }))
  return panel
}

async function goTo(user: User, ...folders: string[]) {
  for (const folder of folders) {
    await user.dblClick(await rowFor(folder))
  }
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
    settingsOpen: false,
    tagsJob: null,
    columnLayout: DEFAULT_LAYOUT,
    hiddenContextCommands: [],
  })
  useClipboardStore.setState({ paths: [], mode: null, sourceDir: null })
  useUiStore.setState({ theme: DEFAULT_THEME })
  useThemeStore.setState({ external: [], loaded: false })
  document.documentElement.removeAttribute('style')
  useToastStore.getState().clear()
  __resetIdCounter()
})

describe('the Settings modal', () => {
  it('opens from the File menu and closes on Escape', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await openSettings(user)
    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'File Base Settings' })).toBeNull(),
    )
  })

  // The whole point of the milestone: a column that was not there before is one
  // checkbox away, and the window behind the modal shows it immediately.
  it('adds a column to the details view when it is ticked', async () => {
    const { user } = renderApp()
    await rowFor('Documents')
    expect(headerLabels()).toEqual(['Name', 'Size', 'Type', 'Modified'])

    const panel = await openSection(user, 'Columns')
    await user.click(within(panel).getByRole('checkbox', { name: /^Tags/ }))
    await user.click(within(panel).getByRole('checkbox', { name: /^Created/ }))

    await waitFor(() =>
      expect(headerLabels()).toEqual(['Name', 'Size', 'Type', 'Modified', 'Created', 'Tags']),
    )
    expect(visibleColumns(useUiStore.getState().columnLayout)).toContain('tags')
  })

  it('removes a column when it is unticked, and the rows follow the header', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    const panel = await openSection(user, 'Columns')
    await user.click(within(panel).getByRole('checkbox', { name: /^Size/ }))
    await user.keyboard('{Escape}')

    await waitFor(() => expect(headerLabels()).toEqual(['Name', 'Type', 'Modified']))
    const row = await rowFor('Documents')
    expect(within(row).getAllByRole('gridcell')).toHaveLength(3)
  })

  // A listing with no Name column has no way back to one, so the row is shown
  // ticked and inert rather than left out.
  it('will not let Name be switched off', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    const panel = await openSection(user, 'Columns')
    const name = within(panel).getByRole('checkbox', { name: /^Name/ })
    expect(name).toBeDisabled()
    expect(name).toHaveAttribute('aria-checked', 'true')
  })

  it('resets the columns from inside Settings', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    const panel = await openSection(user, 'Columns')
    await user.click(within(panel).getByRole('checkbox', { name: /^Tags/ }))
    await waitFor(() => expect(headerLabels()).toHaveLength(5))

    await user.click(within(panel).getByRole('button', { name: 'Reset Columns' }))
    await waitFor(() => expect(useUiStore.getState().columnLayout).toEqual(DEFAULT_LAYOUT))
  })
})

describe('customising the right-click menu', () => {
  it('lists every command the context menus can show', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    const panel = await openSettings(user)
    await user.click(within(panel).getByRole('button', { name: 'Right-click Menu' }))

    expect(within(panel).getAllByRole('checkbox')).toHaveLength(CONTEXT_COMMANDS.length)
    // Every command in the data is offered, so a row cannot be un-hideable.
    for (const id of new Set(Object.values(CONTEXT_MENUS).flat(2))) {
      expect(CONTEXT_COMMANDS).toContain(id)
    }
  })

  it('drops an unticked command from the menu it appears in', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents')

    const panel = await openSettings(user)
    await user.click(within(panel).getByRole('button', { name: 'Right-click Menu' }))
    await user.click(within(panel).getByRole('checkbox', { name: /^Duplicate/ }))
    await user.keyboard('{Escape}')

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Resume\\.pdf') })
    const menu = await screen.findByRole('menu', { name: 'Context menu' })

    expect(within(menu).queryByRole('menuitem', { name: /Duplicate/ })).toBeNull()
    // The command itself is untouched — only this route to it is gone.
    expect(within(menu).getByRole('menuitem', { name: /Rename/ })).toBeInTheDocument()
    expect(useUiStore.getState().hiddenContextCommands).toContain('file.duplicate')
  })

  // Hiding a whole group must not leave a menu opening with a doubled rule or,
  // in the limit, an empty panel that has to be dismissed.
  it('opens no menu at all when every row has been switched off', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents')

    useUiStore.setState({ hiddenContextCommands: [...CONTEXT_COMMANDS] })

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Resume\\.pdf') })
    await waitFor(() => expect(useUiStore.getState().contextMenu).not.toBeNull())
    expect(screen.queryByRole('menu', { name: 'Context menu' })).toBeNull()
  })
})

describe('the tag picker', () => {
  const picker = () => screen.findByRole('dialog', { name: 'Tags' })

  it('shows a file’s existing tags in the Tags column', async () => {
    const { user } = renderApp()
    await rowFor('Documents')
    useUiStore.getState().setColumnVisible('tags', true)

    await goTo(user, 'Documents', 'Work')

    const row = await rowFor('Contract Draft\\.pdf')
    expect(within(row).getByLabelText('Tags: Urgent, Work')).toBeInTheDocument()
  })

  it('tags a file from the context menu and writes it through the bridge', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Work')
    useUiStore.getState().setColumnVisible('tags', true)

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Sprint Planning\\.docx') })
    await user.click(await screen.findByRole('menuitem', { name: /^Tags/ }))

    const panel = await picker()
    await user.click(await within(panel).findByRole('checkbox', { name: 'Red' }))
    await user.click(within(panel).getByRole('button', { name: 'Done' }))

    await waitFor(async () => {
      const info = await bridge.fs.readFileInfo(`${WORK}/Sprint Planning.docx`)
      expect(info.tags).toEqual([{ name: 'Red', color: 6 }])
    })
    // And the listing reflects it without a manual refresh.
    const row = await rowFor('Sprint Planning\\.docx')
    await waitFor(() => expect(within(row).getByLabelText('Tags: Red')).toBeInTheDocument())
  })

  it('removes a tag that every selected file carries', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Work')

    await user.pointer({ keys: '[MouseRight]', target: await rowFor('Contract Draft\\.pdf') })
    await user.click(await screen.findByRole('menuitem', { name: /^Tags/ }))

    const panel = await picker()
    const urgent = await within(panel).findByRole('checkbox', { name: 'Urgent' })
    expect(urgent).toHaveAttribute('aria-checked', 'true')

    await user.click(urgent)
    await user.click(within(panel).getByRole('button', { name: 'Done' }))

    await waitFor(async () => {
      const info = await bridge.fs.readFileInfo(`${WORK}/Contract Draft.pdf`)
      expect(info.tags.map((tag) => tag.name)).toEqual(['Work'])
    })
  })

  // Two files, one tag between them: the checkbox says "mixed" rather than
  // rounding to on or off and quietly rewriting the other file.
  it('reports a tag that only some of the selection carries as mixed', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Work')

    // Opened on the two directly: what is being tested is how the picker reads
    // a *selection*, not how a Cmd-click builds one (that is M4's business).
    useUiStore.getState().openTags([`${WORK}/Contract Draft.pdf`, `${WORK}/Sprint Planning.docx`])

    const panel = await picker()
    const urgent = await within(panel).findByRole('checkbox', { name: 'Urgent' })
    await waitFor(() => expect(urgent).toHaveAttribute('aria-checked', 'mixed'))

    // Clicking a mixed tag finishes the job rather than clearing it.
    await user.click(urgent)
    await user.click(within(panel).getByRole('button', { name: 'Done' }))

    await waitFor(async () => {
      const info = await bridge.fs.readFileInfo(`${WORK}/Sprint Planning.docx`)
      expect(info.tags.map((tag) => tag.name)).toEqual(['Urgent'])
    })
    // …and leaves the file that already had it exactly as it was — same tags,
    // same order, same colours.
    const untouched = await bridge.fs.readFileInfo(`${WORK}/Contract Draft.pdf`)
    expect(untouched.tags).toEqual([
      { name: 'Urgent', color: 6 },
      { name: 'Work', color: 4 },
    ])
  })

  it('creates a tag that does not exist yet', async () => {
    const { user } = renderApp()
    await goTo(user, 'Documents', 'Work')

    useUiStore.getState().openTags([`${WORK}/Team Structure.xlsx`])
    const panel = await picker()

    await user.type(await within(panel).findByLabelText('New tag name'), 'Q3 Budget')
    await user.click(within(panel).getByRole('button', { name: 'Purple' }))
    await user.click(within(panel).getByRole('button', { name: 'Add' }))
    await user.click(within(panel).getByRole('button', { name: 'Done' }))

    await waitFor(async () => {
      const info = await bridge.fs.readFileInfo(`${WORK}/Team Structure.xlsx`)
      expect(info.tags).toEqual([{ name: 'Q3 Budget', color: 3 }])
    })
  })
})

describe('themes', () => {
  const themeRow = (panel: HTMLElement, name: string | RegExp) =>
    within(panel).findByRole('radio', { name })

  const accent = () => document.documentElement.style.getPropertyValue('--accent')

  it('opens on Themes and lists every built-in', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    const panel = await openSettings(user)

    for (const theme of BUILTIN_THEMES) {
      expect(await themeRow(panel, new RegExp(`^${theme.name}\\b`))).toBeInTheDocument()
    }
    expect(await themeRow(panel, /^Match System/)).toBeInTheDocument()
  })

  /**
   * The milestone in one test: a theme is only colours, and picking one repaints
   * the window behind the modal rather than arming an OK button.
   */
  it('repaints the window the moment a theme is picked', async () => {
    const { user } = renderApp()
    await rowFor('Documents')
    expect(accent()).toBe(baseThemeFor('dark').colors.accent)

    const panel = await openSettings(user)
    await user.click(await themeRow(panel, 'Nocturne'))

    const nocturne = BUILTIN_THEMES.find((theme) => theme.id === 'nocturne')
    await waitFor(() => expect(accent()).toBe(nocturne?.colors.accent))
    expect(useUiStore.getState().theme).toBe('nocturne')
  })

  // A light theme has to bring `color-scheme` with it, which is what flips the
  // native scrollbars and the caret. `data-theme` carries the mode, not the id.
  it('puts the mode on the document, not the theme name', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    const panel = await openSettings(user)
    await user.click(await themeRow(panel, 'Parchment'))

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
  })

  it('is where View ▸ Theme ▸ More Themes… lands', async () => {
    const { user } = renderApp()
    await rowFor('Documents')

    await user.click(screen.getByRole('menuitem', { name: 'View' }))
    // Hovered, not clicked: a submenu opens on the pointer entering its row, and
    // a click on the row would toggle it straight back shut.
    await user.hover(await screen.findByRole('menuitem', { name: 'Theme' }))

    // `fireEvent` for the row *inside* the flyout, for the reason MenuBar.test
    // spells out: userEvent reports the move out of the parent row with a null
    // `relatedTarget`, React synthesises a mouseleave on the wrapper that owns
    // the open state, and the flyout closes before the click lands.
    const themeMenu = await screen.findByRole('menu', { name: 'Theme' })
    fireEvent.click(within(themeMenu).getByRole('menuitem', { name: 'More Themes…' }))

    const panel = await settings()
    expect(await themeRow(panel, /^Graphite/)).toBeInTheDocument()
  })

  describe('themes from the folder', () => {
    it('offers one that was dropped in, and applies it', async () => {
      // As if the user had written it in any editor.
      await ensureThemesFolder(THEMES)
      await bridge.fs.createFile(
        THEMES,
        'Ocean.json',
        JSON.stringify({ name: 'Ocean', mode: 'dark', colors: { accent: '#38bdf8' } }),
      )

      const { user } = renderApp()
      await rowFor('Documents')

      const panel = await openSettings(user)
      await user.click(await themeRow(panel, /^Ocean/))

      await waitFor(() => expect(accent()).toBe('#38bdf8'))
    })

    // Listed with its reason rather than skipped: a file that silently did
    // nothing reads as a bug in the app instead of a typo in the theme.
    it('shows a broken one with its reason and refuses to use it', async () => {
      await ensureThemesFolder(THEMES)
      await bridge.fs.createFile(THEMES, 'Broken.json', '{ half an edit')

      const { user } = renderApp()
      await rowFor('Documents')

      const panel = await openSettings(user)
      const broken = await themeRow(panel, /Broken/)
      expect(broken).toBeDisabled()
      expect(within(panel).getByText('Not valid JSON')).toBeInTheDocument()
      expect(accent()).toBe(baseThemeFor('dark').colors.accent)
    })

    /**
     * How anyone finds out what the format is: press the button, get a complete
     * file named after a theme you already like, change four lines.
     */
    it('exports the theme on screen as a file to edit', async () => {
      const { user } = renderApp()
      await rowFor('Documents')

      const panel = await openSettings(user)
      await user.click(within(panel).getByRole('button', { name: /Export Current Theme/ }))

      await waitFor(async () =>
        expect(await bridge.fs.exists(`${THEMES}/Vault Dark.json`)).toBe(true),
      )
      expect(await themeRow(panel, /^Vault Dark Copy/)).toBeInTheDocument()
    })
  })
})
