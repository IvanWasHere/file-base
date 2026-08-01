/**
 * Files dragged in from Finder (PLAN.md M9).
 *
 * These drops never reach the DOM. The native layer sits above the webview and
 * intercepts them, so there is no dragover, no drop event and no element under
 * the pointer — only a pair of window coordinates. The target is recovered by
 * hit-testing those coordinates against the same `data-drop-path` attributes
 * the internal drag uses, which is why both paths agree about what a folder is.
 *
 * An external drop always copies. Moving a file out of wherever the user keeps
 * it, because they dragged it into another window, is not something to infer.
 */

import { useEffect } from 'react'
import { bridge } from '@/services/bridge'
import { toast } from '@/stores/toastStore'
import type { FileOperations } from '@/hooks/useFileOperations'

/**
 * The folder at a point on screen: the nearest drop target under the pointer,
 * or null if the drop landed on chrome rather than on a place.
 */
export function dropTargetAt(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y)
  const target = element?.closest('[data-drop-path]')
  return target?.getAttribute('data-drop-path') ?? null
}

export function useExternalDrop(operations: FileOperations): void {
  useEffect(
    () =>
      bridge.desktop.onFileDrop(({ x, y, paths }) => {
        const destination = dropTargetAt(x, y)
        if (!destination) {
          // Dropped on the toolbar, the tab bar or the gap between panes. Saying
          // so is better than silently copying into whichever folder happened to
          // be active.
          toast.info(
            'Nothing was copied',
            'Drop files onto a folder or into a pane to copy them there.',
          )
          return
        }
        void operations.transfer(paths, destination, 'copy')
      }),
    [operations],
  )
}
