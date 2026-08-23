/**
 * The sections of the Settings modal, as data (PLAN.md §M22, §M24).
 *
 * Its own file rather than a constant inside `SettingsModal.tsx` because since
 * §M24 something outside the modal needs to name one: View ▸ Theme ▸ More
 * Themes… opens Settings *on Themes*, and `uiStore` holds which section that
 * is. A store importing a component to get at a union would have the dependency
 * arrow pointing the wrong way.
 */

export const SETTINGS_SECTIONS = [
  {
    id: 'themes',
    label: 'Themes',
    hint: 'Every colour in the app comes from the theme. Add your own by dropping a file in the themes folder.',
  },
  {
    id: 'columns',
    label: 'Columns',
    hint: 'What the details view shows for each file.',
  },
  {
    id: 'context',
    label: 'Right-click Menu',
    hint: 'Which commands the context menus offer.',
  },
] as const satisfies readonly { id: string; label: string; hint: string }[]

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id']

/** Where File ▸ Settings… lands, which is the first row. */
export const DEFAULT_SETTINGS_SECTION: SettingsSection = SETTINGS_SECTIONS[0].id
