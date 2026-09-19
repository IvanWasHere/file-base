import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  MenuItemButton,
  MenuPanel,
  MenuSeparator,
  MenuSubmenuButton,
} from '@/components/menus/MenuPanel'

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
  /**
   * Rows that open beside this one instead of it (§M25).
   *
   * A row with a submenu has no `onSelect` worth running — pressing it opens
   * the flyout — so callers pass a no-op. One level only: the children are a
   * flat list, and a submenu inside a submenu is a depth macOS allows and
   * nobody enjoys.
   */
  submenu?: ContextMenuAction[] | undefined
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

/**
 * The next enabled row in `rows` from `from`, stepping by `delta`.
 *
 * Gives up after a full lap so a list with nothing enabled cannot spin
 * forever, and returns -1 when there is nowhere to go.
 */
function nextEnabled(rows: ContextMenuAction[], from: number, delta: number): number {
  let next = from
  for (let i = 0; i < rows.length; i++) {
    next = (next + delta + rows.length) % rows.length
    if (!rows[next]?.disabled) return next
  }
  return -1
}

export function ContextMenu({ x, y, groups, onClose }: ContextMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  const shown = groups.filter((group) => group.length > 0)
  const actions = shown.flat()
  const firstEnabled = actions.findIndex((action) => !action.disabled)
  const [activeIndex, setActiveIndex] = useState(firstEnabled)

  /**
   * Which row's flyout is open, and where the cursor is inside it.
   *
   * Lifted out of `MenuSubmenuButton` because one key handler on the panel owns
   * traversal here: the flyout's rows have to be reachable with the arrow keys,
   * and a component holding its own open state could not be told to open.
   */
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null)
  const [submenuIndex, setSubmenuIndex] = useState(-1)
  const submenuRows = (openSubmenu === null ? undefined : actions[openSubmenu]?.submenu) ?? []

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
    const next = nextEnabled(actions, activeIndex, delta)
    if (next >= 0) setActiveIndex(next)
  }

  /** Opens a row's flyout with the cursor on its first enabled entry. */
  const openSubmenuAt = (index: number) => {
    const rows = actions[index]?.submenu
    if (!rows || actions[index]?.disabled) return
    setActiveIndex(index)
    setOpenSubmenu(index)
    // Re-entering the row that is already open must not throw the cursor back
    // to the top of a flyout the pointer is halfway down.
    if (openSubmenu !== index) setSubmenuIndex(rows.findIndex((row) => !row.disabled))
  }

  /** Closes the flyout and leaves the cursor on the row that owns it. */
  const closeSubmenu = () => {
    setOpenSubmenu(null)
    setSubmenuIndex(-1)
  }

  const pick = (action: ContextMenuAction | undefined) => {
    if (!action || action.disabled) return
    onClose()
    action.onSelect()
  }

  // Traversal inside an open flyout. Split out rather than folded into the
  // switch below because every key means something different once a submenu has
  // the cursor — Escape closes the flyout rather than the menu, and ArrowLeft
  // is a step back rather than nothing at all.
  const handleSubmenuKeyDown = (event: React.KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        const next = nextEnabled(submenuRows, submenuIndex, event.key === 'ArrowDown' ? 1 : -1)
        if (next >= 0) setSubmenuIndex(next)
        return
      }
      case 'ArrowLeft':
      case 'Escape':
        event.preventDefault()
        closeSubmenu()
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        pick(submenuRows[submenuIndex])
        return
      case 'Tab':
        event.preventDefault()
        onClose()
        return
    }

    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return
    const letter = event.key.toLowerCase()
    const found = submenuRows.findIndex(
      (row) => !row.disabled && row.label.toLowerCase().startsWith(letter),
    )
    if (found >= 0) {
      event.preventDefault()
      setSubmenuIndex(found)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (openSubmenu !== null) {
      handleSubmenuKeyDown(event)
      return
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        step(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        step(-1)
        return
      case 'ArrowRight':
        // Only meaningful on a row that has somewhere to go.
        if (actions[activeIndex]?.submenu) {
          event.preventDefault()
          openSubmenuAt(activeIndex)
        }
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
        // Enter on a submenu row opens it rather than running a handler there
        // is no sensible one for.
        if (actions[activeIndex]?.submenu) {
          openSubmenuAt(activeIndex)
          return
        }
        pick(actions[activeIndex])
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

  // Which row a screen reader should be told the cursor is on: the flyout entry
  // when one is open, otherwise the row in the panel.
  const activeDescendant =
    openSubmenu !== null && submenuIndex >= 0
      ? `context-menu-item-${openSubmenu}-${submenuIndex}`
      : activeIndex >= 0
        ? `context-menu-item-${activeIndex}`
        : undefined

  return (
    <MenuPanel
      ref={panelRef}
      tabIndex={-1}
      aria-label="Context menu"
      // Focus stays on the panel so one key handler owns traversal; this is how
      // a screen reader still learns which row the cursor is on.
      aria-activedescendant={activeDescendant}
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

            if (action.submenu) {
              return (
                <MenuSubmenuButton
                  key={action.key}
                  id={`context-menu-item-${current}`}
                  label={action.label}
                  active={current === activeIndex}
                  open={openSubmenu === current}
                  // Opening is a hover; closing is not. The pointer crossing
                  // the gap between a row and its flyout reads as leaving the
                  // row, and a flyout that vanished on the way to it could
                  // never be reached. It closes when another row takes the
                  // cursor, when something in it is picked, or with the menu —
                  // which is how a real menu behaves too.
                  onOpenChange={(open) => open && openSubmenuAt(current)}
                >
                  {action.submenu.map((row, rowIndex) => (
                    <MenuItemButton
                      key={row.key}
                      id={`context-menu-item-${current}-${rowIndex}`}
                      label={row.label}
                      checkable={row.checkable}
                      checked={row.checked}
                      disabled={row.disabled}
                      active={openSubmenu === current && rowIndex === submenuIndex}
                      onMouseEnter={() => !row.disabled && setSubmenuIndex(rowIndex)}
                      onSelect={() => pick(row)}
                    />
                  ))}
                </MenuSubmenuButton>
              )
            }

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
                onMouseEnter={() => {
                  if (action.disabled) return
                  setActiveIndex(current)
                  // Moving onto a plain row is leaving whatever flyout was
                  // open, exactly as it is in a real menu.
                  closeSubmenu()
                }}
                onSelect={() => pick(action)}
              />
            )
          })}
        </div>
      ))}
    </MenuPanel>
  )
}
