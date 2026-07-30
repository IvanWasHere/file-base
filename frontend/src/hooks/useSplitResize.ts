import { useCallback, useEffect, useRef } from 'react'

/**
 * Drag-to-resize for split panes.
 *
 * The mockup's `startResize` wrote pixel widths straight onto DOM nodes, which
 * meant a window resize left the panes stranded at stale widths. This version
 * converts the drag into *fractions* and hands them to the store, so React owns
 * the layout and proportions survive a resize.
 *
 * Listeners go on `window` rather than the handle so the drag keeps tracking
 * when the pointer outruns the 4px divider.
 */

const MIN_FRACTION = 0.12

interface UseSplitResizeOptions {
  containerRef: React.RefObject<HTMLElement | null>
  sizes: number[]
  onResize: (sizes: number[]) => void
}

export function useSplitResize({ containerRef, sizes, onResize }: UseSplitResizeOptions) {
  // Held in a ref so the move handler always sees the current values without
  // being torn down and rebound on every frame.
  const drag = useRef<{ handleIndex: number; startX: number; startSizes: number[] } | null>(null)
  const latest = useRef({ sizes, onResize })

  useEffect(() => {
    latest.current = { sizes, onResize }
  }, [sizes, onResize])

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const state = drag.current
      const container = containerRef.current
      if (!state || !container) return

      const width = container.getBoundingClientRect().width
      if (width <= 0) return

      const delta = (event.clientX - state.startX) / width
      const left = state.startSizes[state.handleIndex]
      const right = state.startSizes[state.handleIndex + 1]
      if (left === undefined || right === undefined) return

      // A divider only ever redistributes between its two neighbours; panes
      // further along stay put, which is what makes dragging feel predictable.
      const pair = left + right
      const nextLeft = Math.min(Math.max(left + delta, MIN_FRACTION), pair - MIN_FRACTION)

      const next = [...state.startSizes]
      next[state.handleIndex] = nextLeft
      next[state.handleIndex + 1] = pair - nextLeft
      latest.current.onResize(next)
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
    drag.current = {
      handleIndex,
      startX: event.clientX,
      startSizes: [...latest.current.sizes],
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  /** Keyboard equivalent, so the divider is not mouse-only. */
  const nudge = useCallback((handleIndex: number, direction: -1 | 1) => {
    const current = latest.current.sizes
    const left = current[handleIndex]
    const right = current[handleIndex + 1]
    if (left === undefined || right === undefined) return

    const step = 0.02 * direction
    const pair = left + right
    const nextLeft = Math.min(Math.max(left + step, MIN_FRACTION), pair - MIN_FRACTION)

    const next = [...current]
    next[handleIndex] = nextLeft
    next[handleIndex + 1] = pair - nextLeft
    latest.current.onResize(next)
  }, [])

  return { startResize, nudge }
}
