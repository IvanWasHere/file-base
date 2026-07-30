/**
 * Settings as a typed key-value store.
 *
 * Values are JSON so booleans and objects survive the round trip — SQLite would
 * otherwise turn `false` into `0` and lose the distinction from `"0"`.
 */

import { bridge } from '@/services/bridge'

export interface AppSettings {
  showHiddenFiles: boolean
  foldersFirst: boolean
  theme: 'system' | 'dark' | 'light'
  confirmBeforeDelete: boolean
  sidebarOpen: boolean
  previewOpen: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  showHiddenFiles: false,
  foldersFirst: true,
  theme: 'dark',
  confirmBeforeDelete: true,
  sidebarOpen: true,
  previewOpen: false,
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
