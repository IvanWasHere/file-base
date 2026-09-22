import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ImageOff, Minus, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IMAGE_CAP, imageMimeFor, previewKey } from '@/features/preview/previewKind'
import type { ImageZoom } from '@/hooks/useImageZoom'
import { bridge } from '@/services/bridge'
import { STAGE_SIZE, getThumbnail, isRenderable } from '@/services/thumbs/thumbCache'
import type { FileItem } from '@/types/file'

/**
 * The main stage — the mockup's `.photo-main` (PLAN.md §M13).
 *
 * Two images, deliberately. The cached 512px thumbnail paints immediately and
 * the original swaps in over it once decoded (decision 4), because
 * `ReadFileBase64` refuses anything over `IMAGE_CAP` and a data URL for a 12MB
 * photo is ~16MB of JSON per keypress. Stepping therefore feels instant instead
 * of round-tripping the disk on every press, and a photo past the cap keeps the
 * 512 rather than showing a `too-large` error in a viewer whose entire job is
 * showing photos.
 */

/** The cached 512, tracked against the file so a step never shows the last one. */
function useStageThumbnail(item: FileItem): string | null {
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null)
  const identity = `${item.path}:${item.modifiedAt}`

  useEffect(() => {
    if (!isRenderable(item)) return
    let live = true
    void getThumbnail(item, STAGE_SIZE).then((url) => {
      if (live && url) setLoaded({ key: identity, url })
    })
    return () => {
      live = false
    }
  }, [item, identity])

  return loaded?.key === identity ? loaded.url : null
}

interface PhotoStageProps {
  item: FileItem
  hasPrevious: boolean
  hasNext: boolean
  onStep: (delta: number) => void
  onActivate: (item: FileItem) => void
  /**
   * Owned by `PhotosView` rather than created here, because the keyboard lives
   * up there with the rest of the view's key handling (§M30 decision 5). The
   * stage is where it is *attached*: the frame, the transform and the controls.
   */
  zoom: ImageZoom
  /**
   * Hands the frame to the zoom, and a prop of its own rather than a field of
   * `zoom`: React's lint rules read anything used as a `ref` as a ref, and one
   * reached through `zoom` would make every `zoom.x` beside it a ref read
   * during render.
   */
  attachFrame: (element: HTMLElement | null) => void
}

