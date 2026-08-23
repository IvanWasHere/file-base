/**
 * Puts the chosen theme on the document (PLAN.md §M12, §M24).
 *
 * The one place `data-theme` and the palette's custom properties are written.
 * Components never read the theme — every colour they use is a CSS variable, so
 * swapping those variables is the whole mechanism — and nothing outside this
 * file needs to know that `system` is not a palette.
 *
 * Three things can change what is displayed, and all three route through
 * `apply`: the user picking a theme, macOS switching appearance under a running
 * window while the preference is `system`, and the themes folder being re-read
 * (which can make the user's chosen theme appear, or disappear).
 */

import {
  cssVariables,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  type Theme,
} from '@/constants/palette'
import { SYSTEM_THEME, type ThemePreference } from '@/constants/themes'
import { useThemeStore, usableThemes } from '@/stores/themeStore'
import { useUiStore } from '@/stores/uiStore'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Absent in jsdom, so it is guarded rather than assumed. Falling back to `false`
 * makes `system` mean light there, which is a choice tests make explicitly by
 * installing a stub.
 */
function darkQuery(): MediaQueryList | undefined {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : undefined
}

export function systemPrefersDark(): boolean {
  return darkQuery()?.matches ?? false
}

/**
 * Turns a preference into the theme to paint.
 *
 * Two fallbacks, and neither is an error case:
 *
 *  - `system` names no theme, so the stock light or dark one is used depending
 *    on the OS. Someone who wants the OS to choose between two *other* themes
 *    picks one of them explicitly; "follow macOS" means the app's own pair.
 *  - An id that names nothing is what a user sees the day they delete the theme
 *    file their preference points at. Falling back to the default paints a
 *    window that works; the preference is left alone, so putting the file back
 *    restores their theme rather than making them pick it again.
 */
export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
  themes: Theme[],
): Theme {
  const byId = (id: string): Theme | undefined => themes.find((theme) => theme.id === id)

  if (preference !== SYSTEM_THEME) {
    const chosen = byId(preference)
    if (chosen) return chosen
  }

  const wantDark = preference === SYSTEM_THEME ? prefersDark : true
  const fallback = byId(wantDark ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID)
  // Non-null in practice: `usableThemes` always starts with the built-ins. The
  // guard is for a caller that passed a hand-built list, which the tests do.
  return fallback ?? (themes[0] as Theme)
}

/**
 * Writes a palette onto the document.
 *
 * Inline custom properties rather than a class or a stylesheet block, because
 * an external theme has no stylesheet: it is thirty-three strings that arrived
 * as JSON a moment ago, and the only way they become CSS is this.
 *
 * `data-theme` still carries the *mode*, not the theme id — `theme.css` keys
 * `color-scheme` off it, which is what flips native scrollbars and the caret,
 * and it is what tests written before §M24 assert on.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.dataset.theme = theme.mode
  for (const [name, value] of cssVariables(theme.colors)) {
    root.style.setProperty(name, value)
  }
}

/**
 * Applies the current preference and keeps it applied. Returns a teardown.
 *
 * Applies once on start rather than waiting for a change, so the order against
 * hydration does not matter: started first, it paints the default and the
 * stored value arrives as a change; started after, the stored value is already
 * in the store and is what it paints.
 */
export function startThemeSync(): () => void {
  const apply = (): void => {
    const themes = usableThemes(useThemeStore.getState().external)
    applyTheme(resolveTheme(useUiStore.getState().theme, systemPrefersDark(), themes))
  }

  apply()

  const unsubscribeUi = useUiStore.subscribe((state, previous) => {
    if (state.theme !== previous.theme) apply()
  })

  // Re-read the folder and the chosen theme may have just appeared, changed, or
  // gone. Cheap to re-apply and wrong to skip.
  const unsubscribeThemes = useThemeStore.subscribe((state, previous) => {
    if (state.external !== previous.external) apply()
  })

  // Listened to whatever the preference is: it costs nothing while the
  // preference is fixed, and re-subscribing on every change to `system` would
  // be a second thing to get wrong for no gain.
  const media = darkQuery()
  media?.addEventListener('change', apply)

  return () => {
    unsubscribeUi()
    unsubscribeThemes()
    media?.removeEventListener('change', apply)
  }
}
