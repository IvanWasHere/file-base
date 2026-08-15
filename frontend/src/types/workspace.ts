/**
 * Tabs, panes and their navigation state.
 *
 * The mockup modelled a tab as an object holding an array of panels, each with
 * its own `parentId`/`history`/`historyIndex`. That shape is right; this is the
 * same idea with real paths, normalised so panes can be addressed by id (the
 * selection store keys off `paneId`, and M5 persists panes independently).
 */

import type { SortSpec } from '@/services/filesystem/sort'

export type ViewMode = 'details' | 'large-icons' | 'medium-icons' | 'small-icons' | 'photos'

/**
 * The three grids. Photos is a view mode but not a grid — it shows one image at
 * a time and hides everything that is not one — so the icon views are typed
 * against this rather than `Exclude<ViewMode, 'details'>`, which would have
 * silently accepted `photos` the moment it was added to the union.
 */
export type IconViewMode = 'large-icons' | 'medium-icons' | 'small-icons'

/**
 * Which split layout a tab is in. The *shape* each one means — which cells each
 * pane occupies — lives in `constants/splitModes.ts`.
 *
 * Named rather than numbered since §M17. The numbers were pane counts wearing a
 * mode's clothes, which worked only while every mode held a different number of
 * panes; five of the nine now hold three. A stored mode from before then is a
 * number, and `splitModeFromLegacy` maps it.
 */
export type SplitMode =
  | 'single'
  | 'columns-2'
  | 'rows-2'
  | 'columns-3'
  | 'split-top'
  | 'split-bottom'
  | 'split-left'
  | 'split-right'
  | 'grid-2x2'

/**
 * How big each part of the split currently is.
 *
 * Fractions rather than pixels so a window resize redistributes space on its
 * own — the mockup wrote fixed widths onto the DOM and did not survive one.
 *
 * Two axes rather than one fraction per pane, because a grid cannot be said in
 * a flat list: 2 × 2 needs a column split *and* a row split, and the two rows
 * share the column split so the dividers line up into a cross (§M16 decision 1).
 * Panes fill the grid in reading order — `paneIds[row * columns.length + column]`.
 */
export interface PaneLayout {
  /** One per column, summing to 1. */
  columns: number[]
  /** One per row, summing to 1. `[1]` for every single-row mode. */
  rows: number[]
}

export interface Pane {
  id: string
  path: string
  /** Visited paths, oldest first. `historyIndex` points at the current entry. */
  history: string[]
  historyIndex: number
  viewMode: ViewMode
  sort: SortSpec
}

export interface Tab {
  id: string
  paneIds: string[]
  activePaneId: string
  splitMode: SplitMode
  layout: PaneLayout
}
