/**
 * Transient notifications — the surface M6 needs for "operation failed" and
 * "undo this".
 *
 * A store of its own rather than a slice of `uiStore`: toasts change on a timer,
 * and every component subscribing to `uiStore` would re-render each time one
 * appeared or aged out.
 */

import { create } from 'zustand'

export type ToastTone = 'info' | 'success' | 'error' | 'progress'

export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: string
  tone: ToastTone
  message: string
  detail?: string
  action?: ToastAction
}

/**
 * Errors stay until dismissed: they usually need reading, and a message that
 * vanishes mid-sentence is worse than none. `progress` toasts are owned by the
 * operation that raised them and are dismissed by hand when it settles.
 */
const LIFETIME_MS: Record<ToastTone, number> = {
  info: 5000,
  success: 5000,
  error: Infinity,
  progress: Infinity,
}

interface ToastState {
  toasts: Toast[]
  push: (toast: Omit<Toast, 'id'>) => string
  update: (id: string, patch: Partial<Omit<Toast, 'id'>>) => void
  dismiss: (id: string) => void
  clear: () => void
}

let counter = 0
const timers = new Map<string, ReturnType<typeof setTimeout>>()

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  push: (toast) => {
    counter += 1
    const id = `toast-${counter}`
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))

    const lifetime = LIFETIME_MS[toast.tone]
    if (Number.isFinite(lifetime)) {
      timers.set(
        id,
        setTimeout(() => get().dismiss(id), lifetime),
      )
    }
    return id
  },

  update: (id, patch) =>
    set((state) => ({
      toasts: state.toasts.map((toast) => (toast.id === id ? { ...toast, ...patch } : toast)),
    })),

  dismiss: (id) => {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  },

  clear: () => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    set({ toasts: [] })
  },
}))

/** Imperative entry point for services that are not React components. */
export const toast = {
  info: (message: string, detail?: string) =>
    useToastStore.getState().push({ tone: 'info', message, ...(detail ? { detail } : {}) }),
  success: (message: string, action?: ToastAction) =>
    useToastStore.getState().push({ tone: 'success', message, ...(action ? { action } : {}) }),
  error: (message: string, detail?: string) =>
    useToastStore.getState().push({ tone: 'error', message, ...(detail ? { detail } : {}) }),
}
