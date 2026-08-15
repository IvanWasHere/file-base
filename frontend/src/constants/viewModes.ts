import { Grid2x2, Grid3x3, Images, LayoutGrid, List, type LucideIcon } from 'lucide-react'
import type { ViewMode } from '@/types/workspace'

/** The mockup's `viewConfigs`, with Lucide icons. */
export const VIEW_OPTIONS: { mode: ViewMode; label: string; icon: LucideIcon }[] = [
  { mode: 'details', label: 'Details', icon: List },
  { mode: 'large-icons', label: 'Large Icons', icon: LayoutGrid },
  { mode: 'medium-icons', label: 'Medium Icons', icon: Grid2x2 },
  { mode: 'small-icons', label: 'Small Icons', icon: Grid3x3 },
  { mode: 'photos', label: 'Photos', icon: Images },
]

export function viewLabel(mode: ViewMode): string {
  return VIEW_OPTIONS.find((option) => option.mode === mode)?.label ?? 'Details'
}

/**
 * Every mode, derived from the list above rather than written out again.
 *
 * The database outlives any given build, so a stored view mode is untrusted
 * input in both directions: a row written by a newer build can name a mode this
 * one has never heard of, and a row written by an older one can name a mode that
 * has since been removed. Both read paths — `folderPrefs` and the session
 * snapshot — validate through `isViewMode`, and they do it against *this* list
 * so a sixth view mode cannot be added to the picker while a hand-written copy
 * of the union keeps rejecting it. That is the failure PLAN.md §M13 decision 9
 * calls out: the pane renders nothing, which looks like a crash.
 */
export const VIEW_MODES: ViewMode[] = VIEW_OPTIONS.map((option) => option.mode)

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && VIEW_MODES.includes(value as ViewMode)
}
