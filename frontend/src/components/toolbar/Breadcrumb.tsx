import { ChevronRight, HardDrive } from 'lucide-react'
import { toSegments } from '@/utils/path'

/**
 * The mockup's `.breadcrumb`, ported.
 *
 * `toSegments` is synchronous — a path already contains its ancestry — where
 * the mockup's `buildPath` had to walk the database one parent at a time.
 */
export function Breadcrumb({
  path,
  onNavigate,
  compact = false,
}: {
  path: string
  onNavigate: (path: string) => void
  compact?: boolean
}) {
  const segments = toSegments(path)

  return (
    <nav
      aria-label="Breadcrumb"
      className={
        compact
          ? 'flex min-w-0 flex-1 items-center gap-1 overflow-hidden'
          : 'bg-base border-edge flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden rounded-md border px-2.5 py-1 text-[13px]'
      }
    >
      {segments.map((segment, index) => {
        const last = index === segments.length - 1
        return (
          <span key={segment.path} className="flex min-w-0 items-center gap-0.5">
            {index > 0 && (
              <ChevronRight size={compact ? 10 : 11} className="text-muted shrink-0" />
            )}
            <button
              type="button"
              onClick={() => onNavigate(segment.path)}
              className={`hover:text-accent hover:bg-[var(--accent-glow)] truncate rounded px-1 py-0.5 transition-colors ${
                last ? 'text-primary font-medium' : 'text-secondary'
              }`}
            >
              {segment.path === '/' ? (
                <HardDrive size={compact ? 10 : 12} className="inline" aria-label="Macintosh HD" />
              ) : (
                segment.name
              )}
            </button>
          </span>
        )
      })}
    </nav>
  )
}
