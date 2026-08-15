import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { TemplateList } from './TemplateList'
import {
  BUILTIN_TEMPLATES,
  nameFromTemplate,
  templateForName,
  type FileTemplate,
} from '@/constants/fileTemplates'
import { useFileOperations } from '@/hooks/useFileOperations'
import { bridge } from '@/services/bridge'
import { fsKeys, standardPathsQuery, templatesQuery } from '@/services/filesystem/queries'
import { applyPlaceholders } from '@/services/templates/templateService'
import { useUiStore } from '@/stores/uiStore'
import type { FileItem } from '@/types/file'
import { extname, stem } from '@/utils/path'

/**
 * Create a file of any type, immediately (PLAN.md §M15).
 *
 * **The name field is the feature; the template list is an assist.** Typing
 * `notes.md` and pressing Enter is the whole interaction — the extension finds
 * the Markdown template on its own. Picking from the list works the other way,
 * filling in the extension and leaving the stem alone. Neither is a mode, and
 * neither is required: `foo.xyz` with no matching template creates an empty
 * `.xyz`, which is what "any type" has to mean (decision 2).
 *
 * Cmd+N is untouched and still makes an `untitled file` in one keystroke
 * (decision 1). This is the second route, not a replacement.
 */
export function NewFileDialog() {
  const request = useUiStore((state) => state.newFile)
  // Split so the hook only ever runs with somewhere to create: mounting the
  // panel is what reads the templates folder.
  if (!request) return null
  return <NewFilePanel parent={request.parent} paneId={request.paneId} />
}

