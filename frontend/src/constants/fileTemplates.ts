/**
 * The templates that ship with the app (PLAN.md §M15).
 *
 * **A template earns its place only if the empty file would be wrong or
 * useless** (decision 7). That rule is doing real work here, and it cut the
 * plan's sketched list roughly in half: an empty `.css`, `.ts`, `.sql` or
 * `.yml` is a perfectly good place to start, so a template for one could only
 * contain filler the user has to delete first — which is worse than no template
 * at all. What survives is the set where an empty file is either *invalid*
 * (JSON), *inert* (a shell script with no shebang and no executable bit), or
 * missing boilerplate nobody wants to retype (an HTML skeleton, a React
 * component). Everything else is still one keystroke away: type `notes.css` and
 * you get an empty `.css`, which is the point of decision 2.
 *
 * Built-ins live in code rather than on disk so adding one needs no migration
 * and no seeding. Custom templates are real files the user writes — see
 * `services/templates/templateService.ts`.
 */

export interface FileTemplate {
  id: string
  label: string
  /**
   * The extension a file made from this gets — lowercase, no dot. Empty when
   * the template names a whole file instead.
   */
  extension: string
  /**
   * A fixed filename, for templates that are not "some name plus an extension".
   * `Dockerfile` and `.gitignore` are files with names, not types, and picking
   * one sets the whole name rather than just the suffix.
   */
  filename?: string
  content: string
  /** Written with the executable bits set, in the same call that creates it. */
  executable?: boolean
  source: 'builtin' | 'custom'
  /** Custom templates only: the file this came from, for Reveal in Finder. */
  path?: string
  /** Custom templates only: why it cannot be used. Listed anyway, and disabled. */
  problem?: string
}

/**
 * `{{name}}` is the stem of the file being created, so a template can title
 * itself. See `applyPlaceholders` for the whole vocabulary — four tokens, no
 * expressions, and anything unrecognised left alone.
 */
export const BUILTIN_TEMPLATES: FileTemplate[] = [
  {
    id: 'html',
    label: 'HTML Document',
    extension: 'html',
    source: 'builtin',
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{name}}</title>
  </head>
  <body>
    <h1>{{name}}</h1>
  </body>
</html>
`,
  },
  {
    id: 'markdown',
    label: 'Markdown Document',
    extension: 'md',
    source: 'builtin',
    content: `# {{name}}

`,
  },
  {
    id: 'json',
    label: 'JSON File',
    extension: 'json',
    source: 'builtin',
    // An empty file is not valid JSON; `{}` is the smallest thing that is.
    content: `{
}
`,
  },
  {
    id: 'react',
    label: 'React Component',
    extension: 'tsx',
    source: 'builtin',
    content: `export function {{name}}() {
  return <div>{{name}}</div>
}
`,
  },
  {
    id: 'python',
    label: 'Python Script',
    extension: 'py',
    source: 'builtin',
    content: `def main() -> None:
    pass


if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'shell',
    label: 'Shell Script',
    extension: 'sh',
    source: 'builtin',
    // The one template whose *mode* matters as much as its contents: without
    // both the shebang and the executable bit the file cannot be run.
    executable: true,
    content: `#!/usr/bin/env bash
set -euo pipefail

`,
  },
  {
    id: 'dockerfile',
    label: 'Dockerfile',
    extension: '',
    filename: 'Dockerfile',
    source: 'builtin',
    content: `FROM alpine:latest

WORKDIR /app

COPY . .

CMD ["sh"]
`,
  },
  {
    id: 'gitignore',
    label: 'Git Ignore',
    extension: '',
    filename: '.gitignore',
    source: 'builtin',
    content: `.DS_Store
node_modules/
dist/
*.log
`,
  },
]

/** The name a template suggests for a file whose stem is `stem`. */
export function nameFromTemplate(template: FileTemplate, stem: string): string {
  if (template.filename) return template.filename
  return template.extension ? `${stem}.${template.extension}` : stem
}

/**
 * The template a typed filename implies, if any.
 *
 * Matched on the whole name first, so `Dockerfile` finds its template rather
 * than being read as an extensionless stem. Custom templates are searched
 * before built-ins: someone who wrote their own `md` template meant to use it.
 */
export function templateForName(
  name: string,
  templates: readonly FileTemplate[],
): FileTemplate | undefined {
  const trimmed = name.trim()
  if (!trimmed) return undefined

  const lower = trimmed.toLowerCase()
  const byFilename = templates.find((template) => template.filename?.toLowerCase() === lower)
  if (byFilename) return byFilename

  const dot = trimmed.lastIndexOf('.')
  // A leading dot names a hidden file, it does not introduce an extension —
  // the same rule as `utils/path.extname`.
  if (dot <= 0) return undefined

  const extension = trimmed.slice(dot + 1).toLowerCase()
  if (!extension) return undefined
  return templates.find((template) => template.extension === extension)
}
