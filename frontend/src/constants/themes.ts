/**
 * The theme preference, as data (PLAN.md §M12).
 *
 * Three values rather than a boolean, because "follow the OS" is a preference
 * in its own right and not a third colour scheme: a user on `system` who
 * switches macOS to light at sunset expects the app to come with them, and
 * storing the *resolved* theme would freeze whichever one they last happened to
 * be in.
 *
 * `system` is resolved in TypeScript — `services/theme` maps it to `light` or
 * `dark` and writes that to `data-theme` — so `theme.css` declares each palette
 * exactly once. It used to be resolved in CSS as well, by a
 * `prefers-color-scheme` copy of the light block, and that copy had already
 * drifted: it was missing every `--ft-*` file-type colour, so a system-light
 * window rendered dark-theme icon colours on a light background.
 */

export type ThemePreference = 'system' | 'light' | 'dark'

/** What the DOM is actually set to; `system` has already been resolved away. */
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeSpec {
  id: ThemePreference
  label: string
}

/** Ordered as the menu renders them: the automatic one, then the two fixed. */
export const THEMES: ThemeSpec[] = [
  { id: 'system', label: 'Match System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

/**
 * Dark, not `system`: the window's native background colour is decided in
 * `main.go` before anything has read this preference, and it is dark. A default
 * of `system` would mean every launch on a light Mac flashed the dark window
 * chrome first.
 */
export const DEFAULT_THEME: ThemePreference = 'dark'

const BY_ID = new Map(THEMES.map((spec) => [spec.id, spec]))

/** The name the menus print. One source, as `splitLabel` is for the layouts. */
export function themeLabel(theme: ThemePreference): string {
  return BY_ID.get(theme)?.label ?? theme
}

/**
 * Guards the value read back from the settings table, for the reason
 * `isHashAlgorithm` does: a database written by a later build can name a theme
 * this one has never heard of, and an unvalidated one would reach `data-theme`
 * and match no palette at all — a window with no colours rather than a wrong
 * one.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && BY_ID.has(value as ThemePreference)
}
