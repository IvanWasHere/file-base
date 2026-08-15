import { useCallback, useEffect, useMemo } from 'react'
import { previewKindFor } from '@/features/preview/previewKind'
import { useSelection } from '@/hooks/useSelection'
import { STAGE_SIZE, getThumbnail, isRenderable } from '@/services/thumbs/thumbCache'
import type { FileItem } from '@/types/file'

/**
 * Which item the Photos view is showing, and how stepping moves it
 * (PLAN.md §M13).
 *
 * The active photo *is* the pane selection rather than an index local to the
 * viewer (decision 2). That one choice is what lets the status bar, the preview
 * panel, file operations, drag sources and the context menus keep working here
 * with no special case — they all read the selection, and Photos writes to it
 * like every other view. The cost is deliberate: Photos is single-select, so
 * Cmd/Shift-click, marquee and Cmd+A have nothing to act on.
 */

/**
 * The images in whatever list the pane is showing.
 *
 * Applied to the *shown* list rather than the directory, so a search narrows the
 * strip (decision 3). This is the only view that hides files, and the filter
 * stays in TypeScript — `backend/` keeps the no-filtering rule, with M8's
 * Go-side search criteria still the sole exception.
 */
export function usePhotoList(items: readonly FileItem[]): FileItem[] {
  return useMemo(() => items.filter((item) => previewKindFor(item) === 'image'), [items])
}

export interface PhotoNavigation {
  /** -1 when the selection is not a photo — during the frame before the first is picked. */
  activeIndex: number
  active: FileItem | undefined
  step: (delta: number) => void
  jumpTo: (index: number) => void
  hasPrevious: boolean
  hasNext: boolean
}

export function usePhotoNavigation(
  paneId: string,
  photos: readonly FileItem[],
): PhotoNavigation {
  const { lead, select } = useSelection(paneId, photos)

  const activeIndex = useMemo(
    () => (lead ? photos.findIndex((photo) => photo.path === lead) : -1),
    [photos, lead],
  )

  // Entering the view — or arriving from another view where a text file was
  // selected — lands on the first photo rather than an empty stage. Settles in
  // one pass: selecting makes `activeIndex` non-negative, so the effect no-ops
  // from then on.
  useEffect(() => {
    if (activeIndex >= 0) return
    const first = photos[0]
    if (first) select(first.path)
  }, [photos, activeIndex, select])

  const jumpTo = useCallback(
    (index: number) => {
      const photo = photos[index]
      if (photo) select(photo.path)
    },
    [photos, select],
  )

  // Clamped rather than wrapping, because the mockup *removes* the nav button at
  // each end instead of disabling it — there is nowhere for a step past the edge
  // to go.
  const step = useCallback(
    (delta: number) => {
      if (photos.length === 0) return
      const from = activeIndex < 0 ? 0 : activeIndex
      jumpTo(Math.min(Math.max(from + delta, 0), photos.length - 1))
    },
    [photos.length, activeIndex, jumpTo],
  )

  // One ahead and one behind — the only two a step can reach (decision 7). A
  // held arrow key would otherwise wait on a decode per press. `getThumbnail`
  // de-duplicates in flight and answers from SQLite after that, so repeating
  // this on every step costs nothing once the neighbours are warm.
  useEffect(() => {
    if (activeIndex < 0) return
    for (const offset of [1, -1]) {
      const neighbour = photos[activeIndex + offset]
      if (neighbour && isRenderable(neighbour)) void getThumbnail(neighbour, STAGE_SIZE)
    }
  }, [photos, activeIndex])

  return {
    activeIndex,
    active: activeIndex >= 0 ? photos[activeIndex] : undefined,
    step,
    jumpTo,
    hasPrevious: activeIndex > 0,
    hasNext: activeIndex >= 0 && activeIndex < photos.length - 1,
  }
}
