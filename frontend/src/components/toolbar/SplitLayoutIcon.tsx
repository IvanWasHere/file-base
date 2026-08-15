import { SPLIT_GRIDS, cellsOf, columnSpanOf, rowSpanOf } from '@/constants/splitModes'
import type { SplitMode } from '@/types/workspace'

/**
 * A layout's pictogram, drawn from its own cells (PLAN.md §M17 decision 6).
 *
 * Not an icon from the library the rest of the app uses, and that is the point.
 * Four of the nine layouts differ only in *which* quadrant is subdivided, which
 * is past what a general-purpose glyph set says clearly — and M16 exists
 * because the four-pane button showed a 2 × 2 while the app laid out four
 * columns. Nobody noticed for months, because catching it needed a person to
 * compare a drawing against a layout by eye.
 *
 * Generating the drawing from `cells` — the same list `PaneGroup` builds the
 * real layout from — makes that class of mistake impossible rather than
 * unlikely: the picture and the behaviour are one description used twice.
 *
 * `currentColor` throughout, so a tile inherits whatever state its button is in.
 */
export function SplitLayoutIcon({ mode, size = 16 }: { mode: SplitMode; size?: number }) {
  const grid = SPLIT_GRIDS[mode]
  const cells = cellsOf(mode)

  // A hairline between panes at any size. Too large and a 3-column icon is more
  // gap than pane; too small and the panes read as one block.
  const gap = size / 14
  const columnWidth = size / grid.columns
  const rowHeight = size / grid.rows

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      // Decorative: every caller gives the control itself an accessible name,
      // and a shape read out as "rect rect rect" helps nobody.
      aria-hidden
      focusable="false"
    >
      {cells.map((cell, index) => (
        <rect
          key={index}
          x={cell.column * columnWidth + gap / 2}
          y={cell.row * rowHeight + gap / 2}
          width={columnSpanOf(cell) * columnWidth - gap}
          height={rowSpanOf(cell) * rowHeight - gap}
          rx={size / 16}
          fill="currentColor"
        />
      ))}
    </svg>
  )
}
