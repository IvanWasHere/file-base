/**
 * Chrome-level UI state that is not navigation and not selection: panel
 * visibility, the show-hidden-files toggle, the theme, the modal dialog, the
 * open context menu, and which item is being renamed in place.
 *
 * M5 persists the toggles to SQLite; M12 folded the theme in.
 */

import { create } from 'zustand'
import type { ContextKind } from '@/constants/contextMenus'
import type { MenuCommandId } from '@/constants/menus'
import { DEFAULT_LAYOUT, setColumnVisible, type ColumnId, type ColumnLayout } from '@/constants/columns'
import { DEFAULT_ALGORITHM, type HashAlgorithm } from '@/constants/hashAlgorithms'
import { DEFAULT_THEME, type ThemePreference } from '@/constants/themes'
import type { ConflictPolicy } from '@/types/file'

export interface ConfirmRequest {
  kind: 'confirm'
  title: string
  message: string
  detail?: string
  confirmLabel: string
  /** Renders the confirm button in the danger colour and never auto-focuses it. */
  destructive: boolean
}

export interface ConflictRequest {
  kind: 'conflict'
  operation: 'copy' | 'move'
  /** Bare names, not paths — the dialog is about what the user can see. */
  names: string[]
}

/**
 * An archive asking for its password (PLAN.md §M18 decision 18).
 *
 * Unlike M14's hash modal and M15's new-file dialog, this genuinely *is* a
 * one-shot question with a promise waiting on the answer — which is exactly
 * what this stack already is. It needed a variant, not a field of its own.
 */
export interface PasswordRequest {
  kind: 'password'
  /** The archive's name, so the prompt says what it is asking about. */
  name: string
  /** A second ask after a wrong one, which should say so rather than repeat. */
  retry: boolean
}

export type DialogRequest = ConfirmRequest | ConflictRequest | PasswordRequest

/**
 * What the user chose. `null` means the dialog was dismissed.
 *
 * The string covers two unrelated answers — a `ConflictPolicy` and a typed
 * password — which is why each `ask*` narrows the shared result to its own
 * shape before resolving. Spelling `ConflictPolicy` out here as well would be
 * redundant with `string` and would not make the narrowing any safer.
 */
type DialogResult = boolean | string | null

/**
 * The resolver lives outside the store because it is a one-shot continuation,
 * not state: it has no meaningful previous value, nothing should re-render when
 * it changes, and keeping the store plain data leaves it comparable and
 * serialisable.
 */
let pendingResolve: ((value: DialogResult) => void) | null = null

/** Which item is showing its inline rename editor, if any. */
export interface RenameTarget {
  paneId: string
  path: string
}

/**
 * The open context menu.
 *
 * Plain data — a position and what was under the pointer — for the same reason
 * the dialog resolver above lives outside the store: keeping handlers out leaves
 * this comparable, serialisable, and cheap to re-render on. The host builds the
 * actual items from `kind` and the active pane's selection, which the right-click
 * has already set (right-clicking an unselected item selects it first, as in
 * Finder), so the menu needs to carry no target of its own.
 */
export interface ContextMenuRequest {
  kind: ContextKind
  /** Viewport coordinates of the click. */
  x: number
  y: number
}

/**
 * The open hash modal, and the paths it was opened on (PLAN.md M14).
 *
 * A field of its own rather than a `DialogRequest`: `dialog` is a one-shot
 * question with a promise waiting on the answer, and this is a long-lived view
 * with internal state that resolves nothing. Routing it through `askConfirm`'s
 * machinery would mean a dialog settling a promise nobody awaited.
 *
 * The paths are the selection as it was when the modal opened — folders and all.
 * Filtering them is the modal's job, because deciding what is a folder means
 * stat'ing them, and it reports how many it dropped.
 */
export interface HashJob {
  paths: string[]
}

/**
 * The open new-file dialog, and where it will create (PLAN.md §M15).
 *
 * Its own field rather than a `DialogRequest`, for the reason `hashJob` has
 * one: `DialogResult` is `boolean | ConflictPolicy | null`, and this resolves a
 * name and a template. Widening that union so every existing dialog's result
 * type is looser, for one caller's benefit, is the wrong trade (decision 12).
 */
/** The open compress dialog, and what it will put in the archive (§M18). */
export interface CompressRequest {
  /** The selection at the moment it opened. */
  sources: string[]
  /** Where the archive will be written — the pane's folder. */
  parent: string
}

export interface NewFileRequest {
  /** The folder to create in — the pane's, at the moment it was opened. */
  parent: string
  /** So the created file can be selected and put straight into rename. */
  paneId: string
}

