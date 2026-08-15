import { useEffect, useRef, useState } from 'react'
import { useUiStore, type PasswordRequest } from '@/stores/uiStore'
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
  if (dialog?.kind === 'password') return <PasswordDialog request={dialog} />
  return <ChoiceDialog />
}

/**
 * An archive asking for its password (M18 decision 18).
 *
 * Split out because it resolves a typed value rather than a chosen button, and
 * because a password field needs focus, an Enter binding and a retry message
 * the other two have no use for.
 */
function PasswordDialog({ request }: { request: PasswordRequest }) {
  const resolveDialog = useUiStore((state) => state.resolveDialog)
  const [password, setPassword] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) resolveDialog(null)
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-label="Archive password"
        className="bg-elevated border-edge w-[420px] rounded-xl border p-5 shadow-2xl"
      >
        <h2 className="font-display text-primary text-[15px] font-semibold">
          {request.retry ? 'That password did not work' : 'This archive is protected'}
        </h2>
        <p className="text-secondary mt-1.5 text-[13px] leading-snug">
          Enter the password for “{request.name}”.
        </p>

        <input
          ref={inputRef}
          type="password"
          value={password}
          aria-label="Password"
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              resolveDialog(password)
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              resolveDialog(null)
            }
          }}
          className="border-edge bg-base text-primary mt-3 w-full rounded-md border px-2 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => resolveDialog(null)}
            className="border-edge text-secondary hover:bg-hover hover:text-primary rounded-md border px-3 py-1.5 text-[13px] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => resolveDialog(password)}
            className="text-accent rounded-md bg-[var(--accent-glow)] px-3 py-1.5 text-[13px] transition-colors hover:opacity-90"
          >
            Open
          </button>
        </div>
      </div>
    </div>
  )
}

function ChoiceDialog() {
  const dialog = useUiStore((state) => state.dialog)
  const resolveDialog = useUiStore((state) => state.resolveDialog)
  const panelRef = useRef<HTMLDivElement>(null)
  const safeButtonRef = useRef<HTMLButtonElement>(null)

  // Focus moves into the dialog so Escape and Tab work without a click, and
  // lands on the *safe* choice — never on Delete or Replace.
  useEffect(() => {
    if (dialog) safeButtonRef.current?.focus()
  }, [dialog])

  if (!dialog || dialog.kind === 'password') return null

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
