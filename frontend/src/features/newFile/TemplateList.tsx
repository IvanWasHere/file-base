import { AlertTriangle, FileCode, FolderOpen } from 'lucide-react'
import type { FileTemplate } from '@/constants/fileTemplates'

/**
 * The template column of the new-file dialog (PLAN.md §M15).
 *
 * Custom templates come first — someone who wrote their own `md` template meant
 * to use it — and "None" is a real entry rather than an absence, because
 * creating an empty file of a chosen type is the feature, not a fallback
 * (decision 2).
 *
 * A template that cannot be used is listed with the reason and disabled, not
 * hidden: a template silently missing from the list looks like a bug in the
 * app, and the user is the one who has to go fix the file (decision 14).
 */
export function TemplateList({
  templates,
  selectedId,
  onSelect,
  onRevealFolder,
}: {
  templates: readonly FileTemplate[]
  /** Empty means "None" — an empty file of whatever type the name implies. */
  selectedId: string
  onSelect: (template: FileTemplate | null) => void
  onRevealFolder: () => void
}) {
  const custom = templates.filter((template) => template.source === 'custom')
  const builtin = templates.filter((template) => template.source === 'builtin')

  const row = (template: FileTemplate) => {
    const selected = template.id === selectedId
    const disabled = template.problem !== undefined

    return (
      <button
        key={template.id}
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        {...(template.problem ? { title: template.problem } : {})}
        onClick={() => onSelect(template)}
        className={`flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors disabled:cursor-default disabled:opacity-45 ${
          selected
            ? 'text-accent bg-[var(--accent-glow)]'
            : 'text-secondary enabled:hover:bg-hover enabled:hover:text-primary'
        }`}
      >
        <span className="w-full truncate text-[13px]">{template.label}</span>
        {template.problem ? (
          <span className="flex items-center gap-1 text-[10px] leading-tight text-[var(--danger)]">
            <AlertTriangle size={9} className="shrink-0" />
            {template.problem}
          </span>
        ) : (
          <span className="text-muted text-[10px] leading-tight">
            {template.filename ?? (template.extension ? `.${template.extension}` : 'no extension')}
            {template.executable ? ' · executable' : ''}
          </span>
        )}
      </button>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label="Template"
      className="border-edge bg-base flex w-56 shrink-0 flex-col overflow-y-auto border-r py-2"
    >
      <button
        type="button"
        role="radio"
        aria-checked={selectedId === ''}
        onClick={() => onSelect(null)}
        className={`flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors ${
          selectedId === ''
            ? 'text-accent bg-[var(--accent-glow)]'
            : 'text-secondary hover:bg-hover hover:text-primary'
        }`}
      >
        <span className="text-[13px]">None</span>
        <span className="text-muted text-[10px] leading-tight">An empty file</span>
      </button>

      {custom.length > 0 && (
        <>
          <h3 className="text-muted px-3 pt-3 pb-1 text-[10px] font-semibold tracking-wide uppercase">
            Yours
          </h3>
          {custom.map(row)}
        </>
      )}

      <h3 className="text-muted px-3 pt-3 pb-1 text-[10px] font-semibold tracking-wide uppercase">
        Built in
      </h3>
      {builtin.map(row)}

      {/* Always present, so there is a way into the folder even when it is
          empty — which is how it starts, since nothing is seeded there. */}
      <button
        type="button"
        onClick={onRevealFolder}
        className="text-muted hover:bg-hover hover:text-primary mt-3 flex items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors"
      >
        <FolderOpen size={12} className="shrink-0" />
        Reveal Templates Folder
      </button>
      <p className="text-muted px-3 pt-1 text-[10px] leading-tight">
        <FileCode size={9} className="mr-1 inline" />
        Any file you put there becomes a template.
      </p>
    </div>
  )
}
