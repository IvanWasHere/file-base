import { useCallback, useEffect, useRef, useState } from 'react'
import { rectFromPoints, rectsIntersect, type Rect } from '@/utils/selection'

/**
 * Rubber-band selection.
 *
 * Item rectangles come from a geometry callback rather than from the DOM,
 * because the lists are virtualized: dragging past the bottom of the viewport
 * must select rows that were never rendered. Asking the DOM would silently miss
 * them.
 *
 * Coordinates are content-space (scroll offset included), so a drag that
 * auto-scrolls keeps selecting the right items.
 */

/** Small threshold so a click that jitters by a pixel is not a drag. */
const DRAG_THRESHOLD = 4

interface UseMarqueeSelectionOptions {
  scrollRef: React.RefObject<HTMLElement | null>
  itemCount: number
  /** Content-space rectangle for an item index. */
  getItemRect: (index: number) => Rect | null
  onSelect: (indices: number[]) => void
  enabled?: boolean
}

export function useMarqueeSelection({
  scrollRef,
  itemCount,
  getItemRect,
  onSelect,
  enabled = true,
}: UseMarqueeSelectionOptions) {
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const latest = useRef({ itemCount, getItemRect, onSelect })

  useEffect(() => {
    latest.current = { itemCount, getItemRect, onSelect }
  }, [itemCount, getItemRect, onSelect])

  const toContentPoint = useCallback(
    (clientX: number, clientY: number) => {
      const element = scrollRef.current
      if (!element) return null
      const box = element.getBoundingClientRect()
      return {
        x: clientX - box.left + element.scrollLeft,
        y: clientY - box.top + element.scrollTop,
      }
    },
    [scrollRef],
  )

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (!enabled || event.button !== 0) return
      // Only start on empty space; a drag beginning on a row belongs to
      // drag-and-drop (M9), not marquee selection.
      if ((event.target as HTMLElement).closest('[data-file-row]')) return

      const point = toContentPoint(event.clientX, event.clientY)
      if (!point) return
      origin.current = point
    },
    [enabled, toContentPoint],
  )

  useEffect(() => {
    if (!enabled) return

    const handleMove = (event: MouseEvent) => {
      const start = origin.current
      if (!start) return

      const point = toContentPoint(event.clientX, event.clientY)
      if (!point) return

      if (
        !marquee &&
        Math.abs(point.x - start.x) < DRAG_THRESHOLD &&
        Math.abs(point.y - start.y) < DRAG_THRESHOLD
      ) {
        return
      }

      const rect = rectFromPoints(start.x, start.y, point.x, point.y)
      setMarquee(rect)

      const hits: number[] = []
      for (let index = 0; index < latest.current.itemCount; index += 1) {
        const itemRect = latest.current.getItemRect(index)
        if (itemRect && rectsIntersect(rect, itemRect)) hits.push(index)
      }
      latest.current.onSelect(hits)
    }

    const handleUp = () => {
      origin.current = null
      setMarquee(null)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [enabled, marquee, toContentPoint])

  /** Absolutely-positioned overlay, or null when not dragging. */
  const marqueeStyle = marquee
    ? {
        left: marquee.left,
        top: marquee.top,
        width: marquee.right - marquee.left,
        height: marquee.bottom - marquee.top,
      }
    : null

  return { onMouseDown, marqueeStyle, isDragging: marquee !== null }
}
