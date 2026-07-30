import { Lock, RefreshCw, TriangleAlert } from 'lucide-react'
import { describeFsError, type FsError } from '@/types/errors'

/**
 * Filesystem errors rendered in place of a listing.
 *
 * `permission-denied` gets its own treatment: on macOS it almost always means a
 * TCC consent prompt was declined for Desktop/Documents/Downloads, which is
 * fixed in System Settings rather than by retrying (PLAN.md §3).
 */
export function DirectoryError({ error, onRetry }: { error: FsError; onRetry: () => void }) {
  const privacy = error.isPrivacyBlock

  return (
    <div className="text-muted flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      {privacy ? (
        <Lock size={32} strokeWidth={1.25} className="text-accent opacity-70" />
      ) : (
        <TriangleAlert size={32} strokeWidth={1.25} className="opacity-50" />
      )}

      <p className="text-primary max-w-sm text-[13px]">{describeFsError(error)}</p>

      {privacy && (
        <p className="max-w-sm text-xs">
          Open System Settings → Privacy &amp; Security → Files and Folders, and allow access for
          this app.
        </p>
      )}

      {error.path && <code className="text-[11px] opacity-60">{error.path}</code>}

      <button
        type="button"
        onClick={onRetry}
        className="border-edge hover:bg-hover hover:text-primary mt-1 flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors"
      >
        <RefreshCw size={12} />
        Try again
      </button>
    </div>
  )
}
