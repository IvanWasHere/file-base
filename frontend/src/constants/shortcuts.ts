/**
 * The keyboard shortcut registry (PLAN.md M11).
 *
 * One table, mapping accelerators to the `MenuCommandId`s that `useMenuCommands`
 * already implements. Nothing here executes anything: a shortcut is a second way
 * to reach a command, never a second implementation of one. That is what keeps
 * the menu bar, the native macOS menu, the context menus and the keyboard from
 * drifting apart.
 *
 * Two rules decide what belongs here:
 *
 * 1. **Commands, not navigation.** Moving the selection inside a list — arrows,
 *    Home/End, type-ahead — is the focused view's business and stays in
 *    `useListKeyboard`, which knows the item order and the grid's column count.
 *    The registry never claims a key the focused element has already handled;
 *    see `useKeyboard` for how that is enforced. M13's Left/Right photo stepping
 *    resolves the same way — through `useListKeyboard`, not by adding a second
 *    global handler.
 *
 * 2. **Physical keys, not characters.** Matching is on `KeyboardEvent.code`
 *    rather than `.key`, because macOS rewrites `.key` when Option is held —
 *    Cmd+Alt+L arrives as `¬`, and a table written in characters would silently
 *    never match.
 */

import type { MenuCommandId } from '@/constants/menus'

export interface Shortcut {
  id: MenuCommandId
  /** `Cmd`/`Shift`/`Alt` joined to a key name by `+`. See `toCode`. */
  accelerator: string
}

/**
 * Ordered, and duplicates are intentional: a command may have several
 * accelerators (a Mac keyboard's Backspace and a PC keyboard's Delete), and the
 * *first* entry for a command is the one printed in menus.
 *
 * Deliberately absent:
 * - `Escape` — clearing the selection belongs to the focused list.
 * - `file.openInNewTab`, `file.addToFavorites`, `file.removeFromFavorites` —
 *   context-menu commands. A binding nobody would guess is clutter in a menu.
 */
export const SHORTCUTS: Shortcut[] = [
  // File
  { id: 'file.open', accelerator: 'Cmd+O' },
  { id: 'file.open', accelerator: 'Cmd+ArrowDown' },
  { id: 'file.newFile', accelerator: 'Cmd+N' },
  { id: 'file.newFolder', accelerator: 'Cmd+Shift+N' },
  { id: 'file.newTab', accelerator: 'Cmd+T' },
  { id: 'file.closeTab', accelerator: 'Cmd+W' },
  // Finder's binding. M4 shipped Enter as "open" and M6 flagged the change as
  // belonging to this milestone, which now owns the whole set: Enter renames,
  // Cmd+O and Cmd+Down open, and a double-click still opens.
  { id: 'file.rename', accelerator: 'Enter' },
  { id: 'file.duplicate', accelerator: 'Cmd+D' },
  { id: 'file.moveToTrash', accelerator: 'Backspace' },
  { id: 'file.moveToTrash', accelerator: 'Delete' },
  // Shift bypasses the trash, as it has since M6.
  { id: 'file.delete', accelerator: 'Shift+Backspace' },
  { id: 'file.delete', accelerator: 'Shift+Delete' },
  { id: 'file.revealInFinder', accelerator: 'Cmd+Shift+R' },
  { id: 'file.copyPath', accelerator: 'Cmd+Alt+C' },

  // Edit
  { id: 'edit.undo', accelerator: 'Cmd+Z' },
  { id: 'edit.copy', accelerator: 'Cmd+C' },
  { id: 'edit.cut', accelerator: 'Cmd+X' },
  { id: 'edit.paste', accelerator: 'Cmd+V' },
  { id: 'edit.selectAll', accelerator: 'Cmd+A' },
  { id: 'edit.find', accelerator: 'Cmd+F' },

  // View
  { id: 'view.details', accelerator: 'Cmd+1' },
  { id: 'view.largeIcons', accelerator: 'Cmd+2' },
  { id: 'view.mediumIcons', accelerator: 'Cmd+3' },
  { id: 'view.smallIcons', accelerator: 'Cmd+4' },
  { id: 'view.photos', accelerator: 'Cmd+5' },
  { id: 'view.toggleHidden', accelerator: 'Cmd+Shift+Period' },
  { id: 'view.toggleSidebar', accelerator: 'Cmd+Alt+S' },
  // Finder's Quick Look key. `useListKeyboard` gives it up rather than treating
  // it as type-ahead, since no filename search starts with a space.
  { id: 'view.togglePreview', accelerator: 'Space' },
  { id: 'view.refresh', accelerator: 'Cmd+R' },

  // Go
  { id: 'go.back', accelerator: 'Cmd+BracketLeft' },
  { id: 'go.back', accelerator: 'Cmd+ArrowLeft' },
  { id: 'go.forward', accelerator: 'Cmd+BracketRight' },
  { id: 'go.forward', accelerator: 'Cmd+ArrowRight' },
  { id: 'go.up', accelerator: 'Cmd+ArrowUp' },
  { id: 'go.home', accelerator: 'Cmd+Shift+H' },
  { id: 'go.documents', accelerator: 'Cmd+Shift+O' },
  { id: 'go.downloads', accelerator: 'Cmd+Alt+L' },
  { id: 'go.applications', accelerator: 'Cmd+Shift+A' },
]

