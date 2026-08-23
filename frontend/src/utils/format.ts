/**
 * Display formatting — ported from the mockup's `formatSize` / `formatDate`.
 *
 * There is one spelling of a timestamp, and since §M22 it carries seconds: the
 * details view's Modified and Created columns and the preview panel show the
 * same file the same way, and a date alone could not tell two files saved a
 * minute apart from each other — which is most of what a Modified column is
 * read for.
 */

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024
const TB = GB * 1024

/** Matches the mockup: an em dash for zero/absent rather than "0 B". */
export function formatSize(bytes: number, placeholder = '—'): string {
  if (!bytes) return placeholder
  if (bytes < KB) return `${bytes} B`
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`
  if (bytes < TB) return `${(bytes / GB).toFixed(2)} GB`
  return `${(bytes / TB).toFixed(2)} TB`
}

// Built once, at module load: a listing formats two of these per row, and
// constructing a formatter is the expensive half of the work.
const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  // Seconds included, and 2-digit so the column does not jog left and right as
  // the value changes. `numeric` would render 7:05:3.
  second: '2-digit',
})

/** `timestamp` is unix epoch milliseconds; 0 means "unknown". */
export function formatDateTime(timestamp: number, placeholder = '—'): string {
  if (!timestamp) return placeholder
  return DATE_TIME_FORMAT.format(new Date(timestamp))
}

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`
}
