import { useEffect, useRef, useState } from 'react'
import { stem } from '@/utils/path'

/**
 * The in-place name editor (PLAN.md M6).
 *
 * Shared by the details rows and the icon tiles so the two cannot behave
 * differently. Two details make it feel native:
 *
 *  - Only the stem is preselected, so typing replaces "Report" and leaves
 *    ".pdf" intact. Renaming a file should not silently strip its extension.
 *  - Blur commits, matching Finder. Escape is the way to abandon an edit, so
 *    a click elsewhere never discards typing the user meant to keep.
 */
export function InlineRename({
  name,
  isDirectory,
  onCommit,
  onCancel,
}: {
  name: string
  isDirectory: boolean
  onCommit: (nextName: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(name)
  // Guards the blur handler: committing on Enter also blurs, which would
  // otherwise submit the same edit twice.
  const settled = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    // A folder has no extension to protect, so its whole name is selected.
    const selectable = isDirectory ? name.length : stem(name).length
    input.setSelectionRange(0, selectable || name.length)
  }, [name, isDirectory])

  const settle = (commit: boolean) => {
    if (settled.current) return
    settled.current = true
    if (commit) onCommit(value)
    else onCancel()
  }

  return (
    <input
      ref={inputRef}
      value={value}
      aria-label={`Rename ${name}`}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      // The row underneath selects on mousedown and opens on double-click;
      // without this, clicking into the field to fix a typo would do both.
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => settle(true)}
      onKeyDown={(event) => {
        // Arrows, type-ahead and Cmd+A belong to the text field while it is
        // open, not to the list underneath.
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          settle(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          settle(false)
        }
      }}
      className="border-accent bg-base text-primary min-w-0 flex-1 rounded border px-1 py-0.5 text-[13px] outline-none"
    />
  )
}
