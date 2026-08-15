import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MenuItemButton, MenuPanel, MenuSeparator } from '@/components/menus/MenuPanel'

/**
 * A context menu: positioned at the pointer, keyboard-traversable, dismissed by
 * Escape, an outside click, or picking something.
 *
 * Presentational — it is handed groups of already-resolved actions and knows
 * nothing about commands. `ContextMenuHost` builds them.
 */

export interface ContextMenuAction {
  /** Stable within a menu; used as the React key. */
  key: string
  label: string
  accelerator?: string | undefined
  checkable?: boolean | undefined
  checked?: boolean | undefined
  disabled?: boolean | undefined
  onSelect: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  /** Groups, drawn with a rule between them. Empty groups are skipped. */
  groups: ContextMenuAction[][]
  onClose: () => void
}

/** Keeps the panel off the window edges when it opens near one. */
const MARGIN = 8

export function ContextMenu({ x, y, groups, onClose }: ContextMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  const shown = groups.filter((group) => group.length > 0)
  const actions = shown.flat()
  const firstEnabled = actions.findIndex((action) => !action.disabled)
  const [activeIndex, setActiveIndex] = useState(firstEnabled)

  // Layout effect, not an effect: measuring and flipping after paint would show
  // the menu hanging off the screen for a frame before it jumped.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const { width, height } = panel.getBoundingClientRect()
    // Flip rather than clamp — a menu pinned to the edge would sit under the
    // pointer and swallow the next click.
    const left = x + width + MARGIN > window.innerWidth ? Math.max(MARGIN, x - width) : x
    const top = y + height + MARGIN > window.innerHeight ? Math.max(MARGIN, y - height) : y
    setPosition({ left, top })
  }, [x, y])

  // Focus moves into the menu so arrows and Escape work without a click, and
  // returns to wherever it was when the menu closes — otherwise dismissing one
  // would leave focus on the body, where every shortcut is inert.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.focus({ preventScroll: true })
    return () => previous?.focus?.({ preventScroll: true })
  }, [])

  useEffect(() => {
    // `pointerdown` rather than `click`: a press that starts outside should
    // close immediately, and the capture phase keeps a handler on the element
    // underneath from acting on a click that was only meant to dismiss.
    //
    // Which means the panel has to be excluded here by containment — a capture
    // listener on `window` runs before anything inside the panel could call
    // `stopPropagation`, so a press on a menu row would otherwise close the
    // menu before the row's own click ever fired.
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return
      onClose()
    }
    const dismiss = () => onClose()

    window.addEventListener('pointerdown', onPointerDown, true)
    // Anything that moves the menu out from under the pointer closes it.
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
    }
  }, [onClose])

  const step = (delta: number) => {
    if (actions.length === 0) return
    let next = activeIndex
    // Skips disabled rows, and gives up after a full lap so a menu with nothing
    // enabled cannot spin forever.
    for (let i = 0; i < actions.length; i++) {
      next = (next + delta + actions.length) % actions.length
      if (!actions[next]?.disabled) {
        setActiveIndex(next)
        return
      }
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        step(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        step(-1)
        return
      case 'Home':
        event.preventDefault()
        setActiveIndex(firstEnabled)
        return
      case 'End': {
        event.preventDefault()
        const last = actions.map((action) => !action.disabled).lastIndexOf(true)
        if (last >= 0) setActiveIndex(last)
        return
      }
      case 'Enter':
      case ' ': {
        event.preventDefault()
        const action = actions[activeIndex]
        if (action && !action.disabled) {
          onClose()
          action.onSelect()
        }
        return
      }
      case 'Escape':
      case 'Tab':
        event.preventDefault()
        onClose()
        return
    }

    // Type-ahead over first letters, as menus do. Single characters only, so a
    // modifier combination falls through to the shortcut registry instead.
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return
    const letter = event.key.toLowerCase()
    const found = actions.findIndex(
      (action) => !action.disabled && action.label.toLowerCase().startsWith(letter),
    )
    if (found >= 0) {
      event.preventDefault()
      setActiveIndex(found)
    }
  }

  return (
    <MenuPanel
      ref={panelRef}
      tabIndex={-1}
      aria-label="Context menu"
      // Focus stays on the panel so one key handler owns traversal; this is how
      // a screen reader still learns which row the cursor is on.
      aria-activedescendant={activeIndex >= 0 ? `context-menu-item-${activeIndex}` : undefined}
      onKeyDown={handleKeyDown}
      // A right-click inside the menu is not a request for another menu.
      onContextMenu={(event) => event.preventDefault()}
      style={{ position: 'fixed', left: position.left, top: position.top }}
    >
      {shown.map((group, groupIndex) => (
        <div key={group[0]?.key ?? groupIndex}>
          {groupIndex > 0 && <MenuSeparator />}
          {group.map((action) => {
            // The keyboard cursor indexes the flattened list, so a row has to
            // find its own position in it. `indexOf` over a dozen entries is
            // cheaper than threading a running counter through two maps.
            const current = actions.indexOf(action)
            return (
              <MenuItemButton
                key={action.key}
                id={`context-menu-item-${current}`}
                label={action.label}
                accelerator={action.accelerator}
                checkable={action.checkable}
                checked={action.checked}
                disabled={action.disabled}
                active={current === activeIndex}
                onMouseEnter={() => !action.disabled && setActiveIndex(current)}
                onSelect={() => {
                  onClose()
                  action.onSelect()
                }}
              />
            )
          })}
        </div>
      ))}
    </MenuPanel>
  )
}
