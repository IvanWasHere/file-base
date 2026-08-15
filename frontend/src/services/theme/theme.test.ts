import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_THEME, isThemePreference, themeLabel } from '@/constants/themes'
import { applyTheme, resolveTheme, startThemeSync, systemPrefersDark } from './theme'
import { useUiStore } from '@/stores/uiStore'

/**
 * jsdom has no `matchMedia`, so the OS preference is stubbed. The listeners are
 * held so a test can fire a change the way macOS does at sunset.
 */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  const list = {
    matches,
    addEventListener: (_: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => void listeners.delete(listener),
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => list,
  })
  return {
    listeners,
    /** Switches the OS preference and notifies, as a real change event does. */
    set(next: boolean) {
      list.matches = next
      for (const listener of listeners) listener()
    },
  }
}

function removeMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: undefined,
  })
}

let stop: (() => void) | undefined

beforeEach(() => {
  useUiStore.setState({ theme: DEFAULT_THEME })
  delete document.documentElement.dataset.theme
})

afterEach(() => {
  stop?.()
  stop = undefined
  removeMatchMedia()
})

describe('resolveTheme', () => {
  it('passes a fixed preference through, whatever the OS says', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('resolves system to what the OS prefers', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('systemPrefersDark', () => {
  it('reads the media query', () => {
    stubMatchMedia(true)
    expect(systemPrefersDark()).toBe(true)
    stubMatchMedia(false)
    expect(systemPrefersDark()).toBe(false)
  })

  it('answers false where matchMedia does not exist rather than throwing', () => {
    removeMatchMedia()
    expect(systemPrefersDark()).toBe(false)
  })
})

describe('startThemeSync', () => {
  it('applies the current preference immediately, before anything changes', () => {
    stubMatchMedia(false)
    useUiStore.setState({ theme: 'light' })

    stop = startThemeSync()

    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('follows the store', () => {
    stubMatchMedia(false)
    stop = startThemeSync()

    useUiStore.getState().setTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    useUiStore.getState().setTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  // The point of keeping `system` as a stored value rather than resolving it
  // once at startup: the window has to come with the OS.
  it('follows the OS while the preference is system', () => {
    const media = stubMatchMedia(false)
    useUiStore.setState({ theme: 'system' })
    stop = startThemeSync()
    expect(document.documentElement.dataset.theme).toBe('light')

    media.set(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('ignores the OS while the preference is fixed', () => {
    const media = stubMatchMedia(false)
    useUiStore.setState({ theme: 'dark' })
    stop = startThemeSync()

    media.set(true)
    expect(document.documentElement.dataset.theme).toBe('dark')

    media.set(false)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('detaches both subscriptions on teardown', () => {
    const media = stubMatchMedia(false)
    const teardown = startThemeSync()
    teardown()

    expect(media.listeners.size).toBe(0)

    useUiStore.getState().setTheme('light')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('starts without a matchMedia at all', () => {
    removeMatchMedia()
    useUiStore.setState({ theme: 'system' })

    stop = startThemeSync()

    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('the preference guard', () => {
  it('accepts the three real values and nothing else', () => {
    expect(isThemePreference('system')).toBe(true)
    expect(isThemePreference('light')).toBe(true)
    expect(isThemePreference('dark')).toBe(true)
    // What a later build could have written into the settings table.
    expect(isThemePreference('solarized')).toBe(false)
    expect(isThemePreference(undefined)).toBe(false)
    expect(isThemePreference(1)).toBe(false)
  })
})

describe('applyTheme', () => {
  it('writes the resolved theme and nothing else', () => {
    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('themeLabel', () => {
  it('names every preference', () => {
    expect(themeLabel('system')).toBe('Match System')
    expect(themeLabel('light')).toBe('Light')
    expect(themeLabel('dark')).toBe('Dark')
  })
})
