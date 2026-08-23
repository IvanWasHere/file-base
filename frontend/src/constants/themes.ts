/**
 * The theme *preference*, as data (PLAN.md §M12, extended in §M24).
 *
 * The colours themselves live in `constants/palette.ts` — this file is only
 * about which theme is wanted, which is a different question with different
 * answers. In particular it has one answer that is not a palette at all:
 *
 *   `system` — follow the OS. A preference in its own right and not a third
 *   colour scheme: a user on `system` who switches macOS to light at sunset
 *   expects the app to come with them, and storing the *resolved* theme would
 *   freeze whichever one they last happened to be in.
 *
 * `system` is resolved in `services/theme`, which maps it to a real theme and
 * writes that theme's colours to the document. No stylesheet declares a palette,
 * so there is nowhere for a second, drifting copy of one to live.
 */

import {
  BUILTIN_THEMES,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  type Theme,
} from '@/constants/palette'

/** The preference value meaning "whatever the OS is set to". */
export const SYSTEM_THEME = 'system'

/**
 * `system`, or the id of a theme.
 *
 * A bare `string` rather than a union, because since §M24 the set of valid ids
 * is not knowable at compile time: an external theme's id comes from the path
 * of a file the user dropped in a folder. What used to be enforced by the type
 * is enforced at the point of use instead — `resolveTheme` falls back to the
 * default when an id names nothing, which is also what happens when the user
 * deletes the theme file their preference points at.
 */
export type ThemePreference = string

/**
 * Dark, not `system`: the window's native background colour is decided in
 * `main.go` before anything has read this preference, and it is dark. A default
 * of `system` would mean every launch on a light Mac flashed the dark window
 * chrome first.
 */
export const DEFAULT_THEME: ThemePreference = DEFAULT_DARK_THEME_ID

/**
 * The three rows the View ▸ Theme menu has, and what they mean.
 *
 * The menu stays fixed at three while Settings lists every theme installed,
 * because the menu bar is built natively in Go (`backend/appmenu`) and cannot
 * be rebuilt when a file appears in a folder. "Light" and "Dark" therefore mean
 * *the stock light and dark themes*, not "any light theme" — and View ▸ Theme ▸
 * More Themes… opens the list that does know about the rest.
 */
export const MENU_THEMES = {
  system: SYSTEM_THEME,
  light: DEFAULT_LIGHT_THEME_ID,
  dark: DEFAULT_DARK_THEME_ID,
} as const

const MENU_LABELS: Record<string, string> = {
  [SYSTEM_THEME]: 'Match System',
  [DEFAULT_LIGHT_THEME_ID]: 'Light',
  [DEFAULT_DARK_THEME_ID]: 'Dark',
}

/**
 * The name a menu row prints.
 *
 * Deliberately not the theme's own name: the row means "the stock dark theme",
 * and a menu that read "Vault Dark" beside "Match System" would look like a
 * list of two themes chosen at random out of five. `backend/appmenu` prints the
 * same three strings — they are duplicated there and that file says so.
 */
export function themeLabel(preference: ThemePreference): string {
  return MENU_LABELS[preference] ?? preference
}

/**
 * Guards the value read back from the settings table.
 *
 * Weaker than it was, and it has to be: before §M24 the valid ids were three
 * literals and could be checked here, and now one of them can be a path that
 * exists only on this Mac. What it still catches is the shape — a number, a
 * null, an object — reaching `resolveTheme`. An id that names no installed
 * theme is a normal, expected state (the user deleted the file), not corruption,
 * and is handled where the themes are actually known.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && value.length > 0
}

/**
 * Brings a pre-§M24 preference forward.
 *
 * `light` and `dark` were the two palettes; they are now the ids of the two
 * stock themes. Without this, everyone who had ever touched the theme menu
 * would come back from the upgrade on the fallback theme.
 */
export function migrateThemePreference(preference: ThemePreference): ThemePreference {
  if (preference === 'light') return DEFAULT_LIGHT_THEME_ID
  if (preference === 'dark') return DEFAULT_DARK_THEME_ID
  return preference
}

/** The built-ins, which are the themes available before any file is read. */
export function builtinThemes(): Theme[] {
  return BUILTIN_THEMES
}
