import { useEffect, type RefObject } from 'react'

/**
 * Takes keyboard focus back when nothing else holds it.
 *
 * Navigating into a folder swaps the listing for a loading state, and an empty
 * folder renders no grid at all — both unmount the element that had focus.
 * Focus then falls to `document.body`, where arrow keys, type-ahead and every
 * operation shortcut do nothing until the user clicks. That has been true since
 * the views were virtualized; it only became visible once Cmd+V had something
 * to do.
 *
 * The guard is what keeps this from being a focus thief: if anything else is
 * focused — the sidebar, a dialog, a rename editor, another pane — this does
 * nothing at all.
 */
export function useReclaimFocus(ref: RefObject<HTMLElement | null>, ready: boolean): void {
  useEffect(() => {
    if (!ready) return

    const element = ref.current
    if (!element) return

    const active = document.activeElement
    if (active && active !== document.body) return

    // preventScroll: the virtualizer owns the scroll position, and focusing
    // would otherwise jump the list back to the top.
    element.focus({ preventScroll: true })
  }, [ref, ready])
}
