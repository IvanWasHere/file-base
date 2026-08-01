/**
 * The in-flight drag (PLAN.md M9).
 *
 * The payload lives here rather than in `DataTransfer` because the browser
 * makes drag data unreadable during `dragover` — `getData` returns "" until the
 * drop fires. Every decision a drag has to make while it is moving (is this a
 * legal target? copy or move? which row highlights?) needs the payload, so it
 * is held in a store and `DataTransfer` carries only a plain-text copy of the
 * paths for anything outside the app that might read it.
 */

import { create } from 'zustand'

export type DragEffect = 'copy' | 'move'

interface DragState {
  /** Empty when nothing is being dragged. */
  paths: string[]
  /** The folder the drag started from — a drop back into it is a no-op. */
  sourceDir: string
  /** The drop target currently under the pointer. */
  over: string | null
  /** What dropping right now would do. */
  effect: DragEffect | null

  start: (paths: readonly string[], sourceDir: string) => void
  hover: (path: string | null, effect: DragEffect | null) => void
  end: () => void
}

export const useDragStore = create<DragState>()((set) => ({
  paths: [],
  sourceDir: '',
  over: null,
  effect: null,

  start: (paths, sourceDir) => set({ paths: [...paths], sourceDir, over: null, effect: null }),

  hover: (path, effect) =>
    set((state) =>
      // Guarded so the constant stream of dragover events does not re-render
      // every row sixty times a second for no change.
      state.over === path && state.effect === effect ? state : { over: path, effect },
    ),

  end: () => set({ paths: [], sourceDir: '', over: null, effect: null }),
}))

/** True while something is being dragged inside the app. */
export function useIsDragging(): boolean {
  return useDragStore((state) => state.paths.length > 0)
}

/** True when this path is the current drop target. */
export function useIsDropTarget(path: string): boolean {
  return useDragStore((state) => state.over === path && state.paths.length > 0)
}
