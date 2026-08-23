/**
 * §M24: the themes folder — a folder of files the user maintains by hand.
 *
 * The rules it inherits from the templates folder (§M15) are the point: one bad
 * file must never cost the others, a file that cannot be used is *listed* with
 * its reason rather than skipped, and a missing folder is a normal state on a
 * fresh install rather than an error.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { baseThemeFor } from '@/constants/palette'
import { bridge } from '@/services/bridge'
import { serialiseTheme } from './themeFile'
import { exportTheme, loadExternalThemes, refreshExternalThemes } from './themeFiles'
import { useThemeStore } from '@/stores/themeStore'

const FOLDER = '/Users/dev/Library/Application Support/MacFileExplorer/Themes'
const DARK = baseThemeFor('dark')

const write = (name: string, body: unknown) =>
  bridge.fs.createFile(FOLDER, name, typeof body === 'string' ? body : JSON.stringify(body))

// The mock filesystem is reset globally in test/setup.ts; the store is not.
beforeEach(async () => {
  useThemeStore.setState({ external: [], loaded: false })
  await refreshExternalThemes(FOLDER)
})

describe('the themes folder', () => {
  it('is created, parents and all, the first time it is looked at', async () => {
    expect(await bridge.fs.exists(FOLDER)).toBe(true)
  })

  it('starts empty, and that is not an error', async () => {
    expect(await loadExternalThemes(FOLDER)).toEqual([])
  })

  it('reads a theme dropped into it', async () => {
    await write('Ocean.json', { name: 'Ocean', mode: 'dark', colors: { accent: '#38bdf8' } })

    const themes = await loadExternalThemes(FOLDER)
    expect(themes).toHaveLength(1)
    expect(themes[0]?.name).toBe('Ocean')
    expect(themes[0]?.colors.accent).toBe('#38bdf8')
  })

  // The folder is a folder; people keep notes and screenshots in them.
  it('ignores anything that is not a .json file', async () => {
    await write('Ocean.json', { colors: { accent: '#38bdf8' } })
    await write('notes.txt', 'ideas for later')
    await bridge.fs.createFolder(FOLDER, 'archive')

    expect(await loadExternalThemes(FOLDER)).toHaveLength(1)
  })

  /**
   * The §M1 rule — one dangling symlink must not make a directory unlistable —
   * applied to a folder someone edits by hand at midnight.
   */
  it('lists a broken theme with its reason instead of losing the good ones', async () => {
    await write('Ocean.json', { name: 'Ocean', colors: { accent: '#38bdf8' } })
    await write('Broken.json', '{ half an edit')

    const themes = await loadExternalThemes(FOLDER)
    expect(themes).toHaveLength(2)
    expect(themes.find((theme) => theme.name === 'Ocean')?.problem).toBeUndefined()
    expect(themes.find((theme) => theme.name === 'Broken')?.problem).toBe('Not valid JSON')
  })

  it('answers with the built-ins alone when the folder cannot be read', async () => {
    expect(await loadExternalThemes('/nowhere/at/all')).toEqual([])
    expect(await loadExternalThemes('')).toEqual([])
  })

  it('publishes what it read to the store', async () => {
    await write('Ocean.json', { name: 'Ocean', colors: { accent: '#38bdf8' } })

    await refreshExternalThemes(FOLDER)

    expect(useThemeStore.getState().loaded).toBe(true)
    expect(useThemeStore.getState().external.map((theme) => theme.name)).toEqual(['Ocean'])
  })
})

describe('exporting a theme to edit', () => {
  it('writes a complete file that parses back', async () => {
    const path = await exportTheme(FOLDER, DARK)

    const themes = await loadExternalThemes(FOLDER)
    const exported = themes.find((theme) => theme.path === path)
    expect(exported?.problem).toBeUndefined()
    expect(exported?.colors).toEqual(DARK.colors)
  })

  // Named after the theme it came from, so the folder is browsable — but the
  // *theme* name says Copy, so the list does not show two "Vault Dark"s.
  it('names the copy after its source without colliding with it', async () => {
    const first = await exportTheme(FOLDER, DARK)
    const second = await exportTheme(FOLDER, DARK)

    expect(first).toBe(`${FOLDER}/Vault Dark.json`)
    expect(second).toBe(`${FOLDER}/Vault Dark 2.json`)
    expect((await loadExternalThemes(FOLDER))[0]?.name).toBe('Vault Dark Copy')
  })

  it('creates the folder first if someone deleted it', async () => {
    await bridge.fs.delete([FOLDER])

    await exportTheme(FOLDER, DARK)
    expect(await bridge.fs.exists(FOLDER)).toBe(true)
  })

  it('will not overwrite a theme already sitting in the folder', async () => {
    await write('Vault Dark.json', serialiseTheme({ ...DARK, name: 'Mine' }))

    await exportTheme(FOLDER, DARK)

    const themes = await loadExternalThemes(FOLDER)
    expect(themes.find((theme) => theme.path === `${FOLDER}/Vault Dark.json`)?.name).toBe('Mine')
  })
})
