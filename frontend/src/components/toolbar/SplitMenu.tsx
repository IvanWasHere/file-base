import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SplitLayoutIcon } from './SplitLayoutIcon'
import { SPLIT_OPTIONS, splitLabel } from '@/constants/splitModes'
import type { SplitMode } from '@/types/workspace'

/**
 * The split layout picker (PLAN.md §M16, §M17).
 *
 * **Pictograms only, button included.** Once the picture is generated from the
 * layout itself it describes the arrangement better than any name can, and
 * "Split Left" versus "Split Right" is exactly the pair a word does worst at. A
 * vertical list of nine icons would also be a 324px column of mostly empty
 * space; as a grid it is small enough to take in at once and puts the shapes
 * side by side, where the differences between them are easiest to see.
 *
 * **Both widths are fixed**, and that is the reason the button dropped its
 * label: "2 Columns", "Split Bottom" and "2 × 2 Grid" are three different
 * widths, so the control used to resize itself every time the layout changed and
 * squeeze the breadcrumb beside it. With only an icon and a chevron it is the
 * same size whatever is selected.
 *
 * **Selection is colour, not an outline.** A border on the active tile is a
 * second signal saying what the accent colour already says, and at 44px it
 * crowds the pictogram it is drawn around.
 *
 * The names have not gone anywhere — they are the tooltip, the accessible name,
 * the status bar and both View menus.
 *
 * Closes on outside pointerdown and Escape and unbinds when shut, as `ViewMenu`
 * does beside it, rather than the mockup's document-level click listener that
 * ran on every click in the app.
 */

/** 3 × 44px tiles + 2 × 4px gaps + 2 × 6px padding. Stated, so it cannot drift. */
const MENU_WIDTH = 152
export function SplitMenu({
  mode,
  onChange,
}: {
  mode: SplitMode
  onChange: (mode: SplitMode) => void
}) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Split layout: ${splitLabel(mode)}`}
        // The name is gone from the face of the control, so the tooltip has to
        // carry it rather than just saying what the button is for.
        title={`Split layout: ${splitLabel(mode)}`}
        onClick={() => setOpen((value) => !value)}
        className={`bg-base text-primary flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors ${
          open ? 'border-accent' : 'border-edge hover:border-[var(--text-muted)]'
        }`}
      >
        <SplitLayoutIcon mode={mode} size={14} />
        <ChevronDown size={10} className="text-muted" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Split layout"
          // Right-aligned for the same reason as the view menu: this sits near
          // the right edge of the toolbar, and a left-aligned menu overflows.
          className="bg-elevated border-edge absolute top-full right-0 z-50 mt-1 grid grid-cols-3 gap-1 rounded-lg border p-1.5"
          style={{ boxShadow: 'var(--shadow-menu)', width: MENU_WIDTH }}
        >
          {SPLIT_OPTIONS.map((option) => {
            const active = option.mode === mode
            return (
              <button
                key={option.mode}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                // The tile shows no text, so this is the only name it has —
                // for the tooltip, and for anything reading the screen.
                aria-label={option.label}
                title={option.label}
                onClick={() => {
                  onChange(option.mode)
                  setOpen(false)
                }}
                // No border in either state: every tile is the same 44px box,
                // and selection reads off the accent colour alone.
                className={`flex size-11 items-center justify-center rounded-md transition-colors ${
                  active
                    ? 'text-accent bg-[var(--accent-glow)]'
                    : 'text-muted hover:bg-hover hover:text-primary'
                }`}
              >
                <SplitLayoutIcon mode={option.mode} size={24} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
