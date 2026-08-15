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
}

/** Redistributes `delta` across one divider, respecting both neighbours' floor. */
function resized(sizes: number[], handleIndex: number, delta: number): number[] | null {
  const before = sizes[handleIndex]
  const after = sizes[handleIndex + 1]
  if (before === undefined || after === undefined) return null

  // A divider only ever redistributes between its two neighbours; parts further
  // along stay put, which is what makes dragging feel predictable.
  const pair = before + after
  const next = Math.min(Math.max(before + delta, MIN_FRACTION), pair - MIN_FRACTION)

  const result = [...sizes]
  result[handleIndex] = next
  result[handleIndex + 1] = pair - next
  return result
}

export function useSplitResize({ containerRef, axis, sizes, onResize }: UseSplitResizeOptions) {
  // Held in a ref so the move handler always sees the current values without
  // being torn down and rebound on every frame.
  const drag = useRef<{ handleIndex: number; start: number; startSizes: number[] } | null>(null)
  const latest = useRef({ sizes, onResize, axis })

  useEffect(() => {
    latest.current = { sizes, onResize, axis }
  }, [sizes, onResize, axis])

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
      const next = resized(state.startSizes, state.handleIndex, (position - state.start) / extent)
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
    const next = resized(latest.current.sizes, handleIndex, 0.02 * direction)
    if (next) latest.current.onResize(next)
  }, [])

  return { startResize, nudge }
}