export interface ParsedShortcut {
  /** A `KeyboardEvent.code` value. */
  code: string
  cmd: boolean
  shift: boolean
  alt: boolean
}

/**
 * Turns the key half of an accelerator into a `KeyboardEvent.code`.
 * Letters and digits are spelled bare in the table; everything else is already
 * written as its code, so it passes through.
 */
function toCode(key: string): string {
  if (/^[A-Za-z]$/.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  return key
}

export function parseAccelerator(accelerator: string): ParsedShortcut {
  const parts = accelerator.split('+')
  const key = parts[parts.length - 1] ?? ''
  const modifiers = parts.slice(0, -1).map((part) => part.toLowerCase())

  return {
    code: toCode(key),
    cmd: modifiers.includes('cmd'),
    shift: modifiers.includes('shift'),
    alt: modifiers.includes('alt'),
  }
}

/**
 * Ctrl counts as Cmd, matching the rest of the app: an external PC keyboard
 * should reach the same commands. Ctrl is never a modifier in its own right
 * here, so there is nothing for that to shadow.
 */
export function matchesEvent(
  shortcut: ParsedShortcut,
  event: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
): boolean {
  return (
    shortcut.code === event.code &&
    shortcut.cmd === (event.metaKey || event.ctrlKey) &&
    shortcut.shift === event.shiftKey &&
    shortcut.alt === event.altKey
  )
}

/** Parsed once at module load — this runs on every keystroke. */
const PARSED: { id: MenuCommandId; shortcut: ParsedShortcut }[] = SHORTCUTS.map((entry) => ({
  id: entry.id,
  shortcut: parseAccelerator(entry.accelerator),
}))

/**
 * Returns the matched entry rather than just its id: a command can have several
 * accelerators, and the caller needs to know which one fired — Backspace and
 * Delete are both "move to trash", but only the entry that actually matched can
 * say whether a modifier was held.
 */
export function findCommand(
  event: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
): { id: MenuCommandId; shortcut: ParsedShortcut } | null {
  return PARSED.find((entry) => matchesEvent(entry.shortcut, event)) ?? null
}

/** True when the accelerator needs no modifier — Enter, Space, Backspace. */
export function isBareKey(shortcut: ParsedShortcut): boolean {
  return !shortcut.cmd && !shortcut.alt
}

const GLYPHS: Record<string, string> = {
  Enter: '↩',
  Space: '␣',
  Backspace: '⌫',
  Delete: '⌦',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  BracketLeft: '[',
  BracketRight: ']',
  Period: '.',
  Comma: ',',
}

/** The macOS spelling — `⌘⇧N` — for a menu's right-hand column. */
export function formatAccelerator(accelerator: string): string {
  const parsed = parseAccelerator(accelerator)
  const key =
    GLYPHS[parsed.code] ??
    parsed.code.replace(/^Key/, '').replace(/^Digit/, '')

  // Apple's order: Control, Option, Shift, Command, then the key.
  return `${parsed.alt ? '⌥' : ''}${parsed.shift ? '⇧' : ''}${parsed.cmd ? '⌘' : ''}${key}`
}

/**
 * The same binding in the spelling `aria-keyshortcuts` expects.
 *
 * A menu row's accessible name must stay the command — "New Folder", not "New
 * Folder ⌘⇧N" — so the printed glyphs are hidden from assistive technology and
 * the binding is announced through this attribute instead, which is what it is
 * for.
 */
export function ariaKeyShortcuts(accelerator: string): string {
  const parsed = parseAccelerator(accelerator)
  const key = parsed.code.replace(/^Key/, '').replace(/^Digit/, '')
  const modifiers = [parsed.alt && 'Alt', parsed.shift && 'Shift', parsed.cmd && 'Meta'].filter(
    Boolean,
  )
  return [...modifiers, key].join('+')
}

/** The accelerator a menu should print for a command, if it has one. */
export function acceleratorFor(id: MenuCommandId): string | undefined {
  return SHORTCUTS.find((entry) => entry.id === id)?.accelerator
}