/**
 * The open tag picker, and what it will tag (§M22).
 *
 * Its own field rather than a `DialogRequest`, for the reason `hashJob` and
 * `newFile` have one: `DialogResult` settles a promise, and this resolves a set
 * of tags written to disk with nothing awaiting them.
 */
export interface TagsJob {
  /** The selection as it was when the picker opened. */
  paths: string[]
}

interface UiState {
  previewOpen: boolean
  sidebarOpen: boolean
  showHiddenFiles: boolean
  dialog: DialogRequest | null
  hashJob: HashJob | null
  newFile: NewFileRequest | null
  compress: CompressRequest | null
  tagsJob: TagsJob | null
  /** Whether the Settings modal is open (§M22). */
  settingsOpen: boolean
  /**
   * Persisted. Held here rather than read from the DOM: `system` is a real
   * value the menu has to be able to show a checkmark against, and
   * `data-theme` only ever carries the resolved one (§M12).
   */
  theme: ThemePreference
  /** Persisted: whoever verifies SHA-256 downloads verifies SHA-256 downloads. */
  hashAlgorithm: HashAlgorithm
  /** Persisted: the template id last used, so the next file starts there. */
  lastTemplate: string
  /**
   * Persisted, and global rather than per folder (§M19 decision 10): `viewMode`
   * and `sort` are about a folder's contents, but how wide Size is is about how
   * this user reads a table — Downloads laid out differently from Documents
   * would read as a bug.
   *
   * Replaced wholesale rather than mutated, so `order` stays a stable reference
   * for the memoised rows that receive it.
   */
  columnLayout: ColumnLayout
  /**
   * Persisted: the context-menu rows this user has switched off (§M22).
   *
   * Stored as what is *hidden* rather than what is shown, so a command added by
   * a later build appears for everyone rather than being invisible to anyone
   * who has ever opened Settings — the same reasoning `columnLayout.hidden`
   * follows one field above.
   */
  hiddenContextCommands: MenuCommandId[]
  renaming: RenameTarget | null
  contextMenu: ContextMenuRequest | null

  togglePreview: () => void
  setPreviewOpen: (open: boolean) => void
  toggleSidebar: () => void
  toggleHiddenFiles: () => void
  setTheme: (theme: ThemePreference) => void
  setColumnLayout: (layout: ColumnLayout) => void
  setColumnVisible: (id: ColumnId, visible: boolean) => void
  resetColumns: () => void
  setContextCommandVisible: (id: MenuCommandId, visible: boolean) => void

  openSettings: () => void
  closeSettings: () => void

  openTags: (paths: string[]) => void
  closeTags: () => void

  openHashes: (paths: string[]) => void
  closeHashes: () => void

  openNewFile: (parent: string, paneId: string) => void
  closeNewFile: () => void

  openCompress: (sources: string[], parent: string) => void
  closeCompress: () => void
  setHashAlgorithm: (algorithm: HashAlgorithm) => void
  setLastTemplate: (id: string) => void

  beginRename: (paneId: string, path: string) => void
  endRename: () => void

  openContextMenu: (request: ContextMenuRequest) => void
  closeContextMenu: () => void

  /** Resolves true when confirmed, false when dismissed. */
  askConfirm: (request: Omit<ConfirmRequest, 'kind'>) => Promise<boolean>
  /** Resolves to the chosen policy, or null when dismissed. */
  askConflict: (request: Omit<ConflictRequest, 'kind'>) => Promise<ConflictPolicy | null>
  /** Resolves to the password typed, or null when dismissed. */
  askPassword: (request: Omit<PasswordRequest, 'kind'>) => Promise<string | null>
  resolveDialog: (value: DialogResult) => void
}

