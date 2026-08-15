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

/** How many panes a tab shows side by side. */
export type SplitMode = 1 | 2 | 3 | 4

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
  /**
   * Fractional widths, one per pane, summing to 1. Fractions rather than pixels
   * so a window resize redistributes space proportionally on its own.
   */
  paneSizes: number[]
}
