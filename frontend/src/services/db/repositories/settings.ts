/**
 * Settings as a typed key-value store.
 *
 * Values are JSON so booleans and objects survive the round trip — SQLite would
 * otherwise turn `false` into `0` and lose the distinction from `"0"`.
 */

import { bridge } from '@/services/bridge'
import {
  DEFAULT_ALGORITHM,
  isHashAlgorithm,
  type HashAlgorithm,
} from '@/constants/hashAlgorithms'
import {
  DEFAULT_THEME,
  isThemePreference,
  migrateThemePreference,
  type ThemePreference,
} from '@/constants/themes'
import { DEFAULT_LAYOUT, normaliseLayout, type ColumnLayout } from '@/constants/columns'
import { CONTEXT_COMMANDS } from '@/constants/contextMenus'
import { isMenuCommandId, type MenuCommandId } from '@/constants/menus'

export interface AppSettings {
  showHiddenFiles: boolean
  foldersFirst: boolean
  theme: ThemePreference
  confirmBeforeDelete: boolean
  sidebarOpen: boolean
  previewOpen: boolean
  hashAlgorithm: HashAlgorithm
  /**
   * The template last used, by id. Empty means none — the dialog then starts on
   * whatever the typed name implies, which is usually nothing.
   *
   * Only the id is stored, never the content: a built-in's content belongs to
   * the build, and a custom one's belongs to its file.
   */
  lastTemplate: string
  /** The detail view's column order, widths and which are shown (§M19, §M22). */
  columnLayout: ColumnLayout
  /** The context-menu rows this user switched off in Settings (§M22). */
  hiddenContextCommands: MenuCommandId[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  showHiddenFiles: false,
  foldersFirst: true,
  theme: DEFAULT_THEME,
  confirmBeforeDelete: true,
  sidebarOpen: true,
  previewOpen: false,
  hashAlgorithm: DEFAULT_ALGORITHM,
  lastTemplate: '',
  columnLayout: DEFAULT_LAYOUT,
  hiddenContextCommands: [],
}

export async function loadSettings(): Promise<AppSettings> {
  const rows = await bridge.db.query<{ key: string; value: string }>(
    'select key, value from settings',
  )

  const stored: Record<string, unknown> = {}
  for (const row of rows) {
    // Keys the current build no longer knows about are ignored, so a
    // downgrade cannot inject unexpected fields into settings.
    if (!(row.key in DEFAULT_SETTINGS)) continue
    try {
      stored[row.key] = JSON.parse(row.value) as unknown
    } catch {
      // A corrupt value falls back to its default rather than failing startup.
    }
  }

  // The enum is validated on the way out, the way M13 learned a persisted view
  // mode has to be: a database written by a later build can name an algorithm
  // this one has never heard of, and the backend rejects an unknown one
  // outright — so the modal would open on a job that can never start.
  if (!isHashAlgorithm(stored.hashAlgorithm)) delete stored.hashAlgorithm
  // The theme is checked for *shape* only since §M24: a valid id can name a
  // theme file that exists on one Mac and not another, so "does this name a
  // theme" is answered where the installed themes are known and falls back to
  // the default there. A number or an object, though, must never reach it.
  if (!isThemePreference(stored.theme)) {
    delete stored.theme
  } else {
    // `light` and `dark` were the two palettes before §M24 and are now the ids
    // of the two stock themes. Without this, everyone who had ever touched the
    // theme menu would come back from the upgrade on the fallback.
    stored.theme = migrateThemePreference(stored.theme)
  }
  // A template id points at something that may no longer exist — a custom file
  // the user deleted, a built-in a later build renamed. The dialog resolves it
  // against the list it actually has and falls back to none, so only the type
  // needs guarding here.
  if (typeof stored.lastTemplate !== 'string') delete stored.lastTemplate
  // Repaired rather than validated: a column layout has parts that can each be
  // wrong on their own — an unknown id, a missing one, weights that sum to
  // anything — and dropping the whole row for one bad field would throw away a
  // layout the user built. `normaliseLayout` keeps what it can (§M19).
  if ('columnLayout' in stored) stored.columnLayout = normaliseLayout(stored.columnLayout)
  // Filtered rather than validated wholesale, for the reason the layout beside
  // it is repaired: an id this build no longer has would hide nothing, and an
  // id that is not in a context menu at all would be a stored preference about
  // a row that does not exist. Both are dropped and the rest is kept (§M22).
  if ('hiddenContextCommands' in stored) {
    stored.hiddenContextCommands = Array.isArray(stored.hiddenContextCommands)
      ? stored.hiddenContextCommands.filter(
          (id): id is MenuCommandId => isMenuCommandId(id) && CONTEXT_COMMANDS.includes(id),
        )
      : []
  }

  return { ...DEFAULT_SETTINGS, ...stored }
}

export async function saveSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  await bridge.db.exec(
    'insert into settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
    [key, JSON.stringify(value)],
  )
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const entries = Object.entries(settings)
  if (entries.length === 0) return

  await bridge.db.transaction(
    entries.map(([key, value]) => ({
      sql: 'insert into settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
      args: [key, JSON.stringify(value)],
    })),
  )
}
