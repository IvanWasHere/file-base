import { tagColorSpec, type FileTag } from '@/constants/tags'

/**
 * A file's tags, as Finder draws them: coloured dots followed by the names.
 *
 * Shared by the Tags column and the preview panel, which is why it lives in
 * `components/common` rather than beside either of them.
 *
 * The dots carry no text of their own — a screen reader would otherwise hear
 * "Red Red" for a stock tag — so the whole strip is labelled once and the names
 * do the announcing.
 */
export function TagDots({ tags, max = 4 }: { tags: readonly FileTag[]; max?: number }) {
  // An em dash rather than nothing, matching Size and Modified: an empty cell
  // in a table reads as missing data rather than as "none".
  if (tags.length === 0) return <span className="text-muted">—</span>

  const shown = tags.slice(0, max)
  const overflow = tags.length - shown.length

  return (
    <span
      className="flex min-w-0 items-center gap-1.5"
      aria-label={`Tags: ${tags.map((tag) => tag.name).join(', ')}`}
    >
      <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
        {shown.map((tag) => (
          <TagDot key={tag.name} tag={tag} />
        ))}
      </span>
      <span className="truncate" aria-hidden>
        {shown.map((tag) => tag.name).join(', ')}
        {overflow > 0 && ` +${overflow}`}
      </span>
    </span>
  )
}

/**
 * One dot. A colourless tag (index 0) is drawn as a ring rather than as nothing
 * at all: it is still a tag, and an invisible marker beside a name would look
 * like a rendering bug.
 */
export function TagDot({ tag, size = 8 }: { tag: FileTag; size?: number }) {
  const spec = tagColorSpec(tag.color)
  return (
    <span
      data-testid={`tag-dot-${tag.name}`}
      style={{
        width: size,
        height: size,
        backgroundColor: tag.color === 0 ? 'transparent' : spec.hex,
        boxShadow: tag.color === 0 ? 'inset 0 0 0 1.5px var(--text-muted)' : undefined,
      }}
      className="inline-block shrink-0 rounded-full"
    />
  )
}
