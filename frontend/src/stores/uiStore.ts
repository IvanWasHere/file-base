/**
 * Chrome-level UI state that is not navigation and not selection: panel
 * visibility, the show-hidden-files toggle, the modal dialog, the open context
 * menu, and which item is being renamed in place.
 *
 * M5 persists the toggles to SQLite; M12 folds the theme in.
 */

import { create } from 'zustand'
import type { ContextKind } from '@/constants/contextMenus'
import { DEFAULT_ALGORITHM, type HashAlgorithm } from '@/constants/hashAlgorithms'
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

export type DialogRequest = ConfirmRequest | ConflictRequest

/** What the user chose. `null` means the dialog was dismissed. */
type DialogResult = boolean | ConflictPolicy | null

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

interface UiState {
  previewOpen: boolean
  sidebarOpen: boolean
  showHiddenFiles: boolean
  dialog: DialogRequest | null
  hashJob: HashJob | null
  /** Persisted: whoever verifies SHA-256 downloads verifies SHA-256 downloads. */
  hashAlgorithm: HashAlgorithm
  renaming: RenameTarget | null
  contextMenu: ContextMenuRequest | null

  togglePreview: () => void
  setPreviewOpen: (open: boolean) => void
  toggleSidebar: () => void
  toggleHiddenFiles: () => void

  openHashes: (paths: string[]) => void
  closeHashes: () => void
  setHashAlgorithm: (algorithm: HashAlgorithm) => void

  beginRename: (paneId: string, path: string) => void
  endRename: () => void

  openContextMenu: (request: ContextMenuRequest) => void
  closeContextMenu: () => void

  /** Resolves true when confirmed, false when dismissed. */
  askConfirm: (request: Omit<ConfirmRequest, 'kind'>) => Promise<boolean>
  /** Resolves to the chosen policy, or null when dismissed. */
  askConflict: (request: Omit<ConflictRequest, 'kind'>) => Promise<ConflictPolicy | null>
  resolveDialog: (value: DialogResult) => void
}

export const useUiStore = create<UiState>()((set) => ({
  previewOpen: false,
  sidebarOpen: true,
  showHiddenFiles: false,
  dialog: null,
  hashJob: null,
  hashAlgorithm: DEFAULT_ALGORITHM,
  renaming: null,
  contextMenu: null,

  togglePreview: () => set((state) => ({ previewOpen: !state.previewOpen })),
  setPreviewOpen: (open) => set({ previewOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleHiddenFiles: () => set((state) => ({ showHiddenFiles: !state.showHiddenFiles })),

  // Opening with nothing to hash would be a modal that can only be closed.
  openHashes: (paths) => set(paths.length > 0 ? { hashJob: { paths }, renaming: null } : {}),
  closeHashes: () => set({ hashJob: null }),
  setHashAlgorithm: (algorithm) => set({ hashAlgorithm: algorithm }),

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
      pendingResolve = (value) => resolve(typeof value === 'string' ? value : null)
      set({ dialog: { ...request, kind: 'conflict' } })
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
