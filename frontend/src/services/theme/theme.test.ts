import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  isThemePreference,
  migrateThemePreference,
  themeLabel,
} from '@/constants/themes'
import { BUILTIN_THEMES, baseThemeFor, THEME_TOKENS, type Theme } from '@/constants/palette'
import { applyTheme, resolveTheme, startThemeSync, systemPrefersDark } from './theme'
import { usableThemes, useThemeStore } from '@/stores/themeStore'
import { useUiStore } from '@/stores/uiStore'

const DARK = baseThemeFor('dark')
const LIGHT = baseThemeFor('light')

/** The list `startThemeSync` builds, made explicit for the pure resolver tests. */
const INSTALLED = usableThemes([])

/** A theme of the shape the folder produces, without touching the filesystem. */
function externalTheme(id: string, patch: Partial<Theme> = {}): Theme {
  return {
    id,
    name: id,
    mode: 'dark',
    colors: { ...DARK.colors, accent: '#123456' },
    source: 'external',
    path: `/themes/${id}.json`,
    ...patch,
  }
}

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
  useThemeStore.setState({ external: [], loaded: false })
  delete document.documentElement.dataset.theme
  document.documentElement.removeAttribute('style')
})

afterEach(() => {
  stop?.()
  stop = undefined
  removeMatchMedia()
})

