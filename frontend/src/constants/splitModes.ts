import { Columns2, Columns3, Grid2x2, Square, type LucideIcon } from 'lucide-react'
import type { PaneLayout, SplitMode } from '@/types/workspace'

/**
 * The split layouts, as data (PLAN.md §M16).
 *
 * One source for the label, the icon and the shape. Before this, the four modes
 * were named in four places — the toolbar, `constants/menus.ts`,
 * `backend/appmenu` and the status bar — and the status bar had already drifted,
 * saying "Split" and "4-Way" where the menus said "Two Panes" and "Four Panes".
 * That was not a naming decision anyone took; it was two files written months
 * apart. Go still keeps its own copy, because it must.
 *
 * Mirrors `constants/viewModes.ts`, down to the `isSplitMode` guard: a split
 * mode read back out of the session is untrusted input in both directions.
 */

/**
 * How many columns and rows a mode is made of.
 *
 * Shape is a constant and only the fractions are state, so the store never
 * invents a shape and the layout never guesses one. A 6-up would be one more
 * row in this table rather than a new branch in three files.
 */
export interface SplitGrid {
  columns: number
  rows: number
}

export const SPLIT_GRIDS: Record<SplitMode, SplitGrid> = {
  1: { columns: 1, rows: 1 },
  2: { columns: 2, rows: 1 },
  3: { columns: 3, rows: 1 },
  // Two rows of two, not four columns. Four 320px slivers in a 1280px window is
  // not a layout anyone uses twice — and `Grid2x2` is the icon this mode has
  // been drawn with since M2, which was the layout promising what it did not do.
  4: { columns: 2, rows: 2 },
}

/** Every name says the shape you get, which is why "Four Panes" could not stay. */
export const SPLIT_OPTIONS: { mode: SplitMode; label: string; icon: LucideIcon }[] = [
  { mode: 1, label: 'Single Pane', icon: Square },
  { mode: 2, label: '2 Columns', icon: Columns2 },
  { mode: 3, label: '3 Columns', icon: Columns3 },
  { mode: 4, label: '2 × 2 Grid', icon: Grid2x2 },
]

export const SPLIT_MODES: SplitMode[] = SPLIT_OPTIONS.map((option) => option.mode)

export function splitLabel(mode: SplitMode): string {
  return SPLIT_OPTIONS.find((option) => option.mode === mode)?.label ?? 'Single Pane'
}

export function isSplitMode(value: unknown): value is SplitMode {
  return typeof value === 'number' && SPLIT_MODES.includes(value as SplitMode)
}

/** How many panes a mode holds. Derived, never counted by hand. */
export function paneCount(mode: SplitMode): number {
  const grid = SPLIT_GRIDS[mode]
  return grid.columns * grid.rows
}

/** The mode whose pane count matches, for a restored tab that disagrees. */
export function splitModeForPaneCount(count: number): SplitMode {
  return (
    SPLIT_MODES.find((mode) => paneCount(mode) === count) ??
    SPLIT_MODES[SPLIT_MODES.length - 1] ??
    1
  )
}

/** Equal fractions on both axes; used whenever the mode changes. */
export function evenLayout(mode: SplitMode): PaneLayout {
  const grid = SPLIT_GRIDS[mode]
  return {
    columns: Array.from({ length: grid.columns }, () => 1 / grid.columns),
    rows: Array.from({ length: grid.rows }, () => 1 / grid.rows),
  }
}
