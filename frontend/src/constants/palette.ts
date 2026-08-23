/**
 * Every colour in the application (PLAN.md §M24).
 *
 * This is the *only* file in the app that contains a literal colour. Nothing
 * else — no component, no stylesheet — may write a hex, an `rgb()` or a colour
 * keyword, because the moment one does, that pixel stops following the theme
 * and a user-supplied palette can no longer reach it. `theme.css` derives a few
 * tokens from the ones declared here; it declares none of its own.
 *
 * A theme is *only* colours. It cannot change a font, a size, a radius or a
 * layout, which is what makes an external one safe to load from a file the user
 * dropped in a folder: the worst a malformed theme can do is look wrong.
 *
 * The one deliberate exception is `constants/tags.ts`, and it is documented
 * there: a Finder tag colour is a fact about the file on disk, not a part of
 * this app's palette, and Finder's red has to stay Finder's red in every theme.
 */

/**
 * Token ids are the CSS custom property names without the `--`.
 *
 * That is not a shortcut, it is the contract: an external theme's JSON keys are
 * these strings, so someone reading the app's CSS in a devtools inspector
 * already knows what to write in their file.
 */
export const THEME_TOKENS = [
  // Surfaces, from the window's deepest background up to the most elevated
  // floating panel. Every background in the app is one of these six.
  { id: 'bg-deep', label: 'Window background', group: 'Surfaces' },
  { id: 'bg-base', label: 'Pane background', group: 'Surfaces' },
  { id: 'bg-surface', label: 'Sidebar & bars', group: 'Surfaces' },
  { id: 'bg-elevated', label: 'Menus & dialogs', group: 'Surfaces' },
  { id: 'bg-hover', label: 'Hovered row', group: 'Surfaces' },
  { id: 'bg-active', label: 'Selected row', group: 'Surfaces' },

  { id: 'border', label: 'Divider', group: 'Lines' },
  { id: 'border-subtle', label: 'Faint divider', group: 'Lines' },
  { id: 'border-focus', label: 'Focus ring', group: 'Lines' },

  { id: 'text-primary', label: 'Text', group: 'Text' },
  { id: 'text-secondary', label: 'Secondary text', group: 'Text' },
  { id: 'text-muted', label: 'Muted text', group: 'Text' },

  { id: 'accent', label: 'Accent', group: 'Accent' },
  { id: 'accent-dim', label: 'Accent, pressed', group: 'Accent' },
  // What is legible *on top of* a filled accent or danger button. Its own token
  // because it is not a shade of either: an amber accent needs near-black on it
  // and a deep blue one needs white, and no formula picks that reliably.
  { id: 'on-accent', label: 'Text on accent', group: 'Accent' },
  { id: 'on-danger', label: 'Text on danger', group: 'Accent' },

  { id: 'danger', label: 'Danger', group: 'Status' },
  { id: 'success', label: 'Success', group: 'Status' },
  { id: 'info', label: 'Information', group: 'Status' },

  // File-type categories — see utils/fileCategory.ts. The tinted backgrounds
  // behind icons (`--ft-bg-*`) are derived from these in theme.css, so a theme
  // sets eight colours here and gets sixteen.
  { id: 'ft-folder', label: 'Folders', group: 'File types' },
  { id: 'ft-image', label: 'Images', group: 'File types' },
  { id: 'ft-document', label: 'Documents', group: 'File types' },
  { id: 'ft-code', label: 'Code', group: 'File types' },
  { id: 'ft-music', label: 'Audio', group: 'File types' },
  { id: 'ft-video', label: 'Video', group: 'File types' },
  { id: 'ft-archive', label: 'Archives', group: 'File types' },
  { id: 'ft-data', label: 'Data', group: 'File types' },
  { id: 'ft-default', label: 'Everything else', group: 'File types' },

  // The wash a modal draws over the window behind it.
  { id: 'overlay', label: 'Dialog backdrop', group: 'Chrome' },
  // The plate behind a caption printed over a photo. Separate from `overlay`
  // because it sits on someone's image rather than on the app, and a light
  // theme that lightens its dialog backdrop still needs this one dark.
  { id: 'scrim', label: 'Caption over media', group: 'Chrome' },
  { id: 'grid-dot', label: 'Empty-pane grid', group: 'Chrome' },
  // The colour a floating panel's shadow is cast in; the offsets and blur are
  // fixed in theme.css, because those are layout and a theme is only colour.
  { id: 'shadow-color', label: 'Menu shadow', group: 'Chrome' },
] as const satisfies readonly { id: string; label: string; group: string }[]

