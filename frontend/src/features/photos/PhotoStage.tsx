import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IMAGE_CAP, imageMimeFor, previewKey } from '@/features/preview/previewKind'
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
}

export function PhotoStage({ item, hasPrevious, hasNext, onStep, onActivate }: PhotoStageProps) {
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
    full && undecodable !== item.path
      ? `data:${imageMimeFor(item.extension)};base64,${full}`
      : null

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
      className="bg-deep border-edge relative m-0 min-h-0 flex-1 overflow-hidden border-b"
      onDoubleClick={() => onActivate(item)}
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
            // Over the thumbnail rather than replacing it, so the swap has no
            // frame where the stage is empty.
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}

      {!thumbnail && !fullSrc && (
        <div className="text-muted absolute inset-0 flex flex-col items-center justify-center gap-2">
          <ImageOff size={28} strokeWidth={1.25} className="opacity-40" />
          <span className="text-[11px]">This image could not be shown</span>
        </div>
      )}

      {/* Absent at the ends rather than disabled, as in the mockup. */}
      {hasPrevious && <StepButton direction="prev" onClick={() => onStep(-1)} />}
      {hasNext && <StepButton direction="next" onClick={() => onStep(1)} />}

      <figcaption className="pointer-events-none absolute bottom-3 left-1/2 max-w-[70%] -translate-x-1/2 truncate rounded-full bg-black/70 px-3.5 py-1 text-xs text-[var(--text-secondary)]">
        {item.name}
      </figcaption>
    </figure>
  )
}

function StepButton({ direction, onClick }: { direction: 'prev' | 'next'; onClick: () => void }) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      aria-label={direction === 'prev' ? 'Previous photo' : 'Next photo'}
      onClick={onClick}
      className={`border-edge text-primary hover:bg-accent absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border bg-black/60 transition-colors hover:text-black ${
        direction === 'prev' ? 'left-4' : 'right-4'
      }`}
    >
      <Icon size={18} />
    </button>
  )
}
