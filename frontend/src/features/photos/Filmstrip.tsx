import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useEffect, useRef } from 'react'
import { FileIcon } from '@/components/common/FileIcon'
import { useThumbnail } from '@/hooks/useThumbnail'
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
 * Thumbs reuse `THUMB_SIZE` (128) rather than asking for 160 for a 2× display:
 * the icon grids have already cached 128 for these same files, and a second size
 * would double the cache for one view's benefit (decision 5).
 */

const THUMB_WIDTH = 80
const GAP = 4

/**
 * The strip's floor, and the thumbs' own.
 *
 * The mockup's 30% works on a full-height window and collapses to nothing in a
 * four-way split or a short window — at which point the strip is present, takes
 * space, and shows no usable image. The percentage stays as the preferred
 * height; these are the point below which it stops being a filmstrip.
 */
const MIN_STRIP_HEIGHT = 150
const MIN_THUMB = 50

const Thumb = memo(function Thumb({
  item,
  active,
  onSelect,
  onActivate,
  dragProps,
}: {
  item: FileItem
  active: boolean
  onSelect: () => void
  onActivate: () => void
  dragProps: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean }
}) {
  const { ref, url } = useThumbnail(item)

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
      className={`bg-surface relative h-full cursor-default overflow-hidden rounded-md border-2 transition-colors ${
        active
          ? 'border-accent shadow-[0_0_10px_var(--accent-glow)]'
          : 'hover:border-muted border-transparent'
      }`}
      style={{
        width: THUMB_WIDTH,
        minWidth: MIN_THUMB,
        minHeight: MIN_THUMB,
      }}
    >
      {url ? (
        <img src={url} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        <div
          className="flex size-full items-center justify-center"
          style={{ background: `var(--ft-bg-${item.category})` }}
        >
          <FileIcon category={item.category} size={20} />
        </div>
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-0.5 text-[9px] text-[var(--text-secondary)]">
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

  // See IconsView: the compiler skips memoizing around useVirtualizer, and
  // `Thumb` is memoised by hand instead.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: photos.length,
    horizontal: true,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => THUMB_WIDTH + GAP,
    overscan: 6,
  })

  // Centring follows the active photo however it changed — a click here, an
  // arrow key, or a command that moved the selection from somewhere else.
  const scrollToIndex = virtualizer.scrollToIndex
  useEffect(() => {
    if (activeIndex >= 0) scrollToIndex(activeIndex, { align: 'center' })
  }, [activeIndex, scrollToIndex])

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label="Photos"
      aria-orientation="horizontal"
      // `shrink-0` with a floor keeps it against the bottom edge: the stage
      // above is `flex-1`, so every spare pixel goes there and the strip never
      // gives up its own.
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
              className="absolute top-0 h-full"
              style={{ left: 0, transform: `translateX(${virtual.start}px)`, width: THUMB_WIDTH }}
            >
              <Thumb
                item={item}
                active={virtual.index === activeIndex}
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
