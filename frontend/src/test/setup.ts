import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { __resetMockFilesystem } from '@/services/bridge/impl/mock'
import { resetMockDatabase } from '@/services/bridge/impl/mockDb'
import { __resetFolderPrefsCache } from '@/services/db/persistence'

/**
 * jsdom reports every element as 0×0 and has no ResizeObserver. Virtualized
 * lists ask "how tall is the viewport?" before deciding what to render, so
 * without these stubs `@tanstack/react-virtual` renders zero rows and every
 * view test fails for a reason that has nothing to do with the app.
 *
 * The stubs give the scroll container a realistic viewport (1000×800) so the
 * virtualizer produces a sensible window. Grid column counts in tests follow
 * from this width.
 */

const VIEWPORT_WIDTH = 1000
const VIEWPORT_HEIGHT = 800

class ResizeObserverStub implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    // Report the stub viewport once, synchronously enough for effects to see it.
    this.callback(
      [
        {
          target,
          contentRect: target.getBoundingClientRect(),
        } as ResizeObserverEntry,
      ],
      this,
    )
  }

  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  // The mock SQLite database and filesystem are module-level state, so without
  // this a session saved — or a folder trashed — by one test would carry into
  // the next.
  resetMockDatabase()
  __resetMockFilesystem()
  __resetFolderPrefsCache()

  globalThis.ResizeObserver = ResizeObserverStub

  Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element): DOMRect {
    const width = VIEWPORT_WIDTH
    const height = VIEWPORT_HEIGHT
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }
  }

  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    value: VIEWPORT_WIDTH,
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: VIEWPORT_HEIGHT,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    value: VIEWPORT_WIDTH,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    value: VIEWPORT_HEIGHT,
  })

  // react-virtual schedules measurement through rAF.
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0)
  globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle)
})

afterEach(() => {
  cleanup()
})
