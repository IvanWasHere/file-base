/**
 * The application menu, as data.
 *
 * Pure structure with no React and no handlers, so the in-window menu bar, the
 * native macOS menu and the context menus are driven by one definition rather
 * than three that drift. `backend/appmenu` builds the native menu against these
 * same command ids and emits them over the bridge; the handler map in
 * `useMenuCommands` stays the only place a command is implemented.
 *
 * Accelerators are *not* declared here — `constants/shortcuts.ts` owns them, and
 * menus look them up by command id. Keeping them out means a command's binding
 * is stated once, in the registry that actually dispatches it.
 */

import { splitLabel } from '@/constants/splitModes'

export type MenuCommandId =
  // File
  | 'file.open'
  | 'file.openInNewTab'
  | 'file.newFolder'
  | 'file.newFile'
  | 'file.newTab'
  | 'file.closeTab'
  | 'file.rename'
  | 'file.duplicate'
  | 'file.moveToTrash'
  | 'file.delete'
  | 'file.calculateHashes'
  | 'file.revealInFinder'
  | 'file.copyPath'
  | 'file.addToFavorites'
  | 'file.removeFromFavorites'
  // Edit
  | 'edit.undo'
  | 'edit.copy'
  | 'edit.cut'
  | 'edit.paste'
  | 'edit.selectAll'
  | 'edit.deselectAll'
  | 'edit.find'
  // View
  | 'view.details'
  | 'view.largeIcons'
  | 'view.mediumIcons'
  | 'view.smallIcons'
  | 'view.photos'
  | 'view.splitSingle'
  | 'view.splitTwo'
  | 'view.splitThree'
  | 'view.splitFour'
  | 'view.toggleHidden'
  | 'view.toggleSidebar'
  | 'view.togglePreview'
  | 'view.refresh'
  // Go
  | 'go.back'
  | 'go.forward'
  | 'go.up'
  | 'go.home'
  | 'go.documents'
  | 'go.downloads'
  | 'go.applications'

export interface MenuItem {
  id: MenuCommandId
  label: string
  /** Renders a checkmark; the value comes from the handler map at runtime. */
  checkable?: boolean
}

/** A rule between groups of items. */
export type MenuEntry = MenuItem | { separator: true }

export interface MenuDefinition {
  id: string
  label: string
  items: MenuEntry[]
}

export const APP_MENUS: MenuDefinition[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      { id: 'file.open', label: 'Open' },
      { id: 'file.openInNewTab', label: 'Open in New Tab' },
      { separator: true },
      { id: 'file.newFolder', label: 'New Folder' },
      { id: 'file.newFile', label: 'New File' },
      { separator: true },
      { id: 'file.newTab', label: 'New Tab' },
      { id: 'file.closeTab', label: 'Close Tab' },
      { separator: true },
      { id: 'file.rename', label: 'Rename' },
      { id: 'file.duplicate', label: 'Duplicate' },
      { separator: true },
      { id: 'file.moveToTrash', label: 'Move to Trash' },
      { id: 'file.delete', label: 'Delete Immediately…' },
      { separator: true },
      { id: 'file.calculateHashes', label: 'Calculate Hashes…' },
      { separator: true },
      { id: 'file.revealInFinder', label: 'Reveal in Finder' },
      { id: 'file.copyPath', label: 'Copy Path' },
      { separator: true },
      { id: 'file.addToFavorites', label: 'Add to Favorites' },
      { id: 'file.removeFromFavorites', label: 'Remove from Favorites' },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [
      { id: 'edit.undo', label: 'Undo' },
      { separator: true },
      { id: 'edit.cut', label: 'Cut' },
      { id: 'edit.copy', label: 'Copy' },
      { id: 'edit.paste', label: 'Paste' },
      { separator: true },
      { id: 'edit.selectAll', label: 'Select All' },
      { id: 'edit.deselectAll', label: 'Deselect All' },
      { separator: true },
      { id: 'edit.find', label: 'Find…' },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: [
      { id: 'view.details', label: 'as Details', checkable: true },
      { id: 'view.largeIcons', label: 'as Large Icons', checkable: true },
      { id: 'view.mediumIcons', label: 'as Medium Icons', checkable: true },
      { id: 'view.smallIcons', label: 'as Small Icons', checkable: true },
      { id: 'view.photos', label: 'as Photos', checkable: true },
      { separator: true },
      // Labels come from the split registry, not from here: this menu, the
      // toolbar dropdown and the status bar all print the same four names, and
      // before §M16 they printed three different sets. The command ids keep
      // their original spellings — `view.splitFour` no longer means four
      // columns, but ids are internal and pinned across the Go boundary by a
      // drift test, so renaming them would change a string nobody sees.
      { id: 'view.splitSingle', label: splitLabel(1), checkable: true },
      { id: 'view.splitTwo', label: splitLabel(2), checkable: true },
      { id: 'view.splitThree', label: splitLabel(3), checkable: true },
      { id: 'view.splitFour', label: splitLabel(4), checkable: true },
      { separator: true },
      { id: 'view.toggleHidden', label: 'Show Hidden Files', checkable: true },
      { id: 'view.toggleSidebar', label: 'Show Sidebar', checkable: true },
      { id: 'view.togglePreview', label: 'Show Preview', checkable: true },
      { separator: true },
      { id: 'view.refresh', label: 'Refresh' },
    ],
  },
  {
    id: 'go',
    label: 'Go',
    items: [
      { id: 'go.back', label: 'Back' },
      { id: 'go.forward', label: 'Forward' },
      { id: 'go.up', label: 'Enclosing Folder' },
      { separator: true },
      { id: 'go.home', label: 'Home' },
      { id: 'go.documents', label: 'Documents' },
      { id: 'go.downloads', label: 'Downloads' },
      { id: 'go.applications', label: 'Applications' },
    ],
  },
]

export function isSeparator(entry: MenuEntry): entry is { separator: true } {
  return 'separator' in entry
}

/** Every item, flattened — how the context menus and the native menu resolve ids. */
const ITEMS: MenuItem[] = APP_MENUS.flatMap((menu) =>
  menu.items.filter((entry): entry is MenuItem => !isSeparator(entry)),
)

export function findMenuItem(id: MenuCommandId): MenuItem | undefined {
  return ITEMS.find((item) => item.id === id)
}

/**
 * Guards the native menu's side of the bridge: Go sends a command id as a
 * string, and a build mismatch — a native menu from an older binary naming a
 * command this frontend no longer has — should be ignored rather than dispatched
 * into a switch that silently falls through.
 */
export function isMenuCommandId(value: unknown): value is MenuCommandId {
  return typeof value === 'string' && ITEMS.some((item) => item.id === value)
}
