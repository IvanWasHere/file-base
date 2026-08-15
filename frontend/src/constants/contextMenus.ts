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
    ['edit.cut', 'edit.copy', 'file.copyPath'],
    ['file.rename', 'file.duplicate'],
    ['file.compress'],
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
  ],
}
