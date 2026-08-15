import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drag-to-reorder for the detail view's column headers (PLAN.md §M19).
 *
 * **Pointer events, never HTML5 drag and drop** (§M19 decision 5). The app runs
 * a global drag pipeline for files — `useFileDrag`, `dragStore`, and Wails'
 * `OnFileDrop` for Finder — and a `dragstart` raised in the header would enter
 * it: every folder row in the pane would light up as a drop target for a
 * column. The two systems never meet because this one never starts a drag.
 *
 * **A press stays a sort until the pointer moves `THRESHOLD` px** (§M19
 * decision 6). The header is already the sort button, so a click that wandered
 * two pixels must still sort; past the threshold the press becomes a reorder and
 * `consumeClick` tells the button to skip the sort it would otherwise do.
 *
 * Listeners go on `window`, as `useSplitResize`'s do, so the drag keeps tracking
 * when the pointer leaves the 28px header strip — which it does immediately,
 * because people drag along the row they are looking at.
 */

const THRESHOLD = 4

interface UseColumnReorderOptions {
  /** The header row, whose width the drop index is measured against. */
  containerRef: React.RefObject<HTMLElement | null>
  /** Column weights in display order; the boundaries are derived from these. */
  weights: number[]
  onReorder: (from: number, to: number) => void
}

export interface ColumnDrag {
  from: number
  /** Where it would land if released now. */
  to: number
}

/**
 * Which column a position falls inside, from the weights alone.
 *
 * Arithmetic rather than DOM measurement, for the reason `DetailsView`'s
 * `getItemRect` is: it answers during a drag without reading layout, and it
 * cannot disagree with the grid template, which is built from the same numbers.
 *
 * Plain containment, deliberately — **not** "past the midpoint of the
 * neighbour", which the first version used. Midpoints give a drop marker some
 * hysteresis, and they also mean a press anywhere in the right half of a
 * column's *own* span already reads as "move me one to the right": pressing Name
 * at 250px and twitching 5px relocated it. Requiring the pointer to actually be
 * over another column makes a small drag a no-op, which is what a small drag
 * looks like.
 */
function indexAt(weights: number[], fraction: number): number {
  let edge = 0
  for (let index = 0; index < weights.length; index++) {
    edge += weights[index] ?? 0
    if (fraction < edge) return index
  }
  return weights.length - 1
}

export function useColumnReorder({ containerRef, weights, onReorder }: UseColumnReorderOptions): {
  drag: ColumnDrag | null
  startReorder: (index: number, event: React.MouseEvent) => void
  consumeClick: () => boolean
} {
  const [drag, setDrag] = useState<ColumnDrag | null>(null)

  // Ref-held for the same reason `useSplitResize` does it: the window handlers
  // are bound once and must still see current values.
  const press = useRef<{ index: number; startX: number; moved: boolean } | null>(null)
  const latest = useRef({ weights, onReorder })
  /** Set when a drag actually happened, read and cleared by the button's click. */
  const dragged = useRef(false)

  useEffect(() => {
    latest.current = { weights, onReorder }
  }, [weights, onReorder])

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const state = press.current
      const container = containerRef.current
      if (!state || !container) return

      if (!state.moved) {
        if (Math.abs(event.clientX - state.startX) < THRESHOLD) return
        state.moved = true
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }

      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return

      const fraction = (event.clientX - rect.left) / rect.width
      setDrag({ from: state.index, to: indexAt(latest.current.weights, fraction) })
    }

    const handleUp = () => {
      const state = press.current
      press.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      setDrag((current) => {
        if (state?.moved && current) {
          dragged.current = true
          if (current.to !== current.from) latest.current.onReorder(current.from, current.to)
        }
        return null
      })
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [containerRef])

  const startReorder = useCallback((index: number, event: React.MouseEvent) => {
    // Primary button only, and no `preventDefault`: the button still has to
    // receive its click when the press turns out to be a sort.
    if (event.button !== 0) return
    press.current = { index, startX: event.clientX, moved: false }
  }, [])

  /**
   * True once, if the click that is about to fire was the end of a drag.
   *
   * A click always follows the mouseup, so the flag is read and cleared there
   * rather than on a timer.
   */
  const consumeClick = useCallback(() => {
    const was = dragged.current
    dragged.current = false
    return was
  }, [])

  return { drag, startReorder, consumeClick }
}
