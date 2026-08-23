/**
 * The themes installed from files (PLAN.md §M24).
 *
 * Separate from `uiStore`, which holds the *preference*: this is a list read
 * off disk and re-read when the user asks, and it is not persisted — the files
 * in the themes folder are the record, and a copy of them in SQLite would be a
 * second one that goes stale the moment someone edits a file in a text editor.
 *
 * Broken themes are kept in the list rather than filtered out, carrying the
 * `problem` the parser gave them, so Settings can say why a file did nothing.
 * `usableThemes` is what everything else reads.
 */

import { create } from 'zustand'
import { BUILTIN_THEMES, type Theme } from '@/constants/palette'

interface ThemeState {
  /** Everything found in the themes folder, broken ones included. */
  external: Theme[]
  /** True once the folder has been read, so Settings can tell empty from early. */
  loaded: boolean
  setExternal: (themes: Theme[]) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  external: [],
  loaded: false,
  setExternal: (external) => set({ external, loaded: true }),
}))

/**
 * Every theme that can actually be applied, built-ins first.
 *
 * A theme with a `problem` is excluded here but not everywhere: it can still be
 * *listed*, it just cannot be *chosen*. Sorting external ones by name keeps the
 * list stable across reads, since a directory listing's order is the
 * filesystem's business.
 */
export function usableThemes(external: Theme[]): Theme[] {
  const installed = external
    .filter((theme) => theme.problem === undefined)
    .sort((a, b) => a.name.localeCompare(b.name))
  return [...BUILTIN_THEMES, ...installed]
}
