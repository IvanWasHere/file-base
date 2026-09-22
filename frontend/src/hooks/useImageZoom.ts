import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Zoom and pan for a single image shown inside a fixed frame (PLAN.md §M30).
 *
 * The frame is the Photos stage, which already clips; this hook owns only the
 * numbers — a scale and an offset — and leaves the transform to the caller. It
 * is deliberately ignorant of *which* image it is moving, so the same three
 * values drive the cached 512 and the full decode together and the swap between
 * them cannot shift the picture (§M13 decision 4).
 *
 * Two rules keep the maths honest:
 *
 * 1. **1× is fit, never smaller.** `object-contain` already sizes the image to
 *    the frame, so zooming *out* past 1 would shrink a photo inside a viewer
 *    whose job is showing it. The minimum is the view you started from.
 * 2. **The offset is clamped to the image, not to the frame.** A portrait photo
 *    letterboxed in a wide frame has no slack sideways until it is wide enough
 *    to overflow, so the bounds come from the *fitted* size times the scale —
 *    which is why the caller reports the image's natural size. Until it does,
 *    the frame stands in for it, which is right for anything filling the frame
 *    and merely generous for anything that does not.
 *
 * The frame arrives as a callback ref into state rather than as a `useRef`,
 * because the bounds are read while rendering — for the cursor, and for whether
 * an arrow key pans — and a ref read during render is exactly what React's
 * lint rules forbid.
 */

const MIN_SCALE = 1
const MAX_SCALE = 8

/** One button press, and roughly one notch of a mouse wheel. */
const STEP = 1.25

/** One arrow press, as a fraction of the frame. */
const KEY_PAN = 0.2

/** Wheel zoom rate. A trackpad pinch arrives as a `ctrlKey` wheel, magnified. */
const WHEEL_RATE = 0.0025
const PINCH_RATE = 0.01

interface Size {
  width: number
  height: number
}

interface View {
  scale: number
  /** Pixels the image is moved from centred, at the *current* scale. */
  x: number
  y: number
}

interface Bounds {
  x: number
  y: number
}

const FIT: View = { scale: 1, x: 0, y: 0 }

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/** How far the image may move from centre on each axis, at `scale`. */
function boundsFor(frame: HTMLElement | null, content: Size | null, scale: number): Bounds {
  if (!frame) return { x: 0, y: 0 }

  const frameWidth = frame.clientWidth
  const frameHeight = frame.clientHeight

  // `max-w-full max-h-full object-contain` fits by the tighter axis and, being
  // a maximum, never enlarges — hence the 1.
  const ratio = content ? Math.min(frameWidth / content.width, frameHeight / content.height, 1) : 1
  const fittedWidth = content ? content.width * ratio : frameWidth
  const fittedHeight = content ? content.height * ratio : frameHeight

  return {
    x: Math.max(0, (fittedWidth * scale - frameWidth) / 2),
    y: Math.max(0, (fittedHeight * scale - frameHeight) / 2),
  }
}

/** A candidate view, pulled back inside its bounds. */
function settle(next: View, frame: HTMLElement | null, content: Size | null): View {
  const bounds = boundsFor(frame, content, next.scale)
  return {
    scale: next.scale,
    x: clamp(next.x, -bounds.x, bounds.x),
    y: clamp(next.y, -bounds.y, bounds.y),
  }
}

export interface ImageZoom {
  /** Goes on the frame: the element the image is centred in and clipped by. */
  attachFrame: (element: HTMLElement | null) => void
  scale: number
  x: number
  y: number
  /** True while a drag is moving the image, for the cursor. */
  panning: boolean
  /** True when the image overflows its frame, so there is somewhere to pan to. */
  canPan: boolean
  zoomedIn: boolean
  canZoomIn: boolean
  canZoomOut: boolean
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
  /** Arrow-key panning, in frame fractions: `(1, 0)` moves the picture right. */
  panByKey: (dx: number, dy: number) => void
  /** The image's own pixel size, once something has decoded it. */
  reportContentSize: (size: Size) => void
  onPointerDown: (event: React.PointerEvent) => void
}

/**
 * Resets whenever `resetKey` changes — the caller passes the photo's identity,
 * so stepping to the next photo always lands on the whole picture rather than
 * on the previous one's crop, which would be a different part of a different
 * image (§M30 decision 3).
 */
