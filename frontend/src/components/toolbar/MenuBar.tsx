import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { APP_MENUS, isSeparator, type MenuCommandId } from '@/constants/menus'
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
  const { run, isEnabled, isChecked } = useMenuCommands()

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
                <div
                  role="menu"
                  aria-label={menu.label}
                  className="bg-elevated border-edge absolute top-full left-0 z-50 mt-1 min-w-[200px] rounded-lg border p-1"
                  style={{ boxShadow: 'var(--shadow-menu)' }}
                >
                  {menu.items.map((entry, index) =>
                    isSeparator(entry) ? (
                      <div
                        key={`separator-${index}`}
                        role="separator"
                        className="bg-edge my-1 h-px"
                      />
                    ) : (
                      <button
                        key={entry.id}
                        type="button"
                        role={entry.checkable ? 'menuitemcheckbox' : 'menuitem'}
                        aria-checked={entry.checkable ? isChecked(entry.id) : undefined}
                        disabled={!isEnabled(entry.id)}
                        onClick={() => activate(entry.id)}
                        className="text-secondary enabled:hover:bg-hover enabled:hover:text-primary flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors disabled:opacity-35"
                      >
                        <span className="flex w-3.5 shrink-0 justify-center">
                          {entry.checkable && isChecked(entry.id) && (
                            <Check size={12} className="text-accent" />
                          )}
                        </span>
                        <span className="truncate">{entry.label}</span>
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