export type ThemeToken = (typeof THEME_TOKENS)[number]
export type ThemeTokenId = ThemeToken['id']

/** A complete palette. Every token, no gaps — see `completePalette`. */
export type ThemeColors = Record<ThemeTokenId, string>

/**
 * Whether a theme is a light or a dark one.
 *
 * Not decoration: it drives `color-scheme` (which is what makes native
 * scrollbars, form controls and the caret flip), it decides which theme
 * "Match System" reaches for, and it groups the list in Settings.
 */
export type ThemeMode = 'light' | 'dark'

export interface Theme {
  /** Stable across launches — it is what the theme preference stores. */
  id: string
  name: string
  mode: ThemeMode
  author?: string
  colors: ThemeColors
  source: 'builtin' | 'external'
  /** Where an external theme was read from. Absent for the built-ins. */
  path?: string
  /**
   * Why an external theme cannot be used, if it cannot.
   *
   * Carried rather than thrown, for the reason a broken custom template is
   * (§M15 decision 14): a file the user maintains by hand will sometimes be
   * wrong, and a list that is quietly one shorter gives them nothing to fix.
   */
  problem?: string
}

const TOKEN_IDS = THEME_TOKENS.map((token) => token.id)

export function isThemeTokenId(value: unknown): value is ThemeTokenId {
  return typeof value === 'string' && (TOKEN_IDS as string[]).includes(value)
}

/** The custom properties a palette becomes, ready to write onto an element. */
export function cssVariables(colors: ThemeColors): [string, string][] {
  return TOKEN_IDS.map((id) => [`--${id}`, colors[id]])
}

/* ------------------------------------------------------------------ *
 * The built-in themes.
 *
 * Five, spanning the two things a palette can be picked for: three darks and
 * two lights. Vault Dark and Vault Light are the originals ported from the
 * mockup and stay first, because they are what the window's native background
 * colour in main.go is matched to.
 * ------------------------------------------------------------------ */

const VAULT_DARK: ThemeColors = {
  'bg-deep': '#0e0e12',
  'bg-base': '#141419',
  'bg-surface': '#1a1a22',
  'bg-elevated': '#22222e',
  'bg-hover': '#2a2a38',
  'bg-active': '#32324a',

  border: '#2c2c3c',
  'border-subtle': 'rgba(44, 44, 60, 0.4)',
  'border-focus': '#e8a830',

  'text-primary': '#e2e2ea',
  'text-secondary': '#8a8a9e',
  'text-muted': '#5a5a72',

  accent: '#e8a830',
  'accent-dim': '#c48820',
  'on-accent': '#1a1206',
  'on-danger': '#ffffff',

  danger: '#e84848',
  success: '#38c868',
  info: '#48a8e8',

  'ft-folder': '#e8a830',
  'ft-image': '#e86898',
  'ft-document': '#4898e8',
  'ft-code': '#38c868',
  'ft-music': '#c848e8',
  'ft-video': '#e85848',
  'ft-archive': '#e89848',
  'ft-data': '#48c8c8',
  'ft-default': '#5a5a72',

  overlay: 'rgba(0, 0, 0, 0.5)',
  scrim: 'rgba(0, 0, 0, 0.7)',
  'grid-dot': 'rgba(255, 255, 255, 0.015)',
  'shadow-color': 'rgba(0, 0, 0, 0.4)',
}

