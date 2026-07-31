/**
 * The undo stack for file operations (PLAN.md M6).
 *
 * This store holds *what happened*, never *how to reverse it* — inverting an
 * entry means calling the bridge, and a store that reached for the filesystem
 * would be untestable and would invert the dependency direction. The
 * interpretation lives in services/operations/undo.ts.
 *
 * Only reversible operations are recorded. A permanent delete produces no entry
 * at all, and neither does a copy or move that overwrote something under the
 * 'replace' policy: offering an undo that cannot restore what it destroyed
 * would be a lie. `redo` is deliberately absent — M6 needs a safety net, not a
 * full command history, and a redo of "restore from trash" has no meaning once
 * the user has emptied it.
 */

import { create } from 'zustand'
import type { TrashedItem } from '@/types/file'

/** A `label` is user-facing: it becomes "Undo <label>" in the menu. */
export type UndoEntry =
  | { kind: 'create'; label: string; path: string }
  | { kind: 'rename'; label: string; from: string; to: string }
  | { kind: 'move'; label: string; pairs: { from: string; to: string }[] }
  | { kind: 'copy'; label: string; created: string[] }
  | { kind: 'trash'; label: string; items: TrashedItem[] }

/** Deep enough to cover a slip, shallow enough that stale paths cannot pile up. */
const MAX_DEPTH = 25

interface HistoryState {
  entries: UndoEntry[]
  push: (entry: UndoEntry) => void
  /** Removes and returns the newest entry. */
  pop: () => UndoEntry | null
  clear: () => void
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  entries: [],

  push: (entry) => set((state) => ({ entries: [...state.entries, entry].slice(-MAX_DEPTH) })),

  pop: () => {
    const { entries } = get()
    const entry = entries.at(-1)
    if (!entry) return null
    set({ entries: entries.slice(0, -1) })
    return entry
  },

  clear: () => set({ entries: [] }),
}))

/** The label of the operation Cmd+Z would reverse, or null when there is none. */
export function useUndoLabel(): string | null {
  return useHistoryStore((state) => state.entries.at(-1)?.label ?? null)
}
