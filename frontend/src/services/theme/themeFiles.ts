/**
 * The themes folder (PLAN.md §M24).
 *
 * **External themes are files, not rows** — the same call §M15 made for custom
 * file templates, for the same reasons. This is a file explorer; someone who
 * wants their own palette should write a small JSON file and drop it in a
 * folder. That costs no import format, no theme-editor UI and no migration, and
 * the themes are portable, syncable, diffable and shareable for free. Deleting
 * one is deleting a file.
 *
 * Nothing new was needed from Go beyond the folder's *location*, which comes
 * from `StandardPaths` because paths are resolved natively rather than
 * string-built here (PLAN.md §1).
 */

import { type Theme } from '@/constants/palette'
import { bridge } from '@/services/bridge'
import { ensureFolder } from '@/services/filesystem/ensureFolder'
import { MAX_THEME_BYTES, parseTheme, serialiseTheme } from './themeFile'
import { useThemeStore } from '@/stores/themeStore'
import { themeIdForPath } from './themeFile'

/** Creates the themes folder if it is not there. */
export async function ensureThemesFolder(path: string): Promise<void> {
  await ensureFolder(path)
}

function isThemeFile(name: string): boolean {
  return name.toLowerCase().endsWith('.json')
}

/**
 * Reads the themes folder.
 *
 * Never throws, and never lets one bad file cost the others: a folder the user
 * maintains by hand will contain a half-edited theme sooner or later, and the
 * rule that keeps one dangling symlink from making a directory unlistable (§M1)
 * applies just as well here. A file that cannot be used comes back carrying its
 * `problem` so Settings can print the reason.
 */
export async function loadExternalThemes(folder: string): Promise<Theme[]> {
  if (!folder) return []

  let entries
  try {
    entries = await bridge.fs.readDirectory(folder, { includeHidden: false })
  } catch {
    // No folder yet, or unreadable. The five built-ins still work.
    return []
  }

  const themes: Theme[] = []

  for (const entry of entries) {
    if (entry.isDirectory || entry.broken || !isThemeFile(entry.name)) continue

    if (entry.size > MAX_THEME_BYTES) {
      themes.push({
        ...parseTheme('', entry.path),
        problem: 'Too large to be a theme',
      })
      continue
    }

    try {
      const text = await bridge.fs.readTextFile(entry.path, MAX_THEME_BYTES)
      themes.push(parseTheme(text, entry.path))
    } catch {
      themes.push({ ...parseTheme('', entry.path), problem: 'Could not be read' })
    }
  }

  return themes
}

/**
 * Re-reads the folder into the store, creating it first if it is missing.
 *
 * The single entry point: startup calls it, and so does Settings' Reload. It
 * resolves to the list it stored so a caller can report what happened without
 * reading the store back.
 */
export async function refreshExternalThemes(folder: string): Promise<Theme[]> {
  await ensureThemesFolder(folder)
  const themes = await loadExternalThemes(folder)
  useThemeStore.getState().setExternal(themes)
  return themes
}

/**
 * Writes a theme into the folder as a starting point to edit.
 *
 * This is what makes the format discoverable. Nobody should have to read a
 * documentation page to learn the thirty-three token names — they should press
 * a button, get a complete file named after a theme they already like, and
 * change the four lines they care about.
 *
 * The name is made unique by the filesystem rather than by us: `createFile`
 * fails on a collision, and the caller counts up. Returns the new file's path.
 */
export async function exportTheme(folder: string, theme: Theme): Promise<string> {
  await ensureThemesFolder(folder)

  const base = theme.name.replace(/[/:]/g, '-').trim() || 'Theme'
  const content = serialiseTheme({ ...theme, name: `${theme.name} Copy` })

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const name = attempt === 0 ? `${base}.json` : `${base} ${attempt + 1}.json`
    try {
      const created = await bridge.fs.createFile(folder, name, content)
      return created.path
    } catch {
      // Taken. Try the next number — the same shape `nextAvailableName` gives a
      // paste, done against the real filesystem rather than a listing that
      // could be stale by the time the write lands.
    }
  }

  throw new Error('Could not find an unused name in the themes folder')
}

/** The id an exported theme will have, so the caller can select it after a reload. */
export function idForExported(path: string): string {
  return themeIdForPath(path)
}
