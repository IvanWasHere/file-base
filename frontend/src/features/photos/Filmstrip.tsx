import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useEffect, useRef, useState } from 'react'
import { FileIcon } from '@/components/common/FileIcon'
import { useThumbnail } from '@/hooks/useThumbnail'
import { STAGE_SIZE } from '@/services/thumbs/thumbCache'
import type { FileItem } from '@/types/file'

/**
 * The mockup's `.photo-filmstrip` (PLAN.md §M13), virtualized horizontally.
 *
 * The mockup mounts every thumb; 5,000 photos would mean 5,000 nodes and 5,000
 * thumbnail requests (decision 6). `@tanstack/react-virtual` takes
 * `horizontal: true`, which also means centring the active thumb is
 * `scrollToIndex(i, { align: 'center' })` rather than the mockup's `offsetLeft`
 * arithmetic — that would read the wrong number anyway, since the target thumb
 * may not be mounted at the moment the scroll is asked for.
 *
 * Every card is the same size — one height measured from the strip, one width
 * derived from it — so the strip reads as a row of uniform slots rather than a
 * ragged edge. The photo is centred inside its card and shown whole, which is
 * why a card is 16:9 while the pictures in it are every shape: the card is the
 * frame, not a crop.
 */

const GAP = 4

/** Card shape: wider than tall, so a landscape photo fills it and others centre. */
const ASPECT = 16 / 9

/**
 * The strip's floor, and the cards' own.
 *
 * The mockup's 30% works on a full-height window and collapses to nothing in a
 * four-way split or a short window — at which point the strip is present, takes
 * space, and shows no usable image. The percentage stays as the preferred
 * height; these are the point below which it stops being a filmstrip.
 */
const MIN_STRIP_HEIGHT = 150
const MIN_THUMB = 50

/**
 * Cards are ~250px wide once they fill a 150px strip, so decision 5's "reuse
 * `THUMB_SIZE` (128), they are only 80 CSS px" no longer applies — 128 upscaled
 * into a card that wide is visibly soft, and softer still on a 2× display.
 *
 * `STAGE_SIZE` costs nothing extra here: the stage already renders and caches
 * 512 for the active photo and prefetches its neighbours, so the strip is asking
 * for rows the Photos view was going to create anyway. One size for the whole
 * view, rather than a second cache keyed to this one surface.
 */
const CARD_THUMB_SIZE = STAGE_SIZE

const Thumb = memo(function Thumb({
  item,
  active,
  width,
  height,
  onSelect,
  onActivate,
  dragProps,
}: {
  item: FileItem
  active: boolean
  width: number
  height: number
  onSelect: () => void
  onActivate: () => void
  dragProps: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean }
}) {
  const { ref, url } = useThumbnail(item, CARD_THUMB_SIZE)

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={active}
      // The right-click hit-test reads this on every item, as in the grids. No
      // `data-drop-path`: a photo is not a folder, so there is nothing to drop
      // into (decision 11).
      data-file-path={item.path}
      data-file-row
      {...dragProps}
      title={item.name}
      onMouseDown={(event) => event.button === 0 && onSelect()}
      onDoubleClick={onActivate}
      className={`bg-surface relative flex cursor-default items-center justify-center overflow-hidden rounded-md border-2 transition-colors ${
        active
          ? 'border-accent shadow-[0_0_10px_var(--accent-glow)]'
          : 'hover:border-muted border-transparent'
      }`}
      style={{ width, height, minWidth: MIN_THUMB, minHeight: MIN_THUMB }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          // `contain`, not `cover`: the card is a uniform frame and the photo is
          // shown whole inside it, centred by the flex box above. Cropping every
          // portrait to a 16:9 letterbox would hide most of the picture the strip
          // exists to preview.
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <div
          className="flex size-full items-center justify-center"
          style={{ background: `var(--ft-bg-${item.category})` }}
        >
          <FileIcon category={item.category} size={20} />
        </div>
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-scrim px-1 py-0.5 text-[9px] text-[var(--text-secondary)]">
        {item.name}
      </span>
    </div>
  )
})

interface FilmstripProps {
  photos: readonly FileItem[]
  activeIndex: number
  onJumpTo: (index: number) => void
  onActivate: (item: FileItem) => void
  dragSource: (item: FileItem) => React.HTMLAttributes<HTMLDivElement> & { draggable: boolean }
}

export function Filmstrip({
  photos,
  activeIndex,
  onJumpTo,
  onActivate,
  dragSource,
}: FilmstripProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState(0)

  // ResizeObserver rather than a window listener, as in IconsView: the strip is
  // a percentage of the pane, and a split divider changes the pane without the
  // window changing.
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setMeasured(entry.contentRect.height)
    })
    observer.observe(element)
    setMeasured(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  // One height and one width for every card in the strip. Derived rather than
  // constant so the cards grow with the strip instead of leaving a band of dead
  // space above them.
  const cardHeight = Math.max(measured, MIN_THUMB)
  const cardWidth = Math.max(Math.round(cardHeight * ASPECT), MIN_THUMB)

  // See IconsView: the compiler skips memoizing around useVirtualizer, and
  // `Thumb` is memoised by hand instead.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: photos.length,
    horizontal: true,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => cardWidth + GAP,
    overscan: 4,
  })

  // The card width is not known on the first pass, so the initial estimate is
  // the fallback one. Re-measuring on change keeps the virtual window honest.
  const measure = virtualizer.measure
  useEffect(() => {
    measure()
  }, [cardWidth, measure])

  // Centring follows the active photo however it changed — a click here, an
  // arrow key, or a command that moved the selection from somewhere else.
  const scrollToIndex = virtualizer.scrollToIndex
  useEffect(() => {
    if (activeIndex >= 0) scrollToIndex(activeIndex, { align: 'center' })
  }, [activeIndex, scrollToIndex, cardWidth])

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label="Photos"
      aria-orientation="horizontal"
      // `mt-auto` covers the frame before the first photo is picked, when there
      // is no stage above to push the strip down.
      className="bg-base mt-auto h-[30%] shrink-0 overflow-x-auto overflow-y-hidden px-3 py-2"
      style={{ minHeight: MIN_STRIP_HEIGHT }}
    >
      <div
        className="relative h-full"
        style={{ width: virtualizer.getTotalSize(), minWidth: '100%' }}
      >
        {virtualizer.getVirtualItems().map((virtual) => {
          const item = photos[virtual.index]
          if (!item) return null

          return (
            <div
              key={item.id}
              className="absolute top-0"
              style={{
                left: 0,
                transform: `translateX(${virtual.start}px)`,
                width: cardWidth,
                height: cardHeight,
              }}
            >
              <Thumb
                item={item}
                active={virtual.index === activeIndex}
                width={cardWidth}
                height={cardHeight}
                onSelect={() => onJumpTo(virtual.index)}
                onActivate={() => onActivate(item)}
                dragProps={dragSource(item)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
