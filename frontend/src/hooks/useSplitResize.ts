import { useCallback, useEffect, useRef } from 'react'

/**
 * Drag-to-resize for split panes, on either axis.
 *
 * The mockup's `startResize` wrote pixel widths straight onto DOM nodes, which
 * meant a window resize left the panes stranded at stale widths. This version
 * converts the drag into *fractions* and hands them to the store, so React owns
 * the layout and proportions survive a resize.
 *
 * One hook rather than a horizontal and a vertical one: the maths is identical
 * — a delta over the container's extent, redistributed between two neighbours,
 * floored at `MIN_FRACTION` — and only the coordinate and the dimension differ
 * (§M16 decision 4). A `useSplitResizeVertical` would start as a copy of this
 * and drift from it.
 *
 * Listeners go on `window` rather than the handle so the drag keeps tracking
 * when the pointer outruns the 4px divider.
 */

const MIN_FRACTION = 0.12

export type SplitAxis = 'x' | 'y'

interface UseSplitResizeOptions {
  containerRef: React.RefObject<HTMLElement | null>
  axis: SplitAxis
  sizes: number[]
  onResize: (sizes: number[]) => void
  /**
   * The floor, as a fraction. One number applies to every part; an array gives
   * each its own.
   *
   * §M19's second caller is why this is an option at all: 0.12 of a pane is a
   * sane floor for a pane and a fat one for a Size column, and the columns want
   * a different floor per column. A `useColumnResize` copied from this would
   * have started identical and drifted — the same argument §M16 decision 4 made
   * against a vertical copy.
   */
  minFraction?: number | number[]
}

/** Redistributes `delta` across one divider, respecting both neighbours' floor. */
function resized(
  sizes: number[],
  handleIndex: number,
  delta: number,
  minFraction: number | number[],
): number[] | null {
  const before = sizes[handleIndex]
  const after = sizes[handleIndex + 1]
  if (before === undefined || after === undefined) return null

  const minOf = (index: number) =>
    (Array.isArray(minFraction) ? minFraction[index] : minFraction) ?? MIN_FRACTION

  // A divider only ever redistributes between its two neighbours; parts further
  // along stay put, which is what makes dragging feel predictable.
  const pair = before + after
  const minBefore = minOf(handleIndex)
  const minAfter = minOf(handleIndex + 1)
  // A pair too small to hold both floors would produce a max below the min and
  // invert the drag; there is nothing to redistribute, so it stays put.
  if (minBefore + minAfter > pair) return null

  const next = Math.min(Math.max(before + delta, minBefore), pair - minAfter)

  const result = [...sizes]
  result[handleIndex] = next
  result[handleIndex + 1] = pair - next
  return result
}

export function useSplitResize({
  containerRef,
  axis,
  sizes,
  onResize,
  minFraction = MIN_FRACTION,
}: UseSplitResizeOptions) {
  // Held in a ref so the move handler always sees the current values without
  // being torn down and rebound on every frame.
  const drag = useRef<{ handleIndex: number; start: number; startSizes: number[] } | null>(null)
  const latest = useRef({ sizes, onResize, axis, minFraction })

  useEffect(() => {
    latest.current = { sizes, onResize, axis, minFraction }
  }, [sizes, onResize, axis, minFraction])

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const state = drag.current
      const container = containerRef.current
      if (!state || !container) return

      const horizontal = latest.current.axis === 'x'
      const rect = container.getBoundingClientRect()
      const extent = horizontal ? rect.width : rect.height
      if (extent <= 0) return

      const position = horizontal ? event.clientX : event.clientY
      const next = resized(
        state.startSizes,
        state.handleIndex,
        (position - state.start) / extent,
        latest.current.minFraction,
      )
      if (next) latest.current.onResize(next)
    }

    const handleUp = () => {
      if (!drag.current) return
      drag.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [containerRef])

  const startResize = useCallback((handleIndex: number, event: React.MouseEvent) => {
    event.preventDefault()
    const horizontal = latest.current.axis === 'x'
    drag.current = {
      handleIndex,
      start: horizontal ? event.clientX : event.clientY,
      startSizes: [...latest.current.sizes],
    }
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }, [])

  /** Keyboard equivalent, so the divider is not mouse-only. */
  const nudge = useCallback((handleIndex: number, direction: -1 | 1) => {
    const next = resized(
      latest.current.sizes,
      handleIndex,
      0.02 * direction,
      latest.current.minFraction,
    )
    if (next) latest.current.onResize(next)
  }, [])

  return { startResize, nudge }
}