describe('resolveTheme', () => {
  it('passes a fixed preference through, whatever the OS says', () => {
    expect(resolveTheme(DARK.id, false, INSTALLED).id).toBe(DARK.id)
    expect(resolveTheme(LIGHT.id, true, INSTALLED).id).toBe(LIGHT.id)
  })

  it('resolves system to the stock theme the OS prefers', () => {
    expect(resolveTheme('system', true, INSTALLED).id).toBe(DARK.id)
    expect(resolveTheme('system', false, INSTALLED).id).toBe(LIGHT.id)
  })

  it('finds a theme that came from a file', () => {
    const mine = externalTheme('external:/themes/ocean.json')
    expect(resolveTheme(mine.id, false, [...INSTALLED, mine]).id).toBe(mine.id)
  })

  /**
   * The day someone deletes the theme file their preference points at. Falling
   * back paints a window that works; leaving the preference alone means putting
   * the file back restores their theme rather than making them pick it again.
   */
  it('falls back to the default when the id names nothing', () => {
    expect(resolveTheme('external:/themes/gone.json', false, INSTALLED).id).toBe(DARK.id)
  })

  // §M24 made the id set unbounded, so this is now the *only* place an
  // unrecognised value is caught — the settings guard cannot do it any more.
  it('never returns undefined, whatever it is given', () => {
    expect(resolveTheme('', true, INSTALLED)).toBeDefined()
    expect(resolveTheme('nonsense', false, INSTALLED)).toBeDefined()
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
    useUiStore.setState({ theme: LIGHT.id })

    stop = startThemeSync()

    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('follows the store', () => {
    stubMatchMedia(false)
    stop = startThemeSync()

    useUiStore.getState().setTheme(LIGHT.id)
    expect(document.documentElement.dataset.theme).toBe('light')

    useUiStore.getState().setTheme(DARK.id)
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
    useUiStore.setState({ theme: DARK.id })
    stop = startThemeSync()

    media.set(true)
    expect(document.documentElement.dataset.theme).toBe('dark')

    media.set(false)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  /**
   * The folder is read after startup, so the theme a user chose last week
   * simply does not exist yet when the window first paints. It has to arrive.
   */
  it('repaints when the themes folder lands and the chosen theme is in it', () => {
    stubMatchMedia(false)
    const mine = externalTheme('external:/themes/ocean.json')
    useUiStore.setState({ theme: mine.id })

    stop = startThemeSync()
    // Not installed yet: the fallback, not a window with no colours.
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(DARK.colors.accent)

    useThemeStore.getState().setExternal([mine])
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#123456')
  })

  it('falls back when the chosen theme is removed from the folder', () => {
    stubMatchMedia(false)
    const mine = externalTheme('external:/themes/ocean.json')
    useUiStore.setState({ theme: mine.id })
    useThemeStore.setState({ external: [mine], loaded: true })

    stop = startThemeSync()
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#123456')

    useThemeStore.getState().setExternal([])
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(DARK.colors.accent)
  })

  // A file that cannot be parsed is listed so its author can see why, but it
  // must never be something the app can end up painting.
  it('will not apply a theme the parser rejected', () => {
    stubMatchMedia(false)
    const bad = externalTheme('external:/themes/bad.json', { problem: 'Not valid JSON' })
    useUiStore.setState({ theme: bad.id })
    useThemeStore.setState({ external: [bad], loaded: true })

    stop = startThemeSync()
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(DARK.colors.accent)
  })

  it('detaches every subscription on teardown', () => {
    const media = stubMatchMedia(false)
    const teardown = startThemeSync()
    teardown()

    expect(media.listeners.size).toBe(0)

    useUiStore.getState().setTheme(LIGHT.id)
    expect(document.documentElement.dataset.theme).toBe('dark')

    useThemeStore.getState().setExternal([externalTheme('external:/themes/ocean.json')])
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
  /**
   * Weaker than it was, deliberately: since §M24 a valid id can be the path of
   * a file that exists on one Mac and not another, so "does this name a theme"
   * cannot be answered here. The shape still can be, and must be — a number
   * reaching `resolveTheme` would be a crash rather than a wrong colour.
   */
  it('accepts any non-empty string and rejects anything that is not one', () => {
    expect(isThemePreference('system')).toBe(true)
    expect(isThemePreference('vault-dark')).toBe(true)
    expect(isThemePreference('external:/themes/ocean.json')).toBe(true)
    expect(isThemePreference('')).toBe(false)
    expect(isThemePreference(undefined)).toBe(false)
    expect(isThemePreference(1)).toBe(false)
    expect(isThemePreference({ id: 'dark' })).toBe(false)
  })
})

describe('the upgrade from the two-palette preference', () => {
  // Without this, everyone who had ever touched the theme menu before §M24
  // would come back from the upgrade on the fallback theme.
  it('maps the old light and dark values onto the stock theme ids', () => {
    expect(migrateThemePreference('light')).toBe(LIGHT.id)
    expect(migrateThemePreference('dark')).toBe(DARK.id)
  })

  it('leaves system and real theme ids alone', () => {
    expect(migrateThemePreference('system')).toBe('system')
    expect(migrateThemePreference('nocturne')).toBe('nocturne')
    expect(migrateThemePreference('external:/themes/ocean.json')).toBe(
      'external:/themes/ocean.json',
    )
  })
})

describe('applyTheme', () => {
  it('writes the mode to data-theme, not the theme id', () => {
    applyTheme(LIGHT)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    applyTheme(DARK)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  // The whole mechanism since §M24: no stylesheet declares a palette, so if a
  // token is not written here it has no value anywhere in the app.
  it('writes every token in the palette as a custom property', () => {
    applyTheme(LIGHT)
    const style = document.documentElement.style
    for (const token of THEME_TOKENS) {
      expect(style.getPropertyValue(`--${token.id}`)).toBe(LIGHT.colors[token.id])
    }
  })

  it('replaces the previous palette rather than merging with it', () => {
    applyTheme(DARK)
    applyTheme(LIGHT)
    expect(document.documentElement.style.getPropertyValue('--bg-deep')).toBe(
      LIGHT.colors['bg-deep'],
    )
  })
})

describe('the built-in themes', () => {
  it('ships five', () => {
    expect(BUILTIN_THEMES).toHaveLength(5)
  })

  // A missing token is a variable with no value, which is an element with no
  // colour rather than a wrong one — and it would only show on the one theme
  // that forgot it.
  it('every one of them names every token', () => {
    for (const theme of BUILTIN_THEMES) {
      for (const token of THEME_TOKENS) {
        expect(theme.colors[token.id], `${theme.id} is missing ${token.id}`).toBeTruthy()
      }
    }
  })

  it('has both modes, and unique ids', () => {
    expect(new Set(BUILTIN_THEMES.map((theme) => theme.id)).size).toBe(BUILTIN_THEMES.length)
    expect(new Set(BUILTIN_THEMES.map((theme) => theme.mode))).toEqual(new Set(['dark', 'light']))
  })
})

describe('themeLabel', () => {
  // The three fixed rows of the View menu, which is not the list of themes:
  // Light and Dark mean *the stock pair*, and the menu is built natively in Go
  // where a sixth theme appearing in a folder cannot reach it.
  it('names the three menu rows', () => {
    expect(themeLabel('system')).toBe('Match System')
    expect(themeLabel(LIGHT.id)).toBe('Light')
    expect(themeLabel(DARK.id)).toBe('Dark')
  })
})
