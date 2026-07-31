/**
 * The copy/cut clipboard (PLAN.md §1).
 *
 * Deliberately virtual rather than the OS pasteboard: the webview cannot put a
 * real file promise on the system clipboard, so pretending to would produce a
 * "copy" that Finder silently ignores. Within the app it behaves exactly as
 * expected; crossing to Finder is Reveal in Finder's job (PLAN.md §3).
 */

import { create } from 'zustand'

export type ClipboardMode = 'copy' | 'cut'

interface ClipboardState {
  paths: string[]
  mode: ClipboardMode | null
  /** Where the paths came from, so a paste into the same folder can duplicate. */
  sourceDir: string | null

  copy: (paths: readonly string[], sourceDir: string) => void
  cut: (paths: readonly string[], sourceDir: string) => void
  clear: () => void
}

export const useClipboardStore = create<ClipboardState>()((set) => ({
  paths: [],
  mode: null,
  sourceDir: null,

  copy: (paths, sourceDir) => set({ paths: [...paths], mode: 'copy', sourceDir }),
  cut: (paths, sourceDir) => set({ paths: [...paths], mode: 'cut', sourceDir }),
  clear: () => set({ paths: [], mode: null, sourceDir: null }),
}))

/**
 * A stable empty array for selectors.
 *
 * Returning a fresh `[]` from a selector hands back a new reference on every
 * store read, which defeats the equality check and re-renders forever.
 */
export const NO_PATHS: readonly string[] = []

/** The paths marked for a cut, so views can render them dimmed as Finder does. */
export function useCutPaths(): readonly string[] {
  return useClipboardStore((state) => (state.mode === 'cut' ? state.paths : NO_PATHS))
}