function NewFilePanel({ parent, paneId }: { parent: string; paneId: string }) {
  const close = useUiStore((state) => state.closeNewFile)
  const lastTemplate = useUiStore((state) => state.lastTemplate)
  const setLastTemplate = useUiStore((state) => state.setLastTemplate)

  const operations = useFileOperations()
  const queryClient = useQueryClient()

  const { data: paths } = useQuery(standardPathsQuery())
  const { data: custom } = useQuery(templatesQuery(paths?.templates ?? ''))

  // Custom first, so someone's own `md` template outranks the built-in one.
  const templates = useMemo(() => [...(custom ?? []), ...BUILTIN_TEMPLATES], [custom])

  const [name, setName] = useState('')
  // Empty means None. Held separately from the name so that typing an extension
  // can *suggest* a template without locking the two together.
  const [templateId, setTemplateId] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // The template last used is preselected once the list it names has loaded —
  // someone making ten `.tsx` files a day should pay for the choice once
  // (decision 13). Adjusted during render rather than in an effect, so it is
  // true of the first frame the list exists on; and skipped once the field has
  // been typed in, so a slow read can never overrule a choice already made.
  const [restored, setRestored] = useState(false)
  if (!restored && custom !== undefined) {
    setRestored(true)
    if (name === '' && templates.some((template) => template.id === lastTemplate)) {
      setTemplateId(lastTemplate)
    }
  }

  const selected = templates.find((template) => template.id === templateId)

  /**
   * What the listing already read, so a collision is known before the disk is.
   * Both hidden-file variants, because which one the pane populated depends on
   * a setting this dialog has nothing to do with — the same lookup `createEntry`
   * does for its untitled names.
   */
  const siblings =
    queryClient.getQueryData<FileItem[]>(fsKeys.directory(parent, true)) ??
    queryClient.getQueryData<FileItem[]>(fsKeys.directory(parent, false))
  const trimmed = name.trim()
  const taken =
    trimmed.length > 0 &&
    (siblings ?? []).some((item) => item.name.toLowerCase() === trimmed.toLowerCase())

  const pickTemplate = (template: FileTemplate | null): void => {
    setTemplateId(template?.id ?? '')
    setFailure('')
    // Fills in the extension and keeps the stem, which is the half of decision 2
    // that runs in this direction. An untouched field takes the whole suggested
    // name so picking Dockerfile alone is enough to create one.
    if (template)
      setName((current) => nameFromTemplate(template, stem(current.trim()) || 'untitled'))
    inputRef.current?.focus()
  }

  const typeName = (value: string): void => {
    setName(value)
    setFailure('')

    // Typing a name picks the template it implies — the other half of
    // decision 2.
    const implied = templateForName(value, templates)
    if (implied && !implied.problem) {
      setTemplateId(implied.id)
      return
    }

    // Nothing implied. A template only survives that if the name does not
    // *contradict* it: typing `readings.opml` while a Markdown template is
    // selected has to produce an empty `.opml`, because "any type" is the whole
    // claim of the feature — writing someone's Markdown boilerplate into an
    // OPML file is the opposite of it. An extensionless name contradicts
    // nothing, so picking a template and typing `LICENSE` still uses it.
    const typed = extname(value.trim())
    if (typed && selected && selected.extension !== typed) setTemplateId('')
  }

  const submit = async (): Promise<void> => {
    if (!trimmed || taken || busy) return
    setBusy(true)

    const content = selected?.content
      ? applyPlaceholders(selected.content, trimmed, new Date())
      : ''
    const created = await operations.createFromTemplate(
      parent,
      paneId,
      trimmed,
      content,
      selected?.executable === true,
    )

    setBusy(false)
    if (!created) {
      // The optimistic helper has already raised a toast; this is the field
      // saying so too, since that is where the user is looking.
      setFailure('Could not create that file here.')
      return
    }

    setLastTemplate(selected?.id ?? '')
    close()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) close()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-label="New File"
        className="bg-elevated border-edge flex h-[60vh] max-h-[460px] w-[720px] max-w-[94vw] flex-col overflow-hidden rounded-xl border shadow-2xl"
      >
        <div className="border-edge shrink-0 border-b px-4 py-2.5">
          <h2 className="font-display text-primary text-[15px] font-semibold">New File</h2>
        </div>

        <div className="flex min-h-0 flex-1">
          <TemplateList
            templates={templates}
            selectedId={templateId}
            onSelect={pickTemplate}
            onRevealFolder={() => {
              if (paths?.templates) void bridge.shell.revealInFinder(paths.templates)
            }}
          />

          <div className="flex min-w-0 flex-1 flex-col p-4">
            <label className="text-secondary text-[12px]" htmlFor="new-file-name">
              Name
            </label>
            <input
              id="new-file-name"
              ref={inputRef}
              value={name}
              spellCheck={false}
              autoComplete="off"
              placeholder="notes.md"
              onChange={(event) => typeName(event.target.value)}
              onKeyDown={(event) => {
                // The list behind the dialog treats letters as type-ahead, so a
                // focused field keeps its keystrokes to itself — which means
                // Escape has to be handled here too, or it never reaches the
                // backdrop that would otherwise close the dialog.
                event.stopPropagation()
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void submit()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  close()
                }
              }}
              className="border-edge bg-base text-primary mt-1 rounded-md border px-2 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]"
            />

            <p className="text-muted mt-1.5 min-h-[2.5em] text-[11px] leading-tight">
              {taken ? (
                // Reported, never silently renamed: the user typed this name,
                // and creating `notes copy.md` answers a question they did not
                // ask (decision 11).
                <span className="text-[var(--danger)]">
                  “{trimmed}” already exists here. Choose another name.
                </span>
              ) : failure ? (
                <span className="text-[var(--danger)]">{failure}</span>
              ) : selected ? (
                <>
                  From {selected.label}
                  {selected.executable ? ', executable' : ''}. Enter to create.
                </>
              ) : (
                <>An empty file. Type an extension to pick a template.</>
              )}
            </p>

            <div className="mt-auto flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="border-edge text-secondary hover:bg-hover hover:text-primary rounded-md border px-3 py-1.5 text-[13px] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!trimmed || taken || busy}
                className="text-accent rounded-md bg-[var(--accent-glow)] px-3 py-1.5 text-[13px] transition-colors hover:opacity-90 disabled:cursor-default disabled:opacity-30"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
