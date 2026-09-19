import { useEffect, useRef } from 'react'

/**
 * Scrolls a virtualized listing back to the top when something new is pinned
 * there (§M26).
 *
 * Pinning an arrival to row zero only makes it visible if row zero is. A pane
 * scrolled two hundred rows down would otherwise put the new folder — and the
 * rename editor open on it — exactly as far out of sight as the alphabet did.
 *
 * `key` identifies the arrival, not its position: it changes when a *different*
 * set of items is pinned, and re-renders in between leave the scroll alone, so
 * this cannot fight the user scrolling away from what it just revealed.
 */
export function useRevealTop(key: string | undefined, scrollToTop: () => void): void {
  const revealed = useRef<string | undefined>(undefined)

  // The virtualizer hands back a fresh function every render, so the callback
  // is kept in a ref rather than depended on — depending on it would fire this
  // on renders that had nothing to do with an arrival. Written in an effect
  // rather than during render, which is the only time a ref may be touched.
  const latest = useRef(scrollToTop)
  useEffect(() => {
    latest.current = scrollToTop
  })

  useEffect(() => {
    if (key === undefined) {
      // Forgotten, so the same items pinned again later are revealed again.
      revealed.current = undefined
      return
    }
    if (key === revealed.current) return
    revealed.current = key
    latest.current()
  }, [key])
}