export function PhotoStage({
  item,
  hasPrevious,
  hasNext,
  onStep,
  onActivate,
  zoom,
  attachFrame,
}: PhotoStageProps) {
  const thumbnail = useStageThumbnail(item)

  // Skipped outright past the cap: the backend would refuse it, and the 512 is
  // the answer either way. Not renderable by `backend/thumbs` (webp, svg, bmp,
  // ico) means there is no thumbnail to fall back to, so the full read is the
  // only source and runs regardless.
  const { data: full } = useQuery({
    queryKey: previewKey(item.path, 'image', item.modifiedAt),
    queryFn: () => bridge.fs.readFileBase64(item.path, IMAGE_CAP),
    enabled: item.size <= IMAGE_CAP,
    retry: false,
  })

  // An extension is a claim, not a fact — M10's lesson. A text file named `.png`
  // reads back perfectly well and only the decoder knows better, so the image's
  // own `onError` demotes it. Tracked against the path so selecting another
  // photo clears it without an effect.
  const [undecodable, setUndecodable] = useState<string | null>(null)
  const fullSrc =
    full && undecodable !== item.path ? `data:${imageMimeFor(item.extension)};base64,${full}` : null

  // The natural size is what the pan bounds are made of: a photo narrower than
  // the frame has no sideways slack until it is zoomed past filling it, and
  // clamping to the frame instead would let it be dragged into empty space.
  const reportSize = (image: HTMLImageElement) =>
    zoom.reportContentSize({ width: image.naturalWidth, height: image.naturalHeight })

  return (
    // A figure with a caption, which is what this is: one image plus the name
    // beneath it. It also gives the stage an accessible container distinct from
    // the preview panel, which renders the same photo — following the selection
    // is the whole point of decision 2, so "the image named X" is ambiguous on
    // its own.
    // `flex-1 min-h-0` rather than a fixed 70%: the filmstrip below owns its own
    // height and floor, and the stage takes whatever is left. `min-h-0` is what
    // lets it actually shrink inside a flex column instead of forcing the
    // filmstrip off the bottom of a short pane.
    <figure
      ref={attachFrame}
      className="bg-deep border-edge relative m-0 min-h-0 flex-1 overflow-hidden border-b"
      onDoubleClick={() => onActivate(item)}
    >
      {/* One transform over both layers, so zooming cannot pull the 512 and the
          full decode apart: they are the same picture at different resolutions
          and must move as one. The frame above clips whatever hangs over. */}
      <div
        className={`absolute inset-0 ${
          zoom.canPan ? (zoom.panning ? 'cursor-grabbing' : 'cursor-grab') : ''
        }`}
        style={{
          transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
          transformOrigin: 'center',
        }}
        onPointerDown={zoom.onPointerDown}
      >
        {/* Both layers are the same centred overlay, so the swap cannot shift the
            image by a pixel. Centring lives on the wrapper rather than on the img
            via `margin: auto`, which only centres a replaced element once it has a
            definite size — not the case while a data URL is still decoding. */}
        {thumbnail && (
          <div className="absolute inset-0 flex items-center justify-center">
            <img
              src={thumbnail}
              alt=""
              aria-hidden
              draggable={false}
              // The 512 is a stand-in until the original decodes, so its shape
              // sets the pan bounds only while nothing better has reported one.
              onLoad={(event) => {
                if (fullSrc) return
                reportSize(event.currentTarget)
              }}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        )}

        {fullSrc && (
          <div className="absolute inset-0 flex items-center justify-center">
            <img
              src={fullSrc}
              alt={item.name}
              draggable={false}
              onError={() => setUndecodable(item.path)}
              onLoad={(event) => reportSize(event.currentTarget)}
              // Over the thumbnail rather than replacing it, so the swap has no
              // frame where the stage is empty.
              className="max-h-full max-w-full object-contain"
            />
          </div>
        )}
      </div>

      {!thumbnail && !fullSrc && (
        <div className="text-muted absolute inset-0 flex flex-col items-center justify-center gap-2">
          <ImageOff size={28} strokeWidth={1.25} className="opacity-40" />
          <span className="text-[11px]">This image could not be shown</span>
        </div>
      )}

      {/* Only over a picture: there is nothing to magnify about the "could not be
          shown" placeholder, and a control that does nothing is worse than none. */}
      {(thumbnail || fullSrc) && <ZoomControls zoom={zoom} />}

      {/* Absent at the ends rather than disabled, as in the mockup. */}
      {hasPrevious && <StepButton direction="prev" onClick={() => onStep(-1)} />}
      {hasNext && <StepButton direction="next" onClick={() => onStep(1)} />}

      <figcaption className="pointer-events-none absolute bottom-3 left-1/2 max-w-[70%] -translate-x-1/2 truncate rounded-full bg-scrim px-3.5 py-1 text-xs text-[var(--text-secondary)]">
        {item.name}
      </figcaption>
    </figure>
  )
}

/**
 * The zoom pill — minus, the current percentage, plus (§M30 decision 4).
 *
 * Disabled at the ends rather than absent, unlike the step buttons beside it: a
 * stepper that loses a button changes width and moves the other two under the
 * cursor, and unlike stepping there is always a way back from either end.
 */
function ZoomControls({ zoom }: { zoom: ImageZoom }) {
  return (
    <div className="border-edge bg-scrim absolute top-3 right-3 z-10 flex items-center gap-0.5 rounded-full border p-0.5">
      <ZoomButton label="Zoom out" onClick={zoom.zoomOut} disabled={!zoom.canZoomOut}>
        <Minus size={14} />
      </ZoomButton>

      {/* The readout is also the way back: one click for the whole picture,
          which is otherwise several presses of minus. */}
      <button
        type="button"
        aria-label="Reset zoom"
        onClick={zoom.reset}
        disabled={!zoom.zoomedIn}
        className="text-primary hover:bg-accent hover:text-on-accent min-w-12 rounded-full px-2 py-1 text-[11px] tabular-nums transition-colors disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-[var(--text-primary)]"
      >
        {Math.round(zoom.scale * 100)}%
      </button>

      <ZoomButton label="Zoom in" onClick={zoom.zoomIn} disabled={!zoom.canZoomIn}>
        <Plus size={14} />
      </ZoomButton>
    </div>
  )
}

function ZoomButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="text-primary hover:bg-accent hover:text-on-accent flex size-7 items-center justify-center rounded-full transition-colors disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--text-primary)]"
    >
      {children}
    </button>
  )
}

function StepButton({ direction, onClick }: { direction: 'prev' | 'next'; onClick: () => void }) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      aria-label={direction === 'prev' ? 'Previous photo' : 'Next photo'}
      onClick={onClick}
      className={`border-edge text-primary hover:bg-accent bg-scrim hover:text-on-accent absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border transition-colors ${
        direction === 'prev' ? 'left-4' : 'right-4'
      }`}
    >
      <Icon size={18} />
    </button>
  )
}
