/**
 * Reading and writing a theme as a file (PLAN.md §M24).
 *
 * Pure: no bridge, no DOM. `themeFiles.ts` does the I/O, this decides what a
 * blob of text means, which is what makes every rule below directly testable.
 *
 * The format is deliberately small — a name, a mode, and colours:
 *
 *   {
 *     "name": "Ocean",
 *     "mode": "dark",
 *     "author": "you",
 *     "colors": { "accent": "#38bdf8", "bg-deep": "#04121c" }
 *   }
 *
 * A theme may name as few colours as it likes. Anything it leaves out is taken
 * from the built-in theme of the same mode, so "the stock dark theme but with a
 * green accent" is a four-line file rather than a copy of thirty-three values
 * that stops tracking the app the moment a token is added.
 */

import {
  baseThemeFor,
  isThemeTokenId,
  type Theme,
  type ThemeColors,
  type ThemeMode,
} from '@/constants/palette'
import { basename } from '@/utils/path'

/** Themes are small; anything larger is not one and should not be parsed. */
export const MAX_THEME_BYTES = 64 * 1024

/**
 * Values are written into CSS custom properties, so they are checked before
 * they get there.
 *
 * `setProperty` already drops a value the engine cannot parse, which handles
 * nonsense. This handles the rest: `url()` and `image-set()` are the two colour
 * positions that can reach the network, and a theme is a colour list — it has
 * no business fetching anything. The length cap and the brace/semicolon check
 * close off the "value that is really a stylesheet" shape.
 */
const FORBIDDEN = /url\s*\(|image-set\s*\(|[;{}<>]/i

export function isSafeColorValue(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 64 && !FORBIDDEN.test(trimmed)
}

/**
 * A theme's id is its path.
 *
 * Not its name: two people can both call their theme "Ocean", and the id is
 * what the preference stores — a collision would silently switch a user to
 * someone else's palette. The path is already unique and already stable.
 */
export function themeIdForPath(path: string): string {
  return `external:${path}`
}

/** The name shown when the file does not give one: `Ocean.json` → `Ocean`. */
function nameFromPath(path: string): string {
  const name = basename(path)
  return name.toLowerCase().endsWith('.json') ? name.slice(0, -5) : name
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readMode(value: unknown): ThemeMode {
  // Dark rather than "reject": a theme that forgot to say is far more likely to
  // be dark (the app's default) than to be broken, and getting it wrong costs a
  // grouping heading and a `color-scheme`, both of which the user can see.
  return value === 'light' ? 'light' : 'dark'
}

/**
 * Turns a theme file's text into a `Theme`.
 *
 * Never throws. A file that cannot be used comes back carrying its `problem`
 * so Settings can print the reason next to the file's name — the rule a broken
 * custom template follows (§M15 decision 14). The alternative is a list that is
 * quietly one shorter than the folder, which tells the author nothing.
 */
export function parseTheme(text: string, path: string): Theme {
  const fallbackName = nameFromPath(path)
  const broken = (problem: string): Theme => ({
    id: themeIdForPath(path),
    name: fallbackName,
    mode: 'dark',
    colors: baseThemeFor('dark').colors,
    source: 'external',
    path,
    problem,
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return broken('Not valid JSON')
  }

  if (!isRecord(parsed)) return broken('Not a theme — the file must hold an object')
  if (!isRecord(parsed.colors)) return broken('No "colors" object')

  const mode = readMode(parsed.mode)
  const base = baseThemeFor(mode)
  const colors: ThemeColors = { ...base.colors }

  let recognised = 0
  let rejected = 0
  for (const [key, value] of Object.entries(parsed.colors)) {
    // A key this build has never heard of is skipped rather than refused: a
    // theme written for a later version should still work here, minus whatever
    // that version added. The same tolerance `loadSettings` shows a row it does
    // not know.
    if (!isThemeTokenId(key)) continue
    if (!isSafeColorValue(value)) {
      rejected += 1
      continue
    }
    colors[key] = value.trim()
    recognised += 1
  }

  if (recognised === 0) {
    return broken(
      rejected > 0 ? 'Every colour in it was rejected' : 'None of its keys are colour names',
    )
  }

  const name =
    typeof parsed.name === 'string' && parsed.name.trim().length > 0
      ? parsed.name.trim()
      : fallbackName

  return {
    id: themeIdForPath(path),
    name,
    mode,
    colors,
    source: 'external',
    path,
    ...(typeof parsed.author === 'string' && parsed.author.trim().length > 0
      ? { author: parsed.author.trim() }
      : {}),
    // Reported, not fatal: the theme works, and the author should know that
    // three of their lines did nothing.
    ...(rejected > 0
      ? { problem: `${rejected} colour${rejected === 1 ? '' : 's'} could not be used` }
      : {}),
  }
}

/**
 * A theme as the text of a file, ready to be edited by hand.
 *
 * Every token is written out, not just the ones that differ from the base:
 * this is what "Export Current Theme" produces, and its job is to hand someone
 * a complete list of the things they are allowed to change.
 */
export function serialiseTheme(theme: Theme): string {
  return `${JSON.stringify(
    {
      name: theme.name,
      mode: theme.mode,
      ...(theme.author ? { author: theme.author } : {}),
      colors: theme.colors,
    },
    null,
    2,
  )}\n`
}
