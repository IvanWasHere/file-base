import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Horizontal scrolling for a strip that can outgrow its container (§M27).
 *
 * Three things have to agree: whether anything is hidden off either edge, the
 * buttons that move it, and the wheel. They live together because they are all
 * answers about the same element, and a component that measured it separately
 * for each would drift the moment one of them forgot to re-measure.
 */
export interface OverflowScroll<T extends HTMLElement> {
  ref: React.RefObject<T | null>
  /** Whether the content is wider than the box — nothing to scroll if not. */
  overflowing: boolean
  /** Whether the first item is fully in view, so Left has nowhere to go. */
  atStart: boolean
  atEnd: boolean
  /** Moves one screenful-ish, the way a scrollbar's trough does. */
  scroll: (direction: -1 | 1) => void
  /** Re-reads the element. For callers that change its contents. */
  measure: () => void
}

/** A single press moves most of a screenful, leaving an item of context. */
const PAGE = 0.6

/** …but never less than about one tab's width, in a narrow window. */
const MIN_STEP = 120

/**
 * A pixel of slack. Sub-pixel layout means `scrollLeft` at the far right
 * settles a fraction short of `scrollWidth - clientWidth`, and a strict
 * comparison would leave the Right button enabled with nowhere to go.
 */
const EPSILON = 1

/**
 * How long a press's destination is believed over the element's own position.
 *
 * `scroll-behavior: smooth` means `scrollLeft` reads where the strip *is*, not
 * where it is going — so a second press while the first is still travelling
 * would measure from halfway and the two together would move less than two
 * steps. Long enough to cover the animation, short enough that a press after a
 * wheel or a drag measures the element again.
 */
const SETTLE_MS = 500

export function useOverflowScroll<T extends HTMLElement>(): OverflowScroll<T> {
  const ref = useRef<T>(null)
  const [state, setState] = useState({ overflowing: false, atStart: true, atEnd: true })

  const measure = useCallback(() => {
    const element = ref.current
    if (!element) return

    const { scrollLeft, scrollWidth, clientWidth } = element
    const overflowing = scrollWidth > clientWidth + EPSILON
    const next = {
      overflowing,
      atStart: !overflowing || scrollLeft <= EPSILON,
      atEnd: !overflowing || scrollLeft >= scrollWidth - clientWidth - EPSILON,
    }

    // Compared before setting: `scroll` fires many times through a smooth
    // animation, and all but the first and last say the same thing.
    setState((current) =>
      current.overflowing === next.overflowing &&
      current.atStart === next.atStart &&
      current.atEnd === next.atEnd
        ? current
        : next,
    )
  }, [])

  /** Where the last press was headed, and when — see `SETTLE_MS`. */
  const heading = useRef<{ left: number; at: number } | null>(null)

  const scroll = useCallback(
    (direction: -1 | 1) => {
      const element = ref.current
      if (!element) return

      const step = Math.max(MIN_STEP, Math.round(element.clientWidth * PAGE))
      const limit = Math.max(0, element.scrollWidth - element.clientWidth)
      const recent = heading.current
      const from = recent && Date.now() - recent.at < SETTLE_MS ? recent.left : element.scrollLeft

      // Clamped here as well as by the element, so a press that runs into the
      // end does not leave a destination past it for the next one to add to.
      const next = Math.min(Math.max(0, from + direction * step), limit)
      heading.current = { left: next, at: Date.now() }
      element.scrollLeft = next

      // The assignment animates, so this reads where the strip is going rather
      // than where it still is — which is what the buttons should reflect.
      measure()
    },
    [measure],
  )

  useEffect(() => {
    const element = ref.current
    if (!element) return

    measure()
    element.addEventListener('scroll', measure, { passive: true })

    // The strip's width changes with the window, and its content's width
    // changes with the tabs — the observer covers the first, and callers call
    // `measure` for the second.
    const observer = new ResizeObserver(measure)
    observer.observe(element)

    /**
     * A wheel over the strip scrolls it sideways.
     *
     * Registered by hand because React attaches `wheel` passively, and a
     * passive listener cannot stop the gesture reaching whatever would scroll
     * behind it. A trackpad's sideways swipe arrives as `deltaX` and the
     * element already handles that itself, so only a vertical wheel is
     * translated — and only when there is somewhere for it to go, so a gesture
     * over a strip that fits is left alone entirely.
     */
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      if (element.scrollWidth <= element.clientWidth + EPSILON) return

      event.preventDefault()
      // The strip is now wherever the wheel puts it, so a destination left by
      // an earlier press is no longer where the next one should measure from.
      heading.current = null
      // Smooth scrolling belongs to the buttons: animating every wheel tick
      // would make the strip lag behind the fingers moving it.
      const previous = element.style.scrollBehavior
      element.style.scrollBehavior = 'auto'
      element.scrollLeft += event.deltaY
      element.style.scrollBehavior = previous
    }
    element.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      element.removeEventListener('scroll', measure)
      element.removeEventListener('wheel', onWheel)
      observer.disconnect()
    }
  }, [measure])

  return { ref, ...state, scroll, measure }
}
