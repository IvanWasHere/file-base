/**
 * Context menus, as data (PLAN.md M11).
 *
 * Three menus, chosen by what is under the pointer: a file, a folder, or the
 * pane's own background. Each is a list of groups; the renderer draws a rule
 * between groups and drops any group left empty once hidden items are removed,
 * so a menu never opens with a leading or doubled separator.
 *
 * Every entry is a `MenuCommandId` that already exists in `APP_MENUS` — labels,
 * enablement and the handler all come from there. A context menu is a different
 * *route* to a command, never a different command.
 */

import type { MenuCommandId } from '@/constants/menus'

/** What the pointer was over when the menu was raised. */
export type ContextKind = 'file' | 'folder' | 'background'

export const CONTEXT_MENUS: Record<ContextKind, MenuCommandId[][]> = {
  file: [
    ['file.open'],
    ['edit.cut', 'edit.copy', 'file.copyPath'],
    ['file.rename', 'file.duplicate'],
    ['file.compress', 'file.uncompress'],
    ['file.tags'],
    ['file.calculateHashes'],
    ['file.moveToTrash', 'file.delete'],
    ['file.revealInFinder'],
  ],
  // Offered on a folder too, because a right-click inside a multi-selection
  // acts on the whole selection (M11) — and a selection of forty files that
  // happens to include one folder is exactly when this is reached for. The
  // command drops the folders itself and says how many.
  folder: [
    ['file.open', 'file.openInNewTab'],
    // Paste is offered here as well as on the background, because the
    // destination follows the selection: right-clicking a folder selects it,
    // so this row puts the clipboard *inside* that folder without opening it
    // (`useMenuCommands`, `pasteTarget`).
    ['edit.cut', 'edit.copy', 'edit.paste', 'file.copyPath'],
    ['file.rename', 'file.duplicate'],
    ['file.compress'],
    ['file.tags'],
    ['file.calculateHashes'],
    ['file.addToFavorites', 'file.removeFromFavorites'],
    ['file.moveToTrash', 'file.delete'],
    ['file.revealInFinder'],
  ],
  // No selection to act on, so this is about the folder being shown: what can be
  // created in it, what can be pasted into it, and where it is.
  background: [
    ['file.newFolder', 'file.newFile', 'file.newFromTemplate'],
    ['edit.paste', 'edit.selectAll'],
    ['view.refresh', 'view.toggleHidden'],
    ['file.addToFavorites', 'file.removeFromFavorites'],
    ['file.revealInFinder', 'file.copyPath'],
    ['app.settings'],
  ],
}

/**
 * Every command that appears in a context menu, deduplicated, in the order the
 * three menus above introduce them (§M22).
 *
 * This is what the Settings modal lists: the user is choosing which of *these*
 * rows they want, and the list has to come from the menus themselves rather
 * than from a hand-kept copy — a command added above but forgotten here would
 * be a row nobody could switch off, and one removed would be a checkbox that
 * controls nothing.
 */
export const CONTEXT_COMMANDS: MenuCommandId[] = [
  ...new Set(Object.values(CONTEXT_MENUS).flat(2)),
]

/**
 * Which of the three menus a command appears in — what lets the Settings modal
 * say "File, Folder" beside a row, so hiding one is not a guess about where it
 * will disappear from.
 */
export function contextsFor(id: MenuCommandId): ContextKind[] {
  return (Object.keys(CONTEXT_MENUS) as ContextKind[]).filter((kind) =>
    CONTEXT_MENUS[kind].some((group) => group.includes(id)),
  )
}
