/**
 * Lazily requests a thumbnail once its tile is actually on screen.
 *
 * Virtualization already limits rendering to the visible window, but the
 * overscan means tiles mount before they are seen, and a fast scroll mounts and
 * unmounts hundreds. An IntersectionObserver is the difference between
 * rendering what the user looked at and rendering everything they flew past.
 */

import { useEffect, useRef, useState } from 'react'
import { getThumbnail, isRenderable, THUMB_SIZE } from '@/services/thumbs/thumbCache'
import type { FileItem } from '@/types/file'

/**
 * One observer for the whole app rather than one per tile: a thousand observers
 * each watching a single element costs far more than one watching a thousand.
 */
let observer: IntersectionObserver | null = null
const visible = new WeakMap<Element, () => void>()

function observe(element: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    // jsdom, and any environment without one: treat everything as visible
    // rather than never loading a thumbnail at all.
    onVisible()
    return () => {}
  }

  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const callback = visible.get(entry.target)
        if (callback) {
          // One shot: a thumbnail does not need re-requesting when the tile
          // scrolls back into view, and the cache would answer instantly anyway.
          observer?.unobserve(entry.target)
          visible.delete(entry.target)
          callback()
        }
      }
    },
    // A margin so a tile is requested just before it is scrolled to, which
    // hides the render behind the scroll.
    { rootMargin: '200px' },
  )

  visible.set(element, onVisible)
  observer.observe(element)

  return () => {
    observer?.unobserve(element)
    visible.delete(element)
  }
}

/**
 * Returns the tile's ref and the thumbnail URL once it has been rendered.
 * `null` means "use the icon" — which is the answer for most files.
 */
export function useThumbnail(item: FileItem, size: number = THUMB_SIZE) {
  const ref = useRef<HTMLDivElement>(null)
  // Stored with the file it belongs to, not reset by an effect. Virtualized
  // tiles are recycled onto different files, and clearing in an effect would
  // leave one frame showing the previous file's image.
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null)

  // `modifiedAt` is part of the identity on purpose: an edited image is a
  // different thumbnail, and the watcher will have refreshed the item by then.
  const identity = `${size}:${item.path}:${item.modifiedAt}`
  const url = loaded?.key === identity ? loaded.url : null

  useEffect(() => {
    if (!isRenderable(item)) return

    const element = ref.current
    if (!element) return

    let live = true
    const stop = observe(element, () => {
      void getThumbnail(item, size).then((result) => {
        if (live && result) setLoaded({ key: identity, url: result })
      })
    })

    return () => {
      live = false
      stop()
    }
  }, [item, identity, size])

  return { ref, url }
}
