/**
 * §M24: what a theme file is allowed to be, and what happens when it is not.
 *
 * The parser is the only thing standing between a file someone downloaded and
 * the app's stylesheet, so every rule it enforces is pinned here.
 */

import { describe, expect, it } from 'vitest'
import { baseThemeFor, THEME_TOKENS } from '@/constants/palette'
import { isSafeColorValue, parseTheme, serialiseTheme, themeIdForPath } from './themeFile'

const PATH = '/Users/dev/Library/Application Support/MacFileExplorer/Themes/Ocean.json'
const DARK = baseThemeFor('dark')
const LIGHT = baseThemeFor('light')

const file = (value: unknown) => JSON.stringify(value)

describe('parseTheme', () => {
  it('reads a complete theme', () => {
    const theme = parseTheme(
      file({ name: 'Ocean', mode: 'dark', author: 'dev', colors: { accent: '#38bdf8' } }),
      PATH,
    )

    expect(theme.problem).toBeUndefined()
    expect(theme.name).toBe('Ocean')
    expect(theme.mode).toBe('dark')
    expect(theme.author).toBe('dev')
    expect(theme.colors.accent).toBe('#38bdf8')
    expect(theme.source).toBe('external')
    expect(theme.path).toBe(PATH)
  })

  /**
   * The point of the format: "the stock dark theme but with a green accent" is
   * a four-line file, not a copy of thirty-three values that stops tracking the
   * app the moment a token is added.
   */
  it('fills everything the file leaves out from the stock theme of its mode', () => {
    const theme = parseTheme(file({ mode: 'light', colors: { accent: '#008080' } }), PATH)

    expect(theme.colors.accent).toBe('#008080')
    for (const token of THEME_TOKENS) {
      if (token.id === 'accent') continue
      expect(theme.colors[token.id]).toBe(LIGHT.colors[token.id])
    }
  })

  it('names the theme after its file when the file does not', () => {
    expect(parseTheme(file({ colors: { accent: '#fff' } }), PATH).name).toBe('Ocean')
  })

  // Two people will both call their theme "Ocean", and the id is what the
  // preference stores — a name collision would silently switch a user to
  // somebody else's palette.
  it('identifies a theme by its path, not its name', () => {
    const a = parseTheme(file({ name: 'Ocean', colors: { accent: '#fff' } }), '/themes/a.json')
    const b = parseTheme(file({ name: 'Ocean', colors: { accent: '#000' } }), '/themes/b.json')
    expect(a.id).not.toBe(b.id)
    expect(a.id).toBe(themeIdForPath('/themes/a.json'))
  })

  it('defaults to dark when the mode is missing or nonsense', () => {
    expect(parseTheme(file({ colors: { accent: '#fff' } }), PATH).mode).toBe('dark')
    expect(parseTheme(file({ mode: 'beige', colors: { accent: '#fff' } }), PATH).mode).toBe('dark')
  })

  // A theme written for a later build should still work here, minus whatever
  // that build added — the tolerance `loadSettings` shows a row it does not know.
  it('ignores colour names it has never heard of', () => {
    const theme = parseTheme(
      file({ colors: { accent: '#38bdf8', 'bg-hologram': '#ff00ff' } }),
      PATH,
    )
    expect(theme.problem).toBeUndefined()
    expect(theme.colors.accent).toBe('#38bdf8')
  })

  describe('files that cannot be used', () => {
    // Carried, never thrown: a list that is quietly one shorter than the folder
    // tells the author nothing (§M15 decision 14).
    it('reports invalid JSON rather than throwing', () => {
      expect(parseTheme('{ not json', PATH).problem).toBe('Not valid JSON')
    })

    it('reports a file that is not an object', () => {
      expect(parseTheme('[1, 2, 3]', PATH).problem).toBeDefined()
      expect(parseTheme('"a string"', PATH).problem).toBeDefined()
    })

    it('reports a file with no colors object', () => {
      expect(parseTheme(file({ name: 'Ocean' }), PATH).problem).toBe('No "colors" object')
    })

    it('reports a colors object with nothing recognisable in it', () => {
      expect(parseTheme(file({ colors: { hue: 'blue' } }), PATH).problem).toBeDefined()
    })

    // Still usable — the theme works and the author should know three of their
    // lines did nothing.
    it('keeps a theme whose colours were only partly rejected, and says so', () => {
      const theme = parseTheme(
        file({ colors: { accent: '#38bdf8', danger: 'red; background: url(http://x)' } }),
        PATH,
      )
      expect(theme.colors.accent).toBe('#38bdf8')
      expect(theme.colors.danger).toBe(DARK.colors.danger)
      expect(theme.problem).toBe('1 colour could not be used')
    })

    it('falls back to a usable palette even for a file it rejected outright', () => {
      const theme = parseTheme('nonsense', PATH)
      for (const token of THEME_TOKENS) expect(theme.colors[token.id]).toBeTruthy()
    })
  })
})

/**
 * Values go straight into CSS custom properties, so they are checked first.
 *
 * `setProperty` already drops what the engine cannot parse; this is about the
 * values it *can* — `url()` is the one colour position that reaches the network,
 * and a colour list has no business fetching anything.
 */
describe('isSafeColorValue', () => {
  it('accepts the notations a theme is actually written in', () => {
    for (const value of [
      '#fff',
      '#38bdf8',
      'rgba(0, 0, 0, 0.5)',
      'hsl(210 100% 50%)',
      'transparent',
      'color-mix(in srgb, red 20%, transparent)',
    ]) {
      expect(isSafeColorValue(value), value).toBe(true)
    }
  })

  it('rejects anything that could fetch, escape the declaration, or is not a string', () => {
    for (const value of [
      'url(https://example.com/x.png)',
      'image-set("a.png" 1x)',
      'red; background: black',
      '} body {',
      '',
      '   ',
      '#'.repeat(200),
    ]) {
      expect(isSafeColorValue(value), String(value)).toBe(false)
    }
    expect(isSafeColorValue(null)).toBe(false)
    expect(isSafeColorValue(16711680)).toBe(false)
  })
})

describe('serialiseTheme', () => {
  // This is what "Export Current Theme" writes, and its job is to hand someone
  // the complete list of things they are allowed to change.
  it('writes every token out, not just the ones that differ from the base', () => {
    const parsed: unknown = JSON.parse(serialiseTheme(DARK))
    const colors = (parsed as { colors: Record<string, string> }).colors
    expect(Object.keys(colors)).toHaveLength(THEME_TOKENS.length)
  })

  it('round-trips through the parser unchanged', () => {
    const theme = parseTheme(serialiseTheme(LIGHT), PATH)
    expect(theme.problem).toBeUndefined()
    expect(theme.mode).toBe('light')
    expect(theme.colors).toEqual(LIGHT.colors)
  })
})
