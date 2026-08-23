import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { COLUMNS, isColumnVisible } from '@/constants/columns'
import { CONTEXT_COMMANDS, contextsFor, type ContextKind } from '@/constants/contextMenus'
import { findMenuItem, type MenuCommandId } from '@/constants/menus'
import { acceleratorFor } from '@/constants/shortcuts'
import { useUiStore } from '@/stores/uiStore'

/**
 * File Base Settings (PLAN.md §M22).
 *
 * Two sections, because §M22 adds exactly two things a user can configure:
 * which columns the details view shows, and which rows the right-click menus
 * offer. Everything else the app remembers — the theme, hidden files, the
 * sidebar — is a *toggle* reachable from the View menu, and moving those in here
 * would give each of them two homes that have to agree.
 *
 * Nothing is applied on OK. Every checkbox writes straight to the store, which
 * persists through the same subscription every other setting uses, and the
 * window behind the modal updates as it is ticked — which is the point: seeing
 * the Tags column appear is the confirmation, not a dialog saying it will.
 */
export function SettingsModal() {
  const open = useUiStore((state) => state.settingsOpen)
  return open ? <Panel /> : null
}

type Section = 'columns' | 'context'

const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: 'columns', label: 'Columns', hint: 'What the details view shows for each file.' },
  { id: 'context', label: 'Right-click Menu', hint: 'Which commands the context menus offer.' },
]

function Panel() {
  const closeSettings = useUiStore((state) => state.closeSettings)
  const [section, setSection] = useState<Section>('columns')
  const panelRef = useRef<HTMLDivElement>(null)

  // Focus moves into the panel so Escape and Tab work without a click, the way
  // every other modal here behaves.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) closeSettings()
      }}
      onKeyDown={(event) => {
        // Stopped as well as handled: the shortcut registry would otherwise see
        // the keystrokes that reach this panel as commands.
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          closeSettings()
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-label="File Base Settings"
        tabIndex={-1}
        className="bg-elevated border-edge flex h-[520px] w-[680px] overflow-hidden rounded-xl border shadow-2xl outline-none"
      >
        {/* A sidebar rather than tabs: this is the shape a settings window has
            on macOS, and it has room for the sections later milestones will
            add without the row of tabs wrapping. */}
        <nav className="border-edge bg-surface w-[190px] shrink-0 border-r p-3">
          <h2 className="font-display text-primary px-2 pt-1 pb-3 text-[15px] font-semibold">
            Settings
          </h2>
          <ul className="flex flex-col gap-0.5">
            {SECTIONS.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-current={section === entry.id}
                  onClick={() => setSection(entry.id)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
                    section === entry.id
                      ? 'text-accent bg-[var(--accent-glow)]'
                      : 'text-secondary hover:bg-hover hover:text-primary'
                  }`}
                >
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto p-5">
            {section === 'columns' ? <ColumnsSection /> : <ContextSection />}
          </div>

          <div className="border-edge flex justify-end border-t p-3">
            <button
              type="button"
              onClick={closeSettings}
              className="text-accent rounded-md bg-[var(--accent-glow)] px-3 py-1.5 text-[13px] transition-colors hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ColumnsSection() {
  const layout = useUiStore((state) => state.columnLayout)
  const setColumnVisible = useUiStore((state) => state.setColumnVisible)
  const resetColumns = useUiStore((state) => state.resetColumns)

  return (
    <section>
      <SectionHeader
        title="Columns"
        hint="Shown in the details view. Drag the headers there to reorder or resize them."
      />

      <ul className="mt-3 flex flex-col gap-0.5">
        {COLUMNS.map((spec) => (
          <li key={spec.id}>
            <CheckRow
              label={spec.label}
              // Name is ticked and unclickable rather than absent: leaving it
              // out would read as "Name is not a column", and the row is where
              // someone looks to find out why they cannot switch it off.
              detail={spec.required ? 'Always shown' : undefined}
              checked={isColumnVisible(layout, spec.id)}
              disabled={spec.required === true}
              onChange={(next) => setColumnVisible(spec.id, next)}
            />
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={resetColumns}
        className="border-edge text-secondary hover:bg-hover hover:text-primary mt-4 rounded-md border px-3 py-1.5 text-[13px] transition-colors"
      >
        Reset Columns
      </button>
    </section>
  )
}

/** How a context appears in the "shown in" line beside a command. */
const CONTEXT_LABELS: Record<ContextKind, string> = {
  file: 'File',
  folder: 'Folder',
  background: 'Background',
}

function ContextSection() {
  const hidden = useUiStore((state) => state.hiddenContextCommands)
  const setContextCommandVisible = useUiStore((state) => state.setContextCommandVisible)

  return (
    <section>
      <SectionHeader
        title="Right-click Menu"
        hint="Unticked commands stay reachable from the menu bar and their keyboard shortcuts."
      />

      <ul className="mt-3 flex flex-col gap-0.5">
        {CONTEXT_COMMANDS.map((id) => (
          <li key={id}>
            <CheckRow
              label={labelFor(id)}
              detail={contextsFor(id)
                .map((kind) => CONTEXT_LABELS[kind])
                .join(' · ')}
              accelerator={acceleratorFor(id)}
              checked={!hidden.includes(id)}
              onChange={(next) => setContextCommandVisible(id, next)}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function labelFor(id: MenuCommandId): string {
  return findMenuItem(id)?.label ?? id
}

function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <header>
      <h3 className="font-display text-primary text-[14px] font-semibold">{title}</h3>
      <p className="text-secondary mt-1 text-[13px] leading-snug">{hint}</p>
    </header>
  )
}

/**
 * One checkbox row.
 *
 * A `button` with `role="checkbox"` rather than an `<input>`: the whole row is
 * the target, which is what makes a list of twenty of them usable, and the
 * app's other lists (the algorithm list, the template list) are built the same
 * way.
 */
function CheckRow({
  label,
  detail,
  accelerator,
  checked,
  disabled,
  onChange,
}: {
  label: string
  detail?: string | undefined
  accelerator?: string | undefined
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
        disabled ? 'cursor-default opacity-60' : 'hover:bg-hover'
      }`}
    >
      <span
        aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          checked ? 'border-transparent bg-[var(--accent)] text-white' : 'border-[var(--border)]'
        }`}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      <span className="text-primary min-w-0 flex-1 truncate">{label}</span>
      {detail && <span className="text-muted shrink-0 text-xs">{detail}</span>}
      {accelerator && (
        <span className="text-muted shrink-0 font-mono text-xs" aria-hidden>
          {accelerator}
        </span>
      )}
    </button>
  )
}
