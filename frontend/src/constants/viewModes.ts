import { Grid2x2, Grid3x3, LayoutGrid, List, type LucideIcon } from 'lucide-react'
import type { ViewMode } from '@/types/workspace'

/** The mockup's `viewConfigs`, with Lucide icons. */
export const VIEW_OPTIONS: { mode: ViewMode; label: string; icon: LucideIcon }[] = [
  { mode: 'details', label: 'Details', icon: List },
  { mode: 'large-icons', label: 'Large Icons', icon: LayoutGrid },
  { mode: 'medium-icons', label: 'Medium Icons', icon: Grid2x2 },
  { mode: 'small-icons', label: 'Small Icons', icon: Grid3x3 },
]

export function viewLabel(mode: ViewMode): string {
  return VIEW_OPTIONS.find((option) => option.mode === mode)?.label ?? 'Details'
}
