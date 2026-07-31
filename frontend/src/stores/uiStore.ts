/**
 * Chrome-level UI state that is not navigation and not selection: panel
 * visibility, the show-hidden-files toggle, the modal dialog, and which item is
 * being renamed in place.
 *
 * M5 persists the toggles to SQLite; M12 folds the theme in.
 */

import { create } from 'zustand'
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

interface UiState {
  previewOpen: boolean
  sidebarOpen: boolean
  showHiddenFiles: boolean
  dialog: DialogRequest | null
  renaming: RenameTarget | null

  togglePreview: () => void
  setPreviewOpen: (open: boolean) => void
  toggleSidebar: () => void
  toggleHiddenFiles: () => void

  beginRename: (paneId: string, path: string) => void
  endRename: () => void

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
  renaming: null,

  togglePreview: () => set((state) => ({ previewOpen: !state.previewOpen })),
  setPreviewOpen: (open) => set({ previewOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleHiddenFiles: () => set((state) => ({ showHiddenFiles: !state.showHiddenFiles })),

  beginRename: (paneId, path) => set({ renaming: { paneId, path } }),
  endRename: () => set({ renaming: null }),

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
