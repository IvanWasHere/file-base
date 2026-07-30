/**
 * POSIX path helpers. macOS-only, so no separator abstraction.
 *
 * These are pure string operations and stay in TypeScript by design — asking Go
 * to split a path would be exactly the kind of logic the PRD keeps out of it.
 */

export const SEPARATOR = '/'
export const ROOT = '/'

/** Removes trailing slashes, collapses doubles. Never returns an empty string. */
export function normalize(path: string): string {
  if (!path) return ROOT
  const collapsed = path.replace(/\/+/g, SEPARATOR)
  if (collapsed === ROOT) return ROOT
  return collapsed.endsWith(SEPARATOR) ? collapsed.slice(0, -1) : collapsed
}

export function basename(path: string): string {
  const normalized = normalize(path)
  if (normalized === ROOT) return ROOT
  return normalized.slice(normalized.lastIndexOf(SEPARATOR) + 1)
}

export function dirname(path: string): string {
  const normalized = normalize(path)
  if (normalized === ROOT) return ROOT
  const index = normalized.lastIndexOf(SEPARATOR)
  if (index <= 0) return ROOT
  return normalized.slice(0, index)
}

export function join(...segments: string[]): string {
  const joined = segments.filter(Boolean).join(SEPARATOR)
  return normalize(joined.startsWith(SEPARATOR) ? joined : SEPARATOR + joined)
}

/** Lowercase extension without the dot. Dotfiles have no extension. */
export function extname(name: string): string {
  const index = name.lastIndexOf('.')
  if (index <= 0) return ''
  return name.slice(index + 1).toLowerCase()
}

/** Name without its extension — the part inline rename should preselect. */
export function stem(name: string): string {
  const index = name.lastIndexOf('.')
  if (index <= 0) return name
  return name.slice(0, index)
}

export function isHiddenName(name: string): boolean {
  return name.startsWith('.')
}

/**
 * Breadcrumb segments, root first. Replaces the mockup's `buildPath`, which had
 * to walk the database one parent at a time; a path already contains its
 * ancestry, so this is synchronous and free.
 */
export function toSegments(path: string): { name: string; path: string }[] {
  const normalized = normalize(path)
  if (normalized === ROOT) return [{ name: ROOT, path: ROOT }]

  const parts = normalized.split(SEPARATOR).filter(Boolean)
  const segments: { name: string; path: string }[] = [{ name: ROOT, path: ROOT }]
  let accumulated = ''
  for (const part of parts) {
    accumulated += SEPARATOR + part
    segments.push({ name: part, path: accumulated })
  }
  return segments
}

/** True when `child` is `parent` or sits underneath it. Guards move-into-self. */
export function isAncestor(parent: string, child: string): boolean {
  const a = normalize(parent)
  const b = normalize(child)
  if (a === b) return true
  return b.startsWith(a === ROOT ? ROOT : a + SEPARATOR)
}

/** "Report.pdf" → "Report copy.pdf" → "Report copy 2.pdf" (Finder's scheme). */
export function nextAvailableName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name

  const extension = extname(name)
  const suffix = extension ? `.${extension}` : ''
  const base = extension ? stem(name) : name

  const existing = /^(.*) copy(?: (\d+))?$/.exec(base)
  const root = existing?.[1] ?? base

  let candidate = `${root} copy${suffix}`
  let counter = 2
  while (taken.has(candidate)) {
    candidate = `${root} copy ${counter}${suffix}`
    counter += 1
  }
  return candidate
}
