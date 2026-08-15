import { ImageOff } from 'lucide-react'
import { useRef } from 'react'
import { Filmstrip } from '@/features/photos/Filmstrip'
import { PhotoStage } from '@/features/photos/PhotoStage'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useDragSource, useDropZone } from '@/hooks/useFileDrag'
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

  // Horizontal: Left/Right step, Up/Down decline. Registering here rather than
  // adding a second pane-scoped key handler is decision 8 — it keeps every
  // binding resolvable in one place, which is the drift M11's registry exists to
  // prevent. Home/End fall out of the same hook.
  const handleKeyDown = useListKeyboard({
    items: photos,
    lead,
    orientation: 'horizontal',
    onSelect: select,
    onExtendTo: extendTo,
    onSelectAll: selectAll,
    onClear: clear,
  })

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
