/**
 * Custom file templates, and the placeholder substitution both kinds share
 * (PLAN.md §M15).
 *
 * **Custom templates are files, not rows.** This is a file explorer: someone
 * who wants their own template should write one, in whatever they already use,
 * and drop it in a folder. That costs no migration, no template-editor UI and
 * no export format, and the templates are portable and syncable for free
 * (decision 8). A template's name is its filename, its content is its bytes,
 * its extension is its own, and its executable bit is its own.
 *
 * Nothing new was needed from Go: `readDirectory` and `readTextFile` already
 * exist, and the executable bit is already in `FileItem.permissions`. Only the
 * folder's *location* is new, and that comes from `StandardPaths` because paths
 * are resolved natively rather than string-built here (PLAN.md §1).
 */

import { BUILTIN_TEMPLATES, type FileTemplate } from '@/constants/fileTemplates'
import { bridge } from '@/services/bridge'
import { basename, dirname, stem as stemOf } from '@/utils/path'

/**
 * A template is a starting point someone will read, so a megabyte is already
 * far past reasonable. Files above it are listed with the reason rather than
 * hidden, because a template silently missing looks like a bug in the app.
 */
const MAX_TEMPLATE_BYTES = 1024 * 1024

/**
 * Creates the templates folder if it is not there, including any missing
 * parents.
 *
 * Recursive because `createFolder` takes a parent that must already exist, and
 * on a fresh install the app-support folder may not — it is normally created by
 * whichever of the database or this runs first. Failures are swallowed: a
 * missing folder means no custom templates, which the dialog already handles,
 * and is never a reason to refuse to open.
 */
export async function ensureTemplatesFolder(path: string): Promise<void> {
  if (!path) return
  try {
    if (await bridge.fs.exists(path)) return
  } catch {
    return
  }

  const parent = dirname(path)
  if (parent && parent !== path) await ensureTemplatesFolder(parent)

  try {
    await bridge.fs.createFolder(parent, basename(path))
  } catch {
    // Already there, or not creatable. Either way the read below decides.
  }
}

/**
 * Detects a file that is not text.
 *
 * `readTextFile` replaces invalid UTF-8 with U+FFFD rather than failing, so a
 * binary dropped into the folder arrives as a string full of replacement
 * characters instead of an error. A NUL byte is the other tell — it survives
 * that replacement because it is valid UTF-8.
 *
 * A genuine text file containing U+FFFD would be a false positive. It is worth
 * it: the cost is one template refused with a reason on screen, and the
 * alternative is pasting a binary into a source file.
 */
function looksBinary(content: string): boolean {
  return content.includes('�') || content.includes('\0')
}

/**
 * Reads the templates folder.
 *
 * Never throws. A broken template must not stop the dialog opening — the rule
 * that keeps one dangling symlink from making a directory unlistable (§M1),
 * applied to a folder the user maintains by hand (decision 14). A template that
 * cannot be used is returned carrying its `problem`, so the list can say why
 * instead of quietly being one shorter.
 */
export async function loadCustomTemplates(folder: string): Promise<FileTemplate[]> {
  if (!folder) return []

  let entries
  try {
    entries = await bridge.fs.readDirectory(folder, { includeHidden: true })
  } catch {
    // No folder yet, or unreadable. The built-ins still work.
    return []
  }

  const templates: FileTemplate[] = []

  for (const entry of entries) {
    if (entry.isDirectory || entry.broken) continue

    const base: FileTemplate = {
      id: `custom:${entry.path}`,
      label: entry.name,
      extension: entry.extension,
      content: '',
      source: 'custom',
      path: entry.path,
      // Straight off the mode string the listing already carries — if your
      // template file is executable, so is the file made from it.
      ...(entry.permissions.includes('x') ? { executable: true } : {}),
      // A template named `Dockerfile` should offer that whole name, exactly as
      // the built-in one does; a template named `note.md` offers its extension.
      ...(entry.extension ? {} : { filename: entry.name }),
    }

    if (entry.size > MAX_TEMPLATE_BYTES) {
      templates.push({ ...base, problem: 'Too large to use as a template' })
      continue
    }

    try {
      const content = await bridge.fs.readTextFile(entry.path, MAX_TEMPLATE_BYTES)
      if (looksBinary(content)) {
        templates.push({ ...base, problem: 'Not a text file' })
        continue
      }
      templates.push({ ...base, content })
    } catch {
      templates.push({ ...base, problem: 'Could not be read' })
    }
  }

  return templates.sort((a, b) => a.label.localeCompare(b.label))
}

/** Custom first, so someone's own `md` template outranks the built-in one. */
export function allTemplates(custom: readonly FileTemplate[]): FileTemplate[] {
  return [...custom, ...BUILTIN_TEMPLATES]
}

/**
 * Substitutes the four placeholders.
 *
 * Four tokens, no expressions, nothing user-defined: a LICENSE without
 * `{{year}}` is half-useful, and a template language is a slope with no natural
 * stopping point. Anything needing logic is a script, not a template.
 *
 * **An unrecognised `{{token}}` is left exactly as it is**, which is not
 * politeness. Handlebars, Jinja and Go templates all use those braces, so a
 * template *for* one of those files would otherwise be gutted by the thing
 * meant to produce it.
 *
 * `now` is injected rather than read from the clock inline, so tests stay
 * deterministic — the same pattern `startPersistence` uses.
 */
export function applyPlaceholders(content: string, fileName: string, now: Date): string {
  const date = new Date(now)
  const pad = (value: number): string => String(value).padStart(2, '0')

  const values: Record<string, string> = {
    name: stemOf(fileName),
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    year: String(date.getFullYear()),
  }

  return content.replace(/\{\{(\w+)\}\}/g, (match, token: string) => values[token] ?? match)
}