const VAULT_LIGHT: ThemeColors = {
  'bg-deep': '#e8e8ec',
  'bg-base': '#f4f4f6',
  'bg-surface': '#ffffff',
  'bg-elevated': '#ffffff',
  'bg-hover': '#eaeaef',
  'bg-active': '#dcdce6',

  border: '#d8d8e0',
  'border-subtle': 'rgba(216, 216, 224, 0.6)',
  'border-focus': '#c48820',

  'text-primary': '#1a1a22',
  'text-secondary': '#5a5a72',
  'text-muted': '#8a8a9e',

  accent: '#b8781c',
  'accent-dim': '#9a6415',
  'on-accent': '#ffffff',
  'on-danger': '#ffffff',

  danger: '#c62828',
  success: '#1f8a48',
  info: '#1a72b8',

  'ft-folder': '#b8781c',
  'ft-image': '#c2447a',
  'ft-document': '#1a72b8',
  'ft-code': '#1f8a48',
  'ft-music': '#9a2fb8',
  'ft-video': '#c23a2c',
  'ft-archive': '#b8701c',
  'ft-data': '#1f9a9a',
  'ft-default': '#8a8a9e',

  overlay: 'rgba(0, 0, 0, 0.5)',
  scrim: 'rgba(0, 0, 0, 0.7)',
  'grid-dot': 'rgba(0, 0, 0, 0.03)',
  'shadow-color': 'rgba(0, 0, 0, 0.14)',
}

/** Deep indigo with a cyan accent — the coldest of the three darks. */
const NOCTURNE: ThemeColors = {
  'bg-deep': '#0a0e1a',
  'bg-base': '#0f1424',
  'bg-surface': '#151b2e',
  'bg-elevated': '#1c2440',
  'bg-hover': '#232d4e',
  'bg-active': '#2c3860',

  border: '#263056',
  'border-subtle': 'rgba(38, 48, 86, 0.45)',
  'border-focus': '#56d4dd',

  'text-primary': '#dde4f5',
  'text-secondary': '#8b95b8',
  'text-muted': '#5b6488',

  accent: '#56d4dd',
  'accent-dim': '#38a9b2',
  'on-accent': '#04121a',
  'on-danger': '#ffffff',

  danger: '#ff6b81',
  success: '#4ade80',
  info: '#7aa2f7',

  'ft-folder': '#56d4dd',
  'ft-image': '#f78bc0',
  'ft-document': '#7aa2f7',
  'ft-code': '#4ade80',
  'ft-music': '#bb9af7',
  'ft-video': '#ff7a6b',
  'ft-archive': '#ffb86c',
  'ft-data': '#2dd4bf',
  'ft-default': '#5b6488',

  overlay: 'rgba(4, 7, 16, 0.6)',
  scrim: 'rgba(4, 7, 16, 0.72)',
  'grid-dot': 'rgba(160, 190, 255, 0.02)',
  'shadow-color': 'rgba(0, 0, 0, 0.5)',
}

