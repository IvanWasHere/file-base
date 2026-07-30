import { ChevronDown, List } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { VIEW_OPTIONS } from '@/constants/viewModes'
import type { ViewMode } from '@/types/workspace'

/**
 * The mockup's view dropdown, ported.
 *
 * The mockup closed this by attaching a document-level click listener that ran
 * on every click in the app; this closes on outside pointerdown and Escape, and
 * unbinds when shut.
 */
export function ViewMenu({
  mode,
  onChange,
}: {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
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

  const current = VIEW_OPTIONS.find((option) => option.mode === mode) ?? VIEW_OPTIONS[0]
  const CurrentIcon = current?.icon ?? List

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`bg-base text-primary flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
          open ? 'border-accent' : 'border-edge hover:border-[var(--text-muted)]'
        }`}
      >
        <CurrentIcon size={13} />
        <span>{current?.label}</span>
        <ChevronDown size={10} className="text-muted" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="View mode"
          // Right-aligned: this control sits near the right edge of the
          // toolbar, and a left-aligned menu overflows the window.
          className="bg-elevated border-edge absolute top-full right-0 z-50 mt-1 min-w-[180px] rounded-lg border p-1"
          style={{ boxShadow: 'var(--shadow-menu)' }}
        >
          {VIEW_OPTIONS.map((option) => {
            const Icon = option.icon
            const active = option.mode === mode
            return (
              <button
                key={option.mode}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(option.mode)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors ${
                  active
                    ? 'text-accent bg-[var(--accent-glow)]'
                    : 'text-secondary hover:bg-hover hover:text-primary'
                }`}
              >
                <Icon size={14} className="w-[18px] shrink-0" />
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
