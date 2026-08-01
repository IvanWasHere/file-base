import { Loader2, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  DATE_LABELS,
  SIZE_LABELS,
  hasActiveFilters,
  parseExtensions,
  type DateBucket,
  type KindFilter,
  type SizeBucket,
} from '@/services/search/criteria'
import { IndexControl } from '@/features/search/IndexControl'
import { usePaneSearch, useSearchStore, type SearchScope } from '@/stores/searchStore'

/**
 * The search bar for one pane (PLAN.md M8).
 *
 * Scope is a visible two-state control rather than something inferred: "filter
 * this folder" and "walk every subfolder" differ by orders of magnitude in cost,
 * and guessing which one someone meant would make the app feel unpredictable.
 */

const SCOPES: { value: SearchScope; label: string; hint: string }[] = [
  { value: 'folder', label: 'This Folder', hint: 'Filter the current folder' },
  { value: 'recursive', label: 'Subfolders', hint: 'Search every subfolder' },
]

const KINDS: { value: KindFilter; label: string }[] = [
  { value: 'any', label: 'All items' },
  { value: 'file', label: 'Files only' },
  { value: 'folder', label: 'Folders only' },
]

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px]">
      <span className="text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="border-edge bg-base text-secondary rounded border px-1.5 py-1 text-[11px] outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function SearchBar({ paneId, root }: { paneId: string; root: string }) {
  const search = usePaneSearch(paneId)
  const setQuery = useSearchStore((state) => state.setQuery)
  const setScope = useSearchStore((state) => state.setScope)
  const setFilters = useSearchStore((state) => state.setFilters)
  const close = useSearchStore((state) => state.close)

  const inputRef = useRef<HTMLInputElement>(null)
  const [showFilters, setShowFilters] = useState(false)
  // Kept as raw text so a half-typed "pn" does not become an extension filter
  // between keystrokes.
  const [extensionText, setExtensionText] = useState(search.filters.extensions.join(' '))

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtersActive = hasActiveFilters(search.filters)

  return (
    <div className="bg-elevated border-edge shrink-0 border-b px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="search"
          value={search.query}
          aria-label="Search"
          placeholder={search.scope === 'folder' ? 'Filter this folder…' : 'Search subfolders…'}
          onChange={(event) => setQuery(paneId, event.target.value)}
          onKeyDown={(event) => {
            // The list underneath treats letters as type-ahead and Escape as
            // "clear selection"; neither belongs to a focused search field.
            event.stopPropagation()
            if (event.key === 'Escape') {
              event.preventDefault()
              close(paneId)
            }
          }}
          className="border-edge bg-base text-primary min-w-0 flex-1 rounded-md border px-2 py-1 text-[13px] outline-none focus:border-[var(--accent)]"
        />

        <div
          role="group"
          aria-label="Search scope"
          className="bg-base border-edge flex shrink-0 gap-0.5 rounded-md border p-0.5"
        >
          {SCOPES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={search.scope === option.value}
              title={option.hint}
              onClick={() => setScope(paneId, option.value)}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                search.scope === option.value
                  ? 'text-accent bg-[var(--accent-glow)]'
                  : 'text-muted hover:text-primary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          aria-label="Filters"
          aria-pressed={showFilters}
          title="Filters"
          onClick={() => setShowFilters((open) => !open)}
          className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors ${
            showFilters || filtersActive
              ? 'text-accent bg-[var(--accent-glow)]'
              : 'text-secondary hover:bg-hover hover:text-primary'
          }`}
        >
          <SlidersHorizontal size={14} />
        </button>

        {search.status === 'running' && (
          <Loader2 size={13} className="text-muted shrink-0 animate-spin" />
        )}

        <button
          type="button"
          aria-label="Close search"
          onClick={() => close(paneId)}
          className="text-muted hover:text-primary flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {showFilters && (
        <div className="mt-1.5 flex flex-wrap items-center gap-3 pl-0.5">
          <Select
            label="Show"
            value={search.filters.kind}
            options={KINDS}
            onChange={(kind) => setFilters(paneId, { ...search.filters, kind })}
          />
          <Select
            label="Size"
            value={search.filters.size}
            options={Object.entries(SIZE_LABELS).map(([value, label]) => ({
              value: value as SizeBucket,
              label,
            }))}
            onChange={(size) => setFilters(paneId, { ...search.filters, size })}
          />
          <Select
            label="Modified"
            value={search.filters.modified}
            options={Object.entries(DATE_LABELS).map(([value, label]) => ({
              value: value as DateBucket,
              label,
            }))}
            onChange={(modified) => setFilters(paneId, { ...search.filters, modified })}
          />

          <label className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted">Type</span>
            <input
              value={extensionText}
              aria-label="Extensions"
              placeholder="png jpg"
              onChange={(event) => {
                setExtensionText(event.target.value)
                setFilters(paneId, {
                  ...search.filters,
                  extensions: parseExtensions(event.target.value),
                })
              }}
              onKeyDown={(event) => event.stopPropagation()}
              className="border-edge bg-base text-secondary w-24 rounded border px-1.5 py-1 text-[11px] outline-none"
            />
          </label>

          <label className="text-muted flex items-center gap-1.5 text-[11px]">
            <input
              type="checkbox"
              checked={search.filters.includeHidden}
              onChange={(event) =>
                setFilters(paneId, { ...search.filters, includeHidden: event.target.checked })
              }
            />
            Hidden files
          </label>

          {/* Offered where the cost is about to be paid, not in a settings pane. */}
          {search.scope === 'recursive' && <IndexControl root={root} />}
        </div>
      )}
    </div>
  )
}
