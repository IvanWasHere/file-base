import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { standardPathsQuery } from '@/services/filesystem/queries'
import { applicationsQuery } from '@/services/shell/queries'
import {
  applicationFolders,
  applicationLabel,
  installedApplicationsQuery,
} from '@/services/shell/installed'
import { openWith } from '@/services/shell/open'
import type { Application } from '@/services/bridge'
import { useUiStore } from '@/stores/uiStore'
import { basename } from '@/utils/path'
import { formatCount } from '@/utils/format'

/**
 * The Open With picker (PLAN.md §M25).
 *
 * Reached two ways, and they mean different things. File ▸ Open With… opens it
 * because the menu bar is built once in Go and cannot list applications that
 * depend on the selection; the context menu's Other… row opens it because the
 * submenu deliberately shows only what Launch Services suggests, and "the
 * application that is not on this list" is the case it cannot serve.
 *
 * So it shows both: what the system suggests for this file, and everything
 * installed.
 */
export function OpenWithDialog() {
  const job = useUiStore((state) => state.openWithJob)
  // Keyed on the selection, so re-opening on different files starts from their
  // suggestions rather than from the last search that was typed.
  return job ? <Picker key={job.paths.join(' ')} paths={job.paths} /> : null
}

function Picker({ paths }: { paths: string[] }) {
  const closeOpenWith = useUiStore((state) => state.closeOpenWith)

  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // The lead path decides the suggestions, matching the submenu: a mixed
  // selection is the user's decision, and the application will say what it
  // makes of it (§M25 decision 6).
  const lead = paths[0] ?? ''
  const { data: suggested, isPending: loadingSuggested } = useQuery(applicationsQuery(lead))
  const { data: standard } = useQuery(standardPathsQuery())
  const { data: installed, isPending: loadingInstalled } = useQuery(
    installedApplicationsQuery(applicationFolders(standard)),
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const needle = query.trim().toLowerCase()

  const suggestions = useMemo(
    () =>
      (suggested?.apps ?? []).filter((app) => applicationLabel(app).toLowerCase().includes(needle)),
    [suggested, needle],
  )

  // Everything installed *except* what is already offered above, so an
  // application never appears twice with the same name and no way to tell the
  // rows apart.
  const rest = useMemo(() => {
    const offered = new Set((suggested?.apps ?? []).map((app) => app.path))
    return (installed ?? [])
      .filter((app) => !offered.has(app.path))
      .filter((app) => applicationLabel(app).toLowerCase().includes(needle))
  }, [installed, suggested, needle])

  const open = (appPath: string | null) => {
    if (!appPath) return
    closeOpenWith()
    openWith(paths, appPath)
  }

  const title =
    paths.length === 1 && paths[0]
      ? `Open “${basename(paths[0])}” with`
      : `Open ${formatCount(paths.length, 'item')} with`

  const loading = loadingSuggested || loadingInstalled
  const empty = !loading && suggestions.length === 0 && rest.length === 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) closeOpenWith()
      }}
      onKeyDown={(event) => {
        // Stopped here as well as handled: the global registry would otherwise
        // read a bare keystroke typed into the search field as a command.
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          closeOpenWith()
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          open(chosen)
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-label="Open With"
        className="bg-elevated border-edge flex max-h-[75vh] w-[440px] flex-col rounded-xl border p-5 shadow-2xl"
      >
        <h2 className="font-display text-primary text-[15px] font-semibold">{title}</h2>
        <p className="text-secondary mt-1.5 text-[13px] leading-snug">
          The applications this Mac can open it with. Your choice applies once.
        </p>

        <input
          ref={inputRef}
          value={query}
          aria-label="Search applications"
          placeholder="Search…"
          onChange={(event) => setQuery(event.target.value)}
          className="border-edge bg-base text-primary mt-3 w-full rounded-md border px-2 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]"
        />

        <div
          role="listbox"
          aria-label="Applications"
          className="border-edge bg-base mt-3 min-h-0 flex-1 overflow-auto rounded-md border p-1"
        >
          {loading && (
            <div className="text-muted flex items-center gap-2 px-2 py-2 text-[13px]">
              <Loader2 size={14} className="animate-spin" />
              Looking for applications…
            </div>
          )}

          {empty && (
            <p className="text-muted px-2 py-2 text-[13px]">
              {query.trim() ? 'No application matches that.' : 'No applications available.'}
            </p>
          )}

          {suggestions.length > 0 && <Heading>Suggested</Heading>}
          {suggestions.map((app) => (
            <Row
              key={`suggested:${app.path}`}
              app={app}
              selected={chosen === app.path}
              onSelect={() => setChosen(app.path)}
              onOpen={() => open(app.path)}
            />
          ))}

          {rest.length > 0 && <Heading>All Applications</Heading>}
          {rest.map((app) => (
            <Row
              key={`all:${app.path}`}
              app={app}
              selected={chosen === app.path}
              onSelect={() => setChosen(app.path)}
              onOpen={() => open(app.path)}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={closeOpenWith}
            className="border-edge text-secondary hover:bg-hover hover:text-primary rounded-md border px-3 py-1.5 text-[13px] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => open(chosen)}
            disabled={!chosen}
            className="text-accent rounded-md bg-[var(--accent-glow)] px-3 py-1.5 text-[13px] transition-colors hover:opacity-90 disabled:opacity-40"
          >
            Open
          </button>
        </div>
      </div>
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted px-2 pt-2 pb-1 text-[11px] font-semibold tracking-[0.5px] uppercase">
      {children}
    </div>
  )
}

function Row({
  app,
  selected,
  onSelect,
  onOpen,
}: {
  app: Application
  selected: boolean
  onSelect: () => void
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      // A double-click is how a list like this is used, and the single click
      // above has already made the row the one Open would act on.
      onDoubleClick={onOpen}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors ${
        selected ? 'bg-accent text-on-accent' : 'text-primary hover:bg-hover'
      }`}
    >
      <span className="truncate">{applicationLabel(app)}</span>
      {app.isDefault && (
        <span className={`ml-auto shrink-0 text-[11px] ${selected ? '' : 'text-muted'}`}>
          default
        </span>
      )}
    </button>
  )
}