export function useImageZoom(resetKey: string): ImageZoom {
  const [frame, setFrame] = useState<HTMLElement | null>(null)
  const [content, setContent] = useState<Size | null>(null)
  const [view, setView] = useState<View>(FIT)
  const [panning, setPanning] = useState(false)

  // Adjusted during render rather than in an effect, which is React's own
  // answer to "reset state when a prop changes": an effect would paint the new
  // photo once at the old zoom before putting it back.
  const [shownKey, setShownKey] = useState(resetKey)
  if (shownKey !== resetKey) {
    setShownKey(resetKey)
    setContent(null)
    setView(FIT)
  }

  // Clamped on the way out rather than in storage, because the bounds move
  // under a stored offset: the frame is resized, or the real image size arrives
  // and a photo narrower than the frame turns out to have no sideways slack at
  // all. Deriving it means there is no stale offset to correct afterwards.
  const shown = settle(view, frame, content)

  // A wheel or a drag needs the view as it is *now*, not as it was when the
  // listener was made. Written in an effect, read only from handlers.
  const latest = useRef(shown)
  useEffect(() => {
    latest.current = shown
  }, [shown])

  /**
   * `anchor` is the point to hold still, in pixels from the frame's centre —
   * the pointer for a wheel, the centre itself for a button. Keeping it fixed
   * is what makes a wheel zoom land where the cursor is pointing instead of
   * sliding the subject out of the frame.
   */
  const zoomTo = useCallback(
    (requested: number, anchor?: { x: number; y: number }) => {
      setView((stored) => {
        const current = settle(stored, frame, content)
        const scale = clamp(requested, MIN_SCALE, MAX_SCALE)
        if (scale === current.scale) return stored

        const growth = scale / current.scale
        const ax = anchor?.x ?? 0
        const ay = anchor?.y ?? 0
        return settle(
          {
            scale,
            x: ax - growth * (ax - current.x),
            y: ay - growth * (ay - current.y),
          },
          frame,
          content,
        )
      })
    },
    [frame, content],
  )

  const zoomIn = useCallback(() => zoomTo(latest.current.scale * STEP), [zoomTo])
  const zoomOut = useCallback(() => zoomTo(latest.current.scale / STEP), [zoomTo])
  const reset = useCallback(() => setView(FIT), [])

  const panBy = useCallback(
    (dx: number, dy: number) => {
      setView((stored) => {
        const current = settle(stored, frame, content)
        return settle({ ...current, x: current.x + dx, y: current.y + dy }, frame, content)
      })
    },
    [frame, content],
  )

  const panByKey = useCallback(
    (dx: number, dy: number) => {
      panBy(dx * (frame?.clientWidth ?? 0) * KEY_PAN, dy * (frame?.clientHeight ?? 0) * KEY_PAN)
    },
    [panBy, frame],
  )

  const reportContentSize = useCallback((size: Size) => {
    if (size.width <= 0 || size.height <= 0) return
    setContent((known) =>
      known && known.width === size.width && known.height === size.height ? known : size,
    )
  }, [])

  // Registered by hand, because React attaches `wheel` passively and a passive
  // listener cannot stop the gesture reaching whatever would scroll behind it —
  // the same reason `useOverflowScroll` does this.
  useEffect(() => {
    if (!frame) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()

      const rect = frame.getBoundingClientRect()
      const anchor = {
        x: event.clientX - (rect.left + rect.width / 2),
        y: event.clientY - (rect.top + rect.height / 2),
      }

      // Exponential, so a notch up and a notch down cancel out exactly, and
      // capped per event because a line-mode wheel reports in tens.
      const rate = event.ctrlKey ? PINCH_RATE : WHEEL_RATE
      const factor = clamp(Math.exp(-event.deltaY * rate), 0.4, 2.5)
      zoomTo(latest.current.scale * factor, anchor)
    }

    frame.addEventListener('wheel', onWheel, { passive: false })
    return () => frame.removeEventListener('wheel', onWheel)
  }, [frame, zoomTo])

  /**
   * Drag to pan, on `window` rather than pointer capture: the pointer leaving
   * the frame mid-drag is normal — the whole point is that the image is bigger
   * than what holds it — and capture on the image would also have to survive
   * the full decode replacing it.
   */
  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return

      const bounds = boundsFor(frame, content, latest.current.scale)
      if (bounds.x === 0 && bounds.y === 0) return

      // Otherwise the browser starts its own image drag and the pan stutters.
      event.preventDefault()

      const origin = { x: event.clientX, y: event.clientY }
      const from = latest.current
      setPanning(true)

      const onMove = (move: PointerEvent) => {
        setView(
          settle(
            {
              ...from,
              x: from.x + (move.clientX - origin.x),
              y: from.y + (move.clientY - origin.y),
            },
            frame,
            content,
          ),
        )
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        setPanning(false)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [frame, content],
  )

  const bounds = boundsFor(frame, content, shown.scale)

  return {
    attachFrame: setFrame,
    scale: shown.scale,
    x: shown.x,
    y: shown.y,
    panning,
    canPan: bounds.x > 0 || bounds.y > 0,
    zoomedIn: shown.scale > MIN_SCALE,
    canZoomIn: shown.scale < MAX_SCALE,
    canZoomOut: shown.scale > MIN_SCALE,
    zoomIn,
    zoomOut,
    reset,
    panByKey,
    reportContentSize,
    onPointerDown,
  }
}
