/**
 * What just arrived in a folder, and how long it stays at the top of the
 * listing (PLAN.md §M26).
 *
 * A new folder is created with a name that sorts wherever the alphabet puts it,
 * which in a folder of four hundred items is off-screen — so the rename editor
 * opens on a row the user cannot see. Pinning the arrival to the top is the
 * fix, and this holds the one fact needed to do it.
 *
 * **One record, not a map.** The user just did one thing; a second arrival
 * replaces the first. Keyed by *directory* rather than by pane, because the
 * operations that produce an arrival — paste, duplicate, a drag onto a pane —
 * know where the items landed and not who is looking: two panes showing that
 * folder both pin them, which is the same answer to the same question.
 */

import { create } from 'zustand'

/**
 * What ends an arrival's stay at the top.
 *
 * `rename` is the creation commands: the item is pinned while its inline
 * editor is open, and drops into its sorted place when the name is settled.
 * `action` is everything else — paste, duplicate, a drop — which has no editor
 * to close, so it holds until the user's next selection or re-sort.
 */
export type FreshUntil = 'rename' | 'action'

export interface FreshArrival {
  /** The folder the items landed in. */
  dir: string
  /** In arrival order, which is the order they are pinned in. */
  paths: string[]
  until: FreshUntil
}

interface FreshState {
  arrival: FreshArrival | null
  mark: (dir: string, paths: readonly string[], until: FreshUntil) => void
  clear: () => void
}

export const useFreshStore = create<FreshState>()((set) => ({
  arrival: null,

  // Nothing to pin is not an arrival: an operation where every item collided
  // and was skipped would otherwise leave a record that pins no rows and still
  // has to be cleared by something.
  mark: (dir, paths, until) =>
    set(paths.length > 0 ? { arrival: { dir, paths: [...paths], until } } : {}),

  clear: () => set((state) => (state.arrival === null ? {} : { arrival: null })),
}))
