/**
 * §M26: pinning an arrival to row zero only helps if row zero is on screen.
 *
 * Tested here rather than through the chrome because jsdom gives every element
 * zero height, so a virtualized listing never scrolls in a layout test and the
 * one thing worth asserting — that it was *asked* to — is invisible there.
 */

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRevealTop } from './useRevealTop'

describe('useRevealTop', () => {
  it('scrolls when a set of items is first pinned', () => {
    const scroll = vi.fn()
    renderHook(({ key }) => useRevealTop(key, scroll), {
      initialProps: { key: undefined as string | undefined },
    }).rerender({ key: 'a\nb' })

    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('does not scroll again on an unrelated re-render', () => {
    const scroll = vi.fn()
    const { rerender } = renderHook(({ key }) => useRevealTop(key, scroll), {
      initialProps: { key: 'a\nb' },
    })
    expect(scroll).toHaveBeenCalledTimes(1)

    // The virtualizer hands back a new callback every render, and the listing
    // re-renders on every scroll — so this is the case that would fight the
    // user scrolling away from what was just revealed.
    rerender({ key: 'a\nb' })
    rerender({ key: 'a\nb' })
    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('scrolls again for a different arrival', () => {
    const scroll = vi.fn()
    const { rerender } = renderHook(({ key }) => useRevealTop(key, scroll), {
      initialProps: { key: 'a' },
    })

    rerender({ key: 'b' })
    expect(scroll).toHaveBeenCalledTimes(2)
  })

  it('reveals the same items again after the pin has been dropped', () => {
    const scroll = vi.fn()
    const { rerender } = renderHook(({ key }) => useRevealTop(key, scroll), {
      initialProps: { key: undefined as string | undefined },
    })

    // Pasting the same file twice is two arrivals, and the second deserves the
    // same reveal as the first.
    rerender({ key: 'a' })
    rerender({ key: undefined })
    rerender({ key: 'a' })
    expect(scroll).toHaveBeenCalledTimes(2)
  })

  it('does nothing while nothing is pinned', () => {
    const scroll = vi.fn()
    const { rerender } = renderHook(({ key }) => useRevealTop(key, scroll), {
      initialProps: { key: undefined as string | undefined },
    })

    rerender({ key: undefined })
    expect(scroll).not.toHaveBeenCalled()
  })
})
