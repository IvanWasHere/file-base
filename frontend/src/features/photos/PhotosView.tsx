import { ImageOff } from 'lucide-react'
import { useRef } from 'react'
import { Filmstrip } from '@/features/photos/Filmstrip'
import { PhotoStage } from '@/features/photos/PhotoStage'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useDragSource, useDropZone } from '@/hooks/useFileDrag'
import type { ImageZoom } from '@/hooks/useImageZoom'
import { useImageZoom } from '@/hooks/useImageZoom'
import { useListKeyboard } from '@/hooks/useListKeyboard'
import { usePhotoList, usePhotoNavigation } from '@/hooks/usePhotoNavigation'
import { useReclaimFocus } from '@/hooks/useReclaimFocus'
import { useSelection } from '@/hooks/useSelection'
import { useDragStore } from '@/stores/dragStore'
import type { FileItem } from '@/types/file'

/**
 * The fifth view mode — the mockup's `.photo-viewer` (PLAN.md §M13).
 *
 * A view mode, not a modal viewer (decision 1): it renders inside the pane, so
 * it inherits splits, tabs, the breadcrumb, the pane header and the preview
 * panel for free. A full-window lightbox is a different feature.
 *
 * The 70/30 split between stage and filmstrip is fixed (decision 12) — making it
 * resizable would be a preference to persist per pane, which is more state than
 * this earns.
 */

/**
 * Plain keys, no modifiers: the registry owns everything with a Cmd on it.
 *
 * Each returns whether it took the key, so a key it declines falls through to
 * the list's handler untouched — which is how Escape still clears the selection
 * when there is no zoom to undo.
 */
const ZOOM_KEYS: Record<string, ((zoom: ImageZoom) => boolean) | undefined> = {
  '+': (zoom) => (zoom.zoomIn(), true),
  '=': (zoom) => (zoom.zoomIn(), true),
  '-': (zoom) => (zoom.zoomOut(), true),
  _: (zoom) => (zoom.zoomOut(), true),
  '0': (zoom) => (zoom.reset(), true),
  Escape: (zoom) => {
    if (!zoom.zoomedIn) return false
    zoom.reset()
    return true
  },
}

/** Read as "which way the picture moves", so Right shows what is off to the right. */
const PAN_KEYS: Record<string, [number, number] | undefined> = {
  ArrowLeft: [1, 0],
  ArrowRight: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
}

interface PhotosViewProps {
  paneId: string
  /** The folder being shown — the drop target for the whole viewer. */
  path: string
  items: FileItem[]
  onActivate: (item: FileItem) => void
  onFocus: () => void
}

export function PhotosView({ paneId, path, items, onActivate, onFocus }: PhotosViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const photos = usePhotoList(items)
  const { activeIndex, active, step, jumpTo, hasPrevious, hasNext } = usePhotoNavigation(
    paneId,
    photos,
  )

  const { lead, select, extendTo, selectAll, clear } = useSelection(paneId, photos)

  // Owned here rather than in the stage because the keys are handled here, with
  // the rest of the view's keyboard (§M30 decision 5). Keyed on the photo, so
  // stepping always arrives at the whole picture.
  const zoom = useImageZoom(active?.path ?? '')

  // Horizontal: Left/Right step, Up/Down decline. Registering here rather than
  // adding a second pane-scoped key handler is decision 8 — it keeps every
  // binding resolvable in one place, which is the drift M11's registry exists to
  // prevent. Home/End fall out of the same hook.
  const stepKeys = useListKeyboard({
    items: photos,
    lead,
    orientation: 'horizontal',
    onSelect: select,
    onExtendTo: extendTo,
    onSelectAll: selectAll,
    onClear: clear,
  })

  /**
   * Zoom keys, tried before the list's (§M30 decision 5).
   *
   * They go first for two reasons. `+`, `-` and `0` would otherwise be swallowed
   * by type-ahead, which is not much of a loss — few photos are named "0…" —
   * and, while zoomed, the arrows pan instead of stepping: there is nowhere else
   * for a keyboard to move a picture that is bigger than its frame, and stepping
   * is still a chevron away, or an Escape, which puts the whole photo back and
   * gives the arrows their usual meaning again.
   */
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      if (ZOOM_KEYS[event.key]?.(zoom)) {
        event.preventDefault()
        return
      }

      const pan = zoom.canPan ? PAN_KEYS[event.key] : undefined
      if (pan) {
        zoom.panByKey(pan[0], pan[1])
        event.preventDefault()
        return
      }
    }

    stepKeys(event)
  }

  const handleContextMenu = useContextMenu(paneId, photos)
  const dragSource = useDragSource(paneId, path)
  const dropZone = useDropZone(path)
  const dropTarget = useDragStore((state) => state.over)

  useReclaimFocus(scrollRef, photos.length > 0)

  // Its own empty state: the folder may be full of things that are not images,
  // which "This folder is empty" would misreport.
  if (photos.length === 0) {
    return (
      <div
        onContextMenu={handleContextMenu}
        {...dropZone}
        className={`text-muted flex h-full flex-col items-center justify-center gap-2 ${
          dropTarget === path ? 'ring-accent ring-2 ring-inset' : ''
        }`}
      >
        <ImageOff size={36} strokeWidth={1.25} className="opacity-40" />
        <span className="text-[13px]">No images in this folder</span>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseDown={onFocus}
      onContextMenu={handleContextMenu}
      {...dropZone}
      className={`flex h-full flex-col outline-none ${
        dropTarget === path ? 'ring-accent ring-2 ring-inset' : ''
      }`}
    >
      {active && (
        <PhotoStage
          item={active}
          hasPrevious={hasPrevious}
          hasNext={hasNext}
          onStep={step}
          onActivate={onActivate}
          zoom={zoom}
          attachFrame={zoom.attachFrame}
        />
      )}

      <Filmstrip
        photos={photos}
        activeIndex={activeIndex}
        onJumpTo={jumpTo}
        onActivate={onActivate}
        dragSource={dragSource}
      />
    </div>
  )
}
