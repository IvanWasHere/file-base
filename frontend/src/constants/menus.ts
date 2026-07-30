/**
 * The application menu, as data.
 *
 * Pure structure with no React and no handlers, so the in-window menu bar and
 * the native macOS menu (M11) are driven by one definition rather than two that
 * drift. M11 wires `menu.NewMenu` to these same command ids and emits them over
 * the bridge; the handler map in `useMenuCommands` stays the only place a
 * command is implemented.
 *
 * Shortcut labels are deliberately absent: the global key handling arrives in
 * M11, and printing an accelerator that does nothing would be a lie in the UI.
 */

export type MenuCommandId =
  // File
  | 'file.newTab'
  | 'file.closeTab'
  | 'file.revealInFinder'
  // Edit
  | 'edit.selectAll'
  | 'edit.deselectAll'
  // View
  | 'view.details'
  | 'view.largeIcons'
  | 'view.mediumIcons'
  | 'view.smallIcons'
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
      { id: 'file.newTab', label: 'New Tab' },
      { id: 'file.closeTab', label: 'Close Tab' },
      { separator: true },
      { id: 'file.revealInFinder', label: 'Reveal in Finder' },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [
      { id: 'edit.selectAll', label: 'Select All' },
      { id: 'edit.deselectAll', label: 'Deselect All' },
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
      { separator: true },
      { id: 'view.splitSingle', label: 'Single Pane', checkable: true },
      { id: 'view.splitTwo', label: 'Two Panes', checkable: true },
      { id: 'view.splitThree', label: 'Three Panes', checkable: true },
      { id: 'view.splitFour', label: 'Four Panes', checkable: true },
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
