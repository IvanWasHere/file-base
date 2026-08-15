import { useEffect, useRef, useState } from 'react'
import {
  MenuItemButton,
  MenuPanel,
  MenuSeparator,
  MenuSubmenuButton,
} from '@/components/menus/MenuPanel'
import {
  APP_MENUS,
  isSeparator,
  isSubmenu,
  type MenuCommandId,
  type MenuItem,
} from '@/constants/menus'
import { acceleratorFor } from '@/constants/shortcuts'
import { useMenuCommands } from '@/hooks/useMenuCommands'

/**
 * In-window application menu.
 *
 * The window uses a hidden-inset title bar, so the traffic lights float over
 * the top-left of the content. The 50px top padding reserves a strip for them,
 * putting the menu *below* the lights rather than beside them — which is why
 * the menu needs no left inset and can align with the tab row underneath it.
 *
 * The whole block is the window drag region; the menu items opt back out.
 *
 * Behaves like a real menu bar: once one menu is open, hovering another switches
 * to it without a second click.
 */
export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const { run, isEnabled, isChecked, isVisible } = useMenuCommands()

  useEffect(() => {
    if (!openMenu) return

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenu])

  const activate = (id: MenuCommandId) => {
    run(id)
    setOpenMenu(null)
  }

  /** One row, wherever it sits — top level or inside a submenu. */
  const row = (item: MenuItem) => (
    <MenuItemButton
      key={item.id}
      label={item.label}
      accelerator={acceleratorFor(item.id)}
      checkable={item.checkable}
      checked={item.checkable ? isChecked(item.id) : undefined}
      disabled={!isEnabled(item.id)}
      onSelect={() => activate(item.id)}
    />
  )

  return (
    <div
      ref={container}
      className="bg-deep border-edge flex shrink-0 flex-col border-b"
      // Reserves the strip the traffic lights float in, so the menu sits below
      // them. The strip itself drags the window.
      style={{ paddingTop: 50, '--wails-draggable': 'drag' } as React.CSSProperties}
    >
      <div
        role="menubar"
        aria-label="Application"
        className="flex items-center gap-0.5 px-2 pb-1"
        style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
      >
        {APP_MENUS.map((menu) => {
          const open = openMenu === menu.id
          return (
            <div key={menu.id} className="relative">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpenMenu(open ? null : menu.id)}
                // Standard menu-bar behaviour: with one menu open, hovering a
                // sibling switches to it rather than requiring another click.
                onMouseEnter={() => openMenu && setOpenMenu(menu.id)}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                  open
                    ? 'text-accent bg-[var(--accent-glow)]'
                    : 'text-secondary hover:bg-hover hover:text-primary'
                }`}
              >
                {menu.label}
              </button>

              {open && (
                <MenuPanel
                  aria-label={menu.label}
                  className="absolute top-full left-0 mt-1"
                  style={{ position: 'absolute' }}
                >
                  {menu.items
                    // Hidden items go before the separators are drawn, so the
                    // Add/Remove Favorites pair collapsing to one never leaves a
                    // rule with nothing between it and the next.
                    .filter(
                      (entry) => isSeparator(entry) || isSubmenu(entry) || isVisible(entry.id),
                    )
                    .map((entry, index) => {
                      if (isSeparator(entry)) return <MenuSeparator key={`separator-${index}`} />
                      if (isSubmenu(entry)) {
                        return (
                          <MenuSubmenuButton key={entry.label} label={entry.label}>
                            {entry.items.map((item) => row(item))}
                          </MenuSubmenuButton>
                        )
                      }
                      return row(entry)
                    })}
                </MenuPanel>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
