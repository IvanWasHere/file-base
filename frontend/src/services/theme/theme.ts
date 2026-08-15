/**
 * Puts the theme preference on the document (PLAN.md §M12).
 *
 * The one place `data-theme` is written. Components never read the theme —
 * every colour they use is a CSS variable, so swapping the attribute is the
 * whole mechanism — and nothing outside this file needs to know that `system`
 * is not a palette.
 *
 * Two things can change what is displayed, and both route through `apply`:
 * the user picking a theme, and — while the preference is `system` — macOS
 * switching appearance under a running window.
 */

import { type ResolvedTheme, type ThemePreference } from '@/constants/themes'
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

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference !== 'system') return preference
  return prefersDark ? 'dark' : 'light'
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme
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
    applyTheme(resolveTheme(useUiStore.getState().theme, systemPrefersDark()))
  }

  apply()

  const unsubscribe = useUiStore.subscribe((state, previous) => {
    if (state.theme !== previous.theme) apply()
  })

  // Listened to whatever the preference is: it costs nothing while the
  // preference is fixed, and re-subscribing on every change to `system` would
  // be a second thing to get wrong for no gain.
  const media = darkQuery()
  media?.addEventListener('change', apply)

  return () => {
    unsubscribe()
    media?.removeEventListener('change', apply)
  }
}