export const useUiStore = create<UiState>()((set) => ({
  previewOpen: false,
  sidebarOpen: true,
  showHiddenFiles: false,
  dialog: null,
  hashJob: null,
  newFile: null,
  compress: null,
  tagsJob: null,
  settingsOpen: false,
  theme: DEFAULT_THEME,
  columnLayout: DEFAULT_LAYOUT,
  hiddenContextCommands: [],
  hashAlgorithm: DEFAULT_ALGORITHM,
  lastTemplate: '',
  renaming: null,
  contextMenu: null,

  togglePreview: () => set((state) => ({ previewOpen: !state.previewOpen })),
  setPreviewOpen: (open) => set({ previewOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleHiddenFiles: () => set((state) => ({ showHiddenFiles: !state.showHiddenFiles })),
  // Nothing here touches the DOM: `services/theme` subscribes and owns
  // `data-theme`, so the store stays plain data (§M12).
  setTheme: (theme) => set({ theme }),
  setColumnLayout: (columnLayout) => set({ columnLayout }),
  // The rebalancing lives in the registry, not here: what a column is worth
  // when it comes back is a property of the layout, and a store that spread the
  // arithmetic across its actions would be a second place that decides it.
  setColumnVisible: (id, visible) =>
    set((state) => ({ columnLayout: setColumnVisible(state.columnLayout, id, visible) })),
  setContextCommandVisible: (id, visible) =>
    set((state) => ({
      hiddenContextCommands: visible
        ? state.hiddenContextCommands.filter((entry) => entry !== id)
        : state.hiddenContextCommands.includes(id)
          ? state.hiddenContextCommands
          : [...state.hiddenContextCommands, id],
    })),
  // Its own action rather than `setColumnLayout(DEFAULT_LAYOUT)` at the call
  // site: the default belongs to the registry, and a caller reaching for it
  // would be a second place that decides what "reset" means.
  resetColumns: () => set({ columnLayout: DEFAULT_LAYOUT }),

  // Opening with nothing to hash would be a modal that can only be closed.
  openHashes: (paths) => set(paths.length > 0 ? { hashJob: { paths }, renaming: null } : {}),
  closeHashes: () => set({ hashJob: null }),

  // A rename editor and a dialog cannot both own the keyboard, and the dialog
  // is the thing the user just asked for.
  openNewFile: (parent, paneId) => set({ newFile: { parent, paneId }, renaming: null }),
  closeNewFile: () => set({ newFile: null }),

  // Nothing to compress would be a dialog that can only be cancelled.
  openCompress: (sources, parent) =>
    set(sources.length > 0 ? { compress: { sources, parent }, renaming: null } : {}),
  closeCompress: () => set({ compress: null }),

  // Settings is the one modal here with no target at all — it is about the
  // application, not about what is selected — so it does not guard on anything.
  openSettings: () => set({ settingsOpen: true, renaming: null }),
  closeSettings: () => set({ settingsOpen: false }),

  // Nothing to tag would be a picker whose every toggle wrote to no files.
  openTags: (paths) => set(paths.length > 0 ? { tagsJob: { paths }, renaming: null } : {}),
  closeTags: () => set({ tagsJob: null }),
  setHashAlgorithm: (algorithm) => set({ hashAlgorithm: algorithm }),
  setLastTemplate: (id) => set({ lastTemplate: id }),

  beginRename: (paneId, path) => set({ renaming: { paneId, path } }),
  endRename: () => set({ renaming: null }),

  // A rename editor and a context menu cannot both own the keyboard, and the
  // menu is the thing the user just asked for.
  openContextMenu: (request) => set({ contextMenu: request, renaming: null }),
  closeContextMenu: () => set({ contextMenu: null }),

  // Each request narrows the shared result to its own type, so a dialog that is
  // dismissed — or replaced by another — resolves to a meaningful "no" rather
  // than leaking a null into a boolean.
  askConfirm: (request) =>
    new Promise<boolean>((resolve) => {
      settlePending(null)
      pendingResolve = (value) => resolve(value === true)
      set({ dialog: { ...request, kind: 'confirm' } })
    }),

  askConflict: (request) =>
    new Promise<ConflictPolicy | null>((resolve) => {
      settlePending(null)
      // Narrowed against the policy union: `askPassword` also resolves a
      // string, and without this a dismissed password prompt could leak into a
      // conflict awaiting a policy.
      pendingResolve = (value) =>
        resolve(
          value === 'replace' || value === 'skip' || value === 'keep-both' || value === 'fail'
            ? value
            : null,
        )
      set({ dialog: { ...request, kind: 'conflict' } })
    }),

  askPassword: (request) =>
    new Promise<string | null>((resolve) => {
      settlePending(null)
      // An empty string is a real answer here — someone pressing Enter on a
      // blank field — so only `null` means dismissed.
      pendingResolve = (value) => resolve(typeof value === 'string' ? value : null)
      set({ dialog: { ...request, kind: 'password' } })
    }),

  resolveDialog: (value) => {
    set({ dialog: null })
    settlePending(value)
  },
}))

/**
 * Settles whatever promise is outstanding before another dialog replaces it.
 * Without this, a second request would strand the first `await` forever and the
 * operation behind it would never finish or fail.
 */
function settlePending(value: DialogResult): void {
  const resolve = pendingResolve
  pendingResolve = null
  resolve?.(value)
}