/** Neutral greys with a blue accent, for people who want no hue in the chrome. */
const GRAPHITE: ThemeColors = {
  'bg-deep': '#111113',
  'bg-base': '#17171a',
  'bg-surface': '#1d1d21',
  'bg-elevated': '#26262b',
  'bg-hover': '#2f2f36',
  'bg-active': '#3a3a43',

  border: '#33333b',
  'border-subtle': 'rgba(51, 51, 59, 0.45)',
  'border-focus': '#6ba4ff',

  'text-primary': '#e6e6e9',
  'text-secondary': '#9a9aa4',
  'text-muted': '#6a6a76',

  accent: '#6ba4ff',
  'accent-dim': '#4a80d8',
  'on-accent': '#0b1626',
  'on-danger': '#ffffff',

  danger: '#ef5350',
  success: '#4caf7d',
  info: '#42a5f5',

  'ft-folder': '#6ba4ff',
  'ft-image': '#e879a8',
  'ft-document': '#64b5f6',
  'ft-code': '#66bb6a',
  'ft-music': '#ab7df8',
  'ft-video': '#ef6c5a',
  'ft-archive': '#ffa726',
  'ft-data': '#4dd0c4',
  'ft-default': '#6a6a76',

  overlay: 'rgba(0, 0, 0, 0.55)',
  scrim: 'rgba(0, 0, 0, 0.68)',
  'grid-dot': 'rgba(255, 255, 255, 0.018)',
  'shadow-color': 'rgba(0, 0, 0, 0.45)',
}

/** Warm paper and terracotta — a light theme that is not white. */
const PARCHMENT: ThemeColors = {
  'bg-deep': '#e7e0d3',
  'bg-base': '#f3ede1',
  'bg-surface': '#fbf7ee',
  'bg-elevated': '#fffdf7',
  'bg-hover': '#ece4d4',
  'bg-active': '#ddd2bc',

  border: '#d8cdb8',
  'border-subtle': 'rgba(216, 205, 184, 0.6)',
  'border-focus': '#b5622f',

  'text-primary': '#2f2a22',
  'text-secondary': '#6b6154',
  'text-muted': '#948a79',

  accent: '#b5622f',
  'accent-dim': '#8f4c23',
  'on-accent': '#fffdf7',
  'on-danger': '#fffdf7',

  danger: '#b3261e',
  success: '#3f7d3a',
  info: '#2b6ca3',

  'ft-folder': '#b5622f',
  'ft-image': '#a8437a',
  'ft-document': '#2b6ca3',
  'ft-code': '#3f7d3a',
  'ft-music': '#7c4bab',
  'ft-video': '#b0392b',
  'ft-archive': '#a4701c',
  'ft-data': '#1f8080',
  'ft-default': '#948a79',

  overlay: 'rgba(47, 42, 34, 0.35)',
  scrim: 'rgba(47, 42, 34, 0.62)',
  'grid-dot': 'rgba(47, 42, 34, 0.035)',
  'shadow-color': 'rgba(47, 42, 34, 0.18)',
}

export const BUILTIN_THEMES: Theme[] = [
  { id: 'vault-dark', name: 'Vault Dark', mode: 'dark', colors: VAULT_DARK, source: 'builtin' },
  { id: 'vault-light', name: 'Vault Light', mode: 'light', colors: VAULT_LIGHT, source: 'builtin' },
  { id: 'nocturne', name: 'Nocturne', mode: 'dark', colors: NOCTURNE, source: 'builtin' },
  { id: 'graphite', name: 'Graphite', mode: 'dark', colors: GRAPHITE, source: 'builtin' },
  { id: 'parchment', name: 'Parchment', mode: 'light', colors: PARCHMENT, source: 'builtin' },
]

/**
 * What `system` resolves to, and what an unknown id falls back to.
 *
 * Dark is the default for the reason it always was: `BackgroundColour` in
 * main.go is chosen before the frontend exists, and it is `--bg-deep` of this
 * palette. Changing one without the other makes every launch flash.
 */
export const DEFAULT_DARK_THEME_ID = 'vault-dark'
export const DEFAULT_LIGHT_THEME_ID = 'vault-light'

const BUILTIN_BY_ID = new Map(BUILTIN_THEMES.map((theme) => [theme.id, theme]))

/** The base a partial external theme inherits from — see `parseTheme`. */
export function baseThemeFor(mode: ThemeMode): Theme {
  return BUILTIN_BY_ID.get(
    mode === 'light' ? DEFAULT_LIGHT_THEME_ID : DEFAULT_DARK_THEME_ID,
  ) as Theme
}
