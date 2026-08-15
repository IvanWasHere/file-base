import { useCallback, useRef } from 'react'
import type { FileItem } from '@/types/file'
import { findByPrefix, stepIndex } from '@/utils/selection'

/**
 * Keyboard navigation for a file list or grid (PRD: "Keyboard-first workflow").
 *
 * `stride` is the number of columns: 1 for the Details list, the grid's column
 * count for icon views, so Up/Down move a whole row in both.
 *
 * Type-ahead buffers keystrokes for 700ms, matching Finder — typing "de" lands
 * on "Desktop" rather than jumping to "D" then "E".
 *
 * This hook owns *moving within the list* and nothing else. Commands — open,
 * rename, trash, copy — belong to the shortcut registry (M11), and the two are
 * kept apart by one rule: everything handled here calls `preventDefault`, and
 * `useKeyboard` ignores an event that has already been handled. Anything this
 * hook declines therefore falls through, which is exactly how Enter reaches
 * Rename and Space reaches the preview panel.
 */

const TYPEAHEAD_RESET_MS = 700

interface UseListKeyboardOptions {
  items: readonly FileItem[]
  lead: string | null
  stride?: number
  onSelect: (path: string) => void
  onExtendTo: (path: string) => void
  onSelectAll: () => void
  onClear: () => void
  onScrollToIndex?: (index: number) => void
}

export function useListKeyboard({
  items,
  lead,
  stride = 1,
  onSelect,
  onExtendTo,
  onSelectAll,
  onClear,
  onScrollToIndex,
}: UseListKeyboardOptions) {
  const typeahead = useRef({ query: '', at: 0 })

  return useCallback(
    (event: React.KeyboardEvent) => {
      if (items.length === 0) return

      const currentIndex = lead ? items.findIndex((item) => item.path === lead) : -1

      const moveTo = (index: number, extend: boolean) => {
        const item = items[index]
        if (!item) return
        if (extend) onExtendTo(item.path)
        else onSelect(item.path)
        onScrollToIndex?.(index)
      }

      // Cmd+Arrow is navigation between folders, not within one: Cmd+Up goes to
      // the enclosing folder, Cmd+Left/Right are back and forward, Cmd+Down
      // opens. Claiming the arrows unconditionally would have shadowed all four.
      const accel = event.metaKey || event.ctrlKey
      if (accel && event.key.startsWith('Arrow')) return

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          moveTo(stepIndex(currentIndex, 1, items.length, stride), event.shiftKey)
          return

        case 'ArrowUp':
          event.preventDefault()
          moveTo(stepIndex(currentIndex, -1, items.length, stride), event.shiftKey)
          return

        case 'ArrowRight':
          // In a list, stride is 1 and horizontal movement is meaningless.
          if (stride === 1) return
          event.preventDefault()
          moveTo(stepIndex(currentIndex, 1, items.length, 1), event.shiftKey)
          return

        case 'ArrowLeft':
          if (stride === 1) return
          event.preventDefault()
          moveTo(stepIndex(currentIndex, -1, items.length, 1), event.shiftKey)
          return

        case 'Home':
          event.preventDefault()
          moveTo(0, event.shiftKey)
          return

        case 'End':
          event.preventDefault()
          moveTo(items.length - 1, event.shiftKey)
          return

        case 'Escape':
          event.preventDefault()
          onClear()
          return

        case 'a':
        case 'A':
          // Also in the registry, so Cmd+A works with focus outside the list.
          // Handled here as well because the list is the one place that knows
          // the display order the selection has to follow.
          if (accel) {
            event.preventDefault()
            onSelectAll()
          }
          return

        default:
          break
      }

      // Type-ahead: single printable characters only, and never while a
      // modifier is held (that would hijack shortcuts).
      if (event.key.length !== 1 || accel || event.altKey) return

      const now = Date.now()
      const buffer = now - typeahead.current.at > TYPEAHEAD_RESET_MS ? '' : typeahead.current.query

      // A leading space is never the start of a filename search, so Space is
      // left to the registry, where it toggles the preview panel as it does in
      // Finder. Mid-buffer it still types — "my doc" is a reasonable search.
      if (event.key === ' ' && buffer === '') return

      event.preventDefault()
      const query = buffer + event.key
      typeahead.current = { query, at: now }

      const names = items.map((item) => item.name)
      // Searching from the current position makes repeated presses of the same
      // letter cycle through matches.
      const found = findByPrefix(names, query, query.length === 1 ? currentIndex : currentIndex - 1)
      if (found >= 0) moveTo(found, false)
    },
    [items, lead, stride, onSelect, onExtendTo, onSelectAll, onClear, onScrollToIndex],
  )
}
