/**
 * Chrome-level UI state that is not navigation and not selection: panel
 * visibility and the show-hidden-files toggle.
 *
 * M5 persists these to SQLite; M12 folds the theme in.
 */

import { create } from 'zustand'

interface UiState {
  previewOpen: boolean
  sidebarOpen: boolean
  showHiddenFiles: boolean

  togglePreview: () => void
  setPreviewOpen: (open: boolean) => void
  toggleSidebar: () => void
  toggleHiddenFiles: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  previewOpen: false,
  sidebarOpen: true,
  showHiddenFiles: false,

  togglePreview: () => set((state) => ({ previewOpen: !state.previewOpen })),
  setPreviewOpen: (open) => set({ previewOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleHiddenFiles: () => set((state) => ({ showHiddenFiles: !state.showHiddenFiles })),
}))
