import { useEffect, useRef } from 'react'
import { findCommand, isBareKey } from '@/constants/shortcuts'
import { useMenuCommands } from '@/hooks/useMenuCommands'
import { useUiStore } from '@/stores/uiStore'

/**
 * The window's shortcut listener (PLAN.md M11).
 *
 * One listener for the whole app, not one per pane. Every command it dispatches
 * acts on "the active pane and its selection", which `useMenuCommands` already
 * resolves — a pane-scoped handler would have to rebuild that on each keystroke,
 * and would leave every shortcut dead whenever focus sat in the sidebar.
 *
 * "Respects focus context" is four rules, in order:
 *
 * 1. **Already handled wins.** If the focused element's own handler called
 *    `preventDefault`, the key was navigation inside a list — arrows, Home/End,
 *    type-ahead — and the registry keeps its hands off. This is the seam that
 *    reconciles the two, and the one M13's Left/Right photo stepping will use:
 *    it registers with `useListKeyboard`, and the global Cmd+Left stays clear of
 *    it because the two never claim the same combination.
 * 2. **A modal owns the keyboard.** While a dialog, a context menu or the hash
 *    modal is open, nothing global fires.
 * 3. **Typing is typing.** Inside an input, textarea or contenteditable — the
 *    rename editor, the search box — every shortcut is inert, so Cmd+C copies
 *    the text the user selected rather than the files behind it.
 * 4. **Bare keys yield to focused controls.** Enter and Space on a focused
 *    button must press the button. Only combinations with a modifier override
 *    that.
 */
export function useKeyboard(): void {
  const commands = useMenuCommands()

  // The handler is attached once. `useMenuCommands` returns fresh closures on
  // every render — it subscribes to half a dozen stores — and re-attaching a
  // document listener that often would be pure churn.
  const latest = useRef(commands)
  useEffect(() => {
    latest.current = commands
  }, [commands])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return

      const ui = useUiStore.getState()
      if (ui.dialog || ui.contextMenu || ui.hashJob) return

      const target = event.target as HTMLElement | null
      if (isEditable(target)) return

      const match = findCommand(event)
      if (!match) return
      if (isBareKey(match.shortcut) && isActivatable(target)) return

      // A disabled command still swallows its key: Cmd+V with an empty
      // clipboard should do nothing, not fall through to the browser.
      event.preventDefault()
      if (latest.current.isEnabled(match.id)) latest.current.run(match.id)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}

function isEditable(element: HTMLElement | null): boolean {
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable
}

/** Elements for which Enter or Space already means "press me". */
function isActivatable(element: HTMLElement | null): boolean {
  if (!element) return false
  const role = element.getAttribute('role')
  return (
    element.tagName === 'BUTTON' ||
    element.tagName === 'A' ||
    role === 'button' ||
    role === 'menuitem' ||
    role === 'menuitemcheckbox'
  )
}
