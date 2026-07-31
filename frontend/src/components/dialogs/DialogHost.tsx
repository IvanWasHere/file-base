import { useEffect, useRef } from 'react'
import { useUiStore } from '@/stores/uiStore'
import type { ConflictPolicy } from '@/types/file'
import { formatCount } from '@/utils/format'

/**
 * The application's modal dialogs (PLAN.md M6): destructive confirmation and
 * copy/move conflict resolution.
 *
 * In-window rather than native `MessageDialog`: the conflict dialog has to list
 * the colliding names and offer three outcomes, which a native alert models
 * poorly, and keeping both dialogs in one place means they cannot drift apart
 * in styling or focus behaviour.
 *
 * Escape always resolves the dialog to "no" — never to a destructive default.
 */

interface Choice {
  label: string
  value: boolean | ConflictPolicy
  /** Rendered as the primary action. */
  primary?: boolean
  destructive?: boolean
}

export function DialogHost() {
  const dialog = useUiStore((state) => state.dialog)
  const resolveDialog = useUiStore((state) => state.resolveDialog)
  const panelRef = useRef<HTMLDivElement>(null)
  const safeButtonRef = useRef<HTMLButtonElement>(null)

  // Focus moves into the dialog so Escape and Tab work without a click, and
  // lands on the *safe* choice — never on Delete or Replace.
  useEffect(() => {
    if (dialog) safeButtonRef.current?.focus()
  }, [dialog])

  if (!dialog) return null

  const choices: Choice[] =
    dialog.kind === 'confirm'
      ? [
          { label: 'Cancel', value: false },
          {
            label: dialog.confirmLabel,
            value: true,
            primary: true,
            ...(dialog.destructive ? { destructive: true } : {}),
          },
        ]
      : [
          { label: 'Cancel', value: false },
          { label: 'Skip', value: 'skip' },
          { label: 'Replace', value: 'replace', destructive: true },
          { label: 'Keep Both', value: 'keep-both', primary: true },
        ]

  const title =
    dialog.kind === 'confirm'
      ? dialog.title
      : `${formatCount(dialog.names.length, 'item')} already ${
          dialog.names.length === 1 ? 'exists' : 'exist'
        } here`

  const message =
    dialog.kind === 'confirm'
      ? dialog.message
      : `Choose what to do with ${
          dialog.names.length === 1 ? 'it' : 'them'
        }. The same choice applies to all.`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      // A click on the backdrop is a dismissal, matching every other modal on
      // the platform. `false` is the safe answer for both dialog kinds.
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) resolveDialog(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          resolveDialog(false)
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-label={title}
        className="bg-elevated border-edge w-[420px] rounded-xl border p-5 shadow-2xl"
      >
        <h2 className="font-display text-primary text-[15px] font-semibold">{title}</h2>
        <p className="text-secondary mt-1.5 text-[13px] leading-snug">{message}</p>

        {dialog.kind === 'confirm' && dialog.detail && (
          <p className="text-muted mt-1 text-xs">{dialog.detail}</p>
        )}

        {dialog.kind === 'conflict' && (
          <ul className="border-edge bg-base text-secondary mt-3 max-h-32 overflow-auto rounded-md border p-2 text-xs">
            {dialog.names.map((name) => (
              <li key={name} className="truncate py-0.5">
                {name}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {choices.map((choice) => {
            const safe = choice.value === false
            return (
              <button
                key={choice.label}
                type="button"
                ref={safe ? safeButtonRef : undefined}
                onClick={() => resolveDialog(choice.value)}
                className={`rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                  choice.destructive
                    ? 'bg-[var(--danger)] text-white hover:opacity-90'
                    : choice.primary
                      ? 'text-accent bg-[var(--accent-glow)] hover:opacity-90'
                      : 'border-edge text-secondary hover:bg-hover hover:text-primary border'
                }`}
              >
                {choice.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
