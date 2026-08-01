/**
 * Drag and drop wiring (PLAN.md M9).
 *
 * Drop handling lives on the *container*, not on each row. A virtualized list
 * re-creates its rows constantly, and giving thirty of them their own handlers
 * and their own volume-list subscription would be wasteful and fiddly; one set
 * of handlers on the scroll element hit-tests with `closest()` instead. Rows
 * only have to declare what they are, via `data-drop-path`.
 *
 * Dragging *out* to Finder is not supported by the webview and cannot be
 * (PLAN.md §3). Reveal in Finder and copy-path are the escape hatch.
 */

import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useFileOperations } from '@/hooks/useFileOperations'
import { volumesQuery } from '@/services/filesystem/queries'
import { useDragStore, type DragEffect } from '@/stores/dragStore'
import { useSelectionStore } from '@/stores/selectionStore'
import type { FileItem } from '@/types/file'
import { dropEffectFor } from '@/utils/volume'
import { isAncestor, normalize } from '@/utils/path'

/** Marks a drag as belonging to this app, so foreign drags are ignored. */
export const INTERNAL_DRAG_TYPE = 'application/x-file-base-paths'

/** Mount points, for the same-volume test behind copy-versus-move. */
function useMountPoints(): string[] {
  const { data: volumes = [] } = useQuery(volumesQuery())
  return useMemo(() => volumes.map((volume) => volume.path), [volumes])
}

/**
 * Whether `destination` can receive `sources`.
 *
 * A folder cannot be dropped into itself or into its own subtree — the
 * operation would fail in the backend anyway, but refusing at the target means
 * the row never lights up, so the drag never looks like it would work.
 */
export function canDrop(
  sources: readonly string[],
  destination: string,
  effect: DragEffect,
  sourceDir: string,
): boolean {
  if (sources.length === 0) return false
  const target = normalize(destination)

  for (const source of sources) {
    if (isAncestor(normalize(source), target)) return false
  }
  // Dropping back where they came from does nothing — unless it is a copy,
  // which is Duplicate.
  if (effect === 'move' && normalize(sourceDir) === target) return false
  return true
}

/** Props for an element the user can pick up. */
export function useDragSource(paneId: string, sourceDir: string) {
  const start = useDragStore((state) => state.start)
  const end = useDragStore((state) => state.end)

  return useCallback(
    (item: FileItem) => ({
      draggable: !item.broken,
      onDragStart: (event: React.DragEvent) => {
        const selected = useSelectionStore.getState().byPane[paneId]?.selected
        // Dragging an unselected row drags just that row, as Finder does;
        // dragging a selected one takes the whole selection with it.
        const paths =
          selected && selected.has(item.path) && selected.size > 0
            ? [...selected]
            : [item.path]

        start(paths, sourceDir)
        event.dataTransfer.effectAllowed = 'copyMove'
        event.dataTransfer.setData(INTERNAL_DRAG_TYPE, paths.join('\n'))
        // Plain text as well: it costs nothing and makes the paths readable to
        // anything else that inspects the drag.
        event.dataTransfer.setData('text/plain', paths.join('\n'))
      },
      onDragEnd: () => end(),
    }),
    [paneId, sourceDir, start, end],
  )
}

/**
 * Props for a container that accepts drops.
 *
 * `fallbackPath` receives the drop when the pointer is not over a folder row —
 * the pane's own directory, or the sidebar entry's path.
 */
export function useDropZone(fallbackPath: string) {
  const operations = useFileOperations()
  const mountPoints = useMountPoints()
  const hover = useDragStore((state) => state.hover)
  const end = useDragStore((state) => state.end)

  /** The folder under the pointer, or the container's own path. */
  const resolveTarget = useCallback(
    (event: React.DragEvent): string => {
      const row = (event.target as HTMLElement | null)?.closest?.('[data-drop-path]')
      return row?.getAttribute('data-drop-path') || fallbackPath
    },
    [fallbackPath],
  )

  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      const { paths, sourceDir } = useDragStore.getState()
      if (paths.length === 0) return

      const target = resolveTarget(event)
      const effect = dropEffectFor(paths, target, mountPoints, { altKey: event.altKey })

      if (!canDrop(paths, target, effect, sourceDir)) {
        hover(null, null)
        event.dataTransfer.dropEffect = 'none'
        return
      }

      // preventDefault is what makes an element a drop target at all; without
      // it the browser refuses the drop and shows the "no entry" cursor.
      event.preventDefault()
      event.dataTransfer.dropEffect = effect
      hover(target, effect)
    },
    [resolveTarget, mountPoints, hover],
  )

  const onDragLeave = useCallback(
    (event: React.DragEvent) => {
      // Leaving for a child element still fires dragleave on the parent, which
      // would flicker the highlight off and on for every row crossed.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      hover(null, null)
    },
    [hover],
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const { paths, sourceDir } = useDragStore.getState()
      end()
      if (paths.length === 0) return

      const target = resolveTarget(event)
      const effect = dropEffectFor(paths, target, mountPoints, { altKey: event.altKey })
      if (!canDrop(paths, target, effect, sourceDir)) return

      event.preventDefault()
      // A copy into the folder the items came from is Duplicate, so it starts
      // at keep-both rather than asking about a collision that is the point.
      const startPolicy = effect === 'copy' && normalize(sourceDir) === normalize(target)
        ? ('keep-both' as const)
        : ('fail' as const)
      void operations.transfer(paths, target, effect, startPolicy)
    },
    [resolveTarget, mountPoints, operations, end],
  )

  return { onDragOver, onDragLeave, onDrop }
}
