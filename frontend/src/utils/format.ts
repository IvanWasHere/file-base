/** Display formatting — ported from the mockup's `formatSize` / `formatDate`. */

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

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** `timestamp` is unix epoch milliseconds; 0 means "unknown". */
export function formatDate(timestamp: number, placeholder = '—'): string {
  if (!timestamp) return placeholder
  return DATE_FORMAT.format(new Date(timestamp))
}

export function formatDateTime(timestamp: number, placeholder = '—'): string {
  if (!timestamp) return placeholder
  return DATE_TIME_FORMAT.format(new Date(timestamp))
}

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`
}
