import { Check, ChevronRight } from 'lucide-react'
import { forwardRef, useState } from 'react'
import { ariaKeyShortcuts, formatAccelerator } from '@/constants/shortcuts'

/**
 * The shared look of a menu surface and its rows.
 *
 * Both the menu bar's dropdowns and the context menus render through this, so
 * "native-feeling" is decided once. Before this existed the two would have been
 * two sets of Tailwind classes drifting apart on the next visual change.
 *
 * Purely presentational: no command ids, no store access, no handlers of its
 * own. Callers say what a row is and what pressing it does.
 */

export const MenuPanel = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function MenuPanel({ className = '', style, ...props }, ref) {
    return (
      <div
        ref={ref}
        role="menu"
        className={`bg-elevated border-edge z-50 min-w-[220px] rounded-lg border p-1 outline-none ${className}`}
        style={{ boxShadow: 'var(--shadow-menu)', ...style }}
        {...props}
      />
    )
  },
)

export function MenuSeparator() {
  return <div role="separator" className="bg-edge my-1 h-px" />
}

interface MenuItemButtonProps {
  /** Needed by `aria-activedescendant` when the container holds focus. */
  id?: string | undefined
  label: string
  /** An accelerator string from `constants/shortcuts`, rendered as `⌘⇧N`. */
  accelerator?: string | undefined
  checkable?: boolean | undefined
  checked?: boolean | undefined
  disabled?: boolean | undefined
  /** Highlights the row under the keyboard cursor, independent of hover. */
  active?: boolean | undefined
  onSelect: () => void
  onMouseEnter?: (() => void) | undefined
}

/**
 * A row that opens a nested menu beside it (§M17).
 *
 * Opens on hover as a real menu does, and stays open while the pointer is
 * anywhere in the row *or* the flyout — which is why the two share one wrapper
 * with the mouse handlers on it, rather than the flyout being a sibling the
 * pointer has to leave the row to reach.
 */
export function MenuSubmenuButton({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`text-secondary hover:bg-hover hover:text-primary flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors outline-none ${
          open ? 'bg-hover text-primary' : ''
        }`}
      >
        <span className="flex w-3.5 shrink-0 justify-center" />
        <span className="truncate">{label}</span>
        <ChevronRight size={12} className="text-muted ml-auto shrink-0" aria-hidden />
      </button>

      {open && (
        <MenuPanel
          aria-label={label}
          // Flush with the top of its row and just clear of the parent panel's
          // padding, which is where macOS puts a submenu.
          className="absolute top-0 left-full ml-0.5"
        >
          {children}
        </MenuPanel>
      )}
    </div>
  )
}

export const MenuItemButton = forwardRef<HTMLButtonElement, MenuItemButtonProps>(
  function MenuItemButton(
    { id, label, accelerator, checkable, checked, disabled, active, onSelect, onMouseEnter },
    ref,
  ) {
    return (
      <button
        ref={ref}
        id={id}
        type="button"
        role={checkable ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={checkable ? checked : undefined}
        aria-keyshortcuts={accelerator ? ariaKeyShortcuts(accelerator) : undefined}
        disabled={disabled}
        // Pointer *up* activates, matching a real menu: the press that opened a
        // context menu must not also pick whatever ended up under the cursor.
        onClick={onSelect}
        onMouseEnter={onMouseEnter}
        className={`text-secondary enabled:hover:bg-hover enabled:hover:text-primary flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors outline-none disabled:opacity-35 ${
          active ? 'bg-hover text-primary' : ''
        }`}
      >
        <span className="flex w-3.5 shrink-0 justify-center">
          {checkable && checked && <Check size={12} className="text-accent" />}
        </span>
        <span className="truncate">{label}</span>
        {accelerator && (
          // `ml-auto` rather than a fixed column: accelerators vary in width and
          // a column wide enough for ⌘⇧. wastes space in menus that have none.
          //
          // Hidden from assistive technology — `aria-keyshortcuts` above says
          // the same thing, and leaving the glyphs in the accessible name would
          // make the row read as "New Folder ⌘⇧N".
          <span aria-hidden className="text-muted ml-auto shrink-0 pl-6 font-mono text-[11px]">
            {formatAccelerator(accelerator)}
          </span>
        )}
      </button>
    )
  },
)
