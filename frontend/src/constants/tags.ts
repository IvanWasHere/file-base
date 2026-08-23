/**
 * Finder tags, as data (PLAN.md §M22).
 *
 * The shape `columns`, `splitModes`, `themes` and `hashAlgorithms` already
 * have: what a tag colour *is* lives here, and how it draws lives in the
 * components. Nothing in this file imports React.
 *
 * A tag is a **name plus a colour index**, and the pair is what macOS stores in
 * the `com.apple.metadata:_kMDItemUserTags` extended attribute. The index is
 * kept as the number rather than translated to a colour name on the way in,
 * because the number is what is on disk — and because the user can rename
 * Finder's red tag to "Urgent" and keep the dot, which a colour-named model
 * could not express.
 */

/** Finder's palette. 0 is a tag with a name and no dot. */
export type TagColor = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface FileTag {
  name: string
  color: TagColor
}

export interface TagColorSpec {
  color: TagColor
  /** The colour's own name, and the label Finder gives its stock tag. */
  label: string
  /**
   * What the swatch is painted with. Literal hex rather than a theme token: a
   * tag colour is a fact about the file, not a part of the app's palette, and
   * Finder's red must stay Finder's red in both themes.
   */
  hex: string
}

/**
 * Registry order — Finder's own, which is the order its Tags menu lists them
 * and therefore the order the tag pickers here use. Note it is *not* index
 * order: the indices are historical, and sorting by them would put grey first.
 */
export const TAG_COLORS: TagColorSpec[] = [
  { color: 6, label: 'Red', hex: '#ff5f57' },
  { color: 7, label: 'Orange', hex: '#ff9f0a' },
  { color: 5, label: 'Yellow', hex: '#ffd60a' },
  { color: 2, label: 'Green', hex: '#32d74b' },
  { color: 4, label: 'Blue', hex: '#0a84ff' },
  { color: 3, label: 'Purple', hex: '#bf5af2' },
  { color: 1, label: 'Gray', hex: '#98989d' },
  // Last, and the only one with no dot: "a tag, no colour" is a real choice in
  // Finder and the default for a name the user types.
  { color: 0, label: 'None', hex: 'transparent' },
]

const BY_COLOR = new Map(TAG_COLORS.map((spec) => [spec.color, spec]))

export function isTagColor(value: unknown): value is TagColor {
  return typeof value === 'number' && BY_COLOR.has(value as TagColor)
}

export function tagColorSpec(color: TagColor): TagColorSpec {
  // Non-null: the map is built from the same list the union is written from.
  return BY_COLOR.get(color) as TagColorSpec
}

/**
 * The seven stock tags a fresh macOS account has, in Finder's order.
 *
 * Offered as one-click toggles in the tag picker. They are ordinary tags —
 * nothing distinguishes "Red" from a tag the user typed — so this is a
 * convenience list, not a separate concept.
 */
export const STOCK_TAGS: FileTag[] = TAG_COLORS.filter((spec) => spec.color !== 0).map((spec) => ({
  name: spec.label,
  color: spec.color,
}))

/** Tag identity, which is the name case-insensitively — as in Finder. */
export function tagKey(tag: FileTag): string {
  return tag.name.trim().toLowerCase()
}

export function hasTag(tags: readonly FileTag[], tag: FileTag): boolean {
  const key = tagKey(tag)
  return tags.some((candidate) => tagKey(candidate) === key)
}

/**
 * Repairs whatever came back from Go or from a stored row.
 *
 * The same treatment every persisted structure gets here (§M19 decision 11),
 * and for the same reason: this data is not ours. It comes from an extended
 * attribute any application on the machine can write, so a tag with no name, a
 * colour index outside the palette, or the same name twice are all things a
 * listing has to survive rather than assume away.
 */
export function normaliseTags(value: unknown): FileTag[] {
  if (!Array.isArray(value)) return []

  const tags: FileTag[] = []
  const seen = new Set<string>()

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as { name?: unknown; color?: unknown }

    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!name) continue

    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    tags.push({ name, color: isTagColor(raw.color) ? raw.color : 0 })
  }
  return tags
}

/** Adds a tag if absent, removes it if present. Identity is the name. */
export function toggleTag(tags: readonly FileTag[], tag: FileTag): FileTag[] {
  const key = tagKey(tag)
  return hasTag(tags, tag)
    ? tags.filter((candidate) => tagKey(candidate) !== key)
    : [...tags, { name: tag.name.trim(), color: tag.color }]
}

/**
 * How a tag set is compared and sorted: names, lowercased, joined.
 *
 * Sorting the Tags column needs *some* total order over sets, and the one that
 * reads correctly is alphabetical by the names shown — a file tagged "Admin"
 * sorts before one tagged "Work", and untagged files sort together at one end.
 */
export function tagSortValue(tags: readonly FileTag[]): string {
  return tags
    .map((tag) => tag.name.toLowerCase())
    .sort()
    .join(', ')
}
