import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  CREATE_FORMATS,
  READ_ONLY_FORMATS,
  SPLIT_SIZES_MB,
  encryptable,
  formatById,
} from '@/constants/archiveFormats'
import { startCreate } from '@/services/archives/archiveService'
import { fsKeys } from '@/services/filesystem/queries'
import { toast } from '@/stores/toastStore'
import { useUiStore } from '@/stores/uiStore'
import { describeFsError, isFsError } from '@/types/errors'
import { basename } from '@/utils/path'
import { formatSize } from '@/utils/format'

/**
 * Compress a selection (PLAN.md §M18).
 *
 * Three controls, each of which is a decision the plan argued for: the format
 * (with 7z and rar named as unwritable rather than silently missing), a
 * password that appears only where it means something, and splitting that says
 * what it really produces.
 */
export function CompressDialog() {
  const request = useUiStore((state) => state.compress)
  // Split so the job only ever starts with something to compress.
  if (!request) return null
  return <CompressPanel sources={request.sources} parent={request.parent} />
}

function CompressPanel({ sources, parent }: { sources: string[]; parent: string }) {
  const close = useUiStore((state) => state.closeCompress)
  const queryClient = useQueryClient()

  const suggested =
    sources.length === 1 ? basename(sources[0] ?? '') || 'archive' : basename(parent) || 'archive'

  const [name, setName] = useState(suggested)
  const [format, setFormat] = useState('zip')
  const [password, setPassword] = useState('')
  const [splitMb, setSplitMb] = useState(0)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const cancelRef = useRef<(() => void) | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Cancelling on unmount is what makes closing the dialog mean stop, rather
  // than leaving a job writing an archive nobody is waiting for.
  useEffect(() => () => cancelRef.current?.(), [])

  const spec = formatById(format)
  const running = progress !== null
  const canEncrypt = encryptable(format)

  const start = (): void => {
    const trimmed = name.trim()
    if (!trimmed || running || !spec) return

    setProgress({ done: 0, total: 0 })
    cancelRef.current = startCreate(
      {
        sources,
        destination: `${parent}/${trimmed}${spec.extension}`,
        format,
        level: 5,
        password: canEncrypt ? password : '',
        splitBytes: splitMb * 1024 * 1024,
      },
      {
        onProgress: (event) => setProgress({ done: event.done, total: event.total }),
        onDone: (done) => {
          setProgress(null)
          if (done.cancelled) return
          if (done.error) {
            toast.error('Could not create the archive', describeFsError(done.error))
            return
          }
          toast.success(`Created ${basename(done.path)}`)
          void queryClient.invalidateQueries({ queryKey: fsKeys.directoryRoot(parent) })
          close()
        },
        onFailed: (error) => {
          setProgress(null)
          toast.error(
            'Could not create the archive',
            isFsError(error) ? describeFsError(error) : undefined,
          )
        },
      },
    )
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-6"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) close()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-label="Compress"
        className="bg-elevated border-edge w-[460px] rounded-xl border p-5 shadow-2xl"
      >
        <h2 className="font-display text-primary text-[15px] font-semibold">Compress</h2>
        <p className="text-secondary mt-1 text-[13px]">
          {sources.length === 1 ? '1 item' : `${sources.length} items`}
        </p>

        <label className="text-secondary mt-4 block text-[12px]" htmlFor="archive-name">
          Name
        </label>
        <div className="mt-1 flex items-center gap-1">
          <input
            id="archive-name"
            ref={inputRef}
            value={name}
            spellCheck={false}
            disabled={running}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') {
                event.preventDefault()
                start()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                close()
              }
            }}
            className="border-edge bg-base text-primary min-w-0 flex-1 rounded-md border px-2 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]"
          />
          <span className="text-muted shrink-0 font-mono text-[12px]">{spec?.extension}</span>
        </div>

        <label className="text-secondary mt-3 block text-[12px]" htmlFor="archive-format">
          Format
        </label>
        <select
          id="archive-format"
          value={format}
          disabled={running}
          onChange={(event) => setFormat(event.target.value)}
          className="border-edge bg-base text-secondary mt-1 w-full rounded border px-1.5 py-1.5 text-[13px] outline-none"
        >
          {CREATE_FORMATS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
              {entry.note ? ` — ${entry.note}` : ''}
            </option>
          ))}
        </select>
        {/* Named rather than silently absent: nobody can write these, and a
            user who looks for 7z deserves the reason instead of a shorter list. */}
        <p className="text-muted mt-1 text-[10px] leading-tight">
          {READ_ONLY_FORMATS.join(' and ')} can be opened but not created — their compressors are
          proprietary.
        </p>

        <label className="text-secondary mt-3 block text-[12px]" htmlFor="archive-split">
          Split into parts
        </label>
        <select
          id="archive-split"
          value={splitMb}
          disabled={running}
          onChange={(event) => setSplitMb(Number(event.target.value))}
          className="border-edge bg-base text-secondary mt-1 w-full rounded border px-1.5 py-1.5 text-[13px] outline-none"
        >
          {SPLIT_SIZES_MB.map((size) => (
            <option key={size} value={size}>
              {size === 0 ? 'One file' : `Every ${size} MB`}
            </option>
          ))}
        </select>
        {splitMb > 0 && (
          <p className="text-muted mt-1 flex items-start gap-1 text-[10px] leading-tight">
            <AlertTriangle size={9} className="mt-0.5 shrink-0" />
            Produces .001, .002 and so on. Each part is not openable on its own — all of them are
            needed.
          </p>
        )}

        <label className="text-secondary mt-3 block text-[12px]" htmlFor="archive-password">
          Password
        </label>
        <input
          id="archive-password"
          type="password"
          value={canEncrypt ? password : ''}
          disabled={running || !canEncrypt}
          placeholder={canEncrypt ? 'Optional' : 'Not available for this format'}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          className="border-edge bg-base text-primary mt-1 w-full rounded-md border px-2 py-1.5 text-[13px] outline-none focus:border-[var(--accent)] disabled:opacity-40"
        />
        {canEncrypt && password && (
          // People are routinely surprised by this, and a tool that lets someone
          // believe otherwise is the mistake M14 refused to make about CRC32.
          <p className="text-muted mt-1 flex items-start gap-1 text-[10px] leading-tight">
            <AlertTriangle size={9} className="mt-0.5 shrink-0" />
            AES-256. The file names stay readable — only the contents are encrypted.
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          <span className="text-muted flex-1 truncate text-[11px]">
            {running && (
              <>
                <Loader2 size={11} className="mr-1 inline animate-spin" />
                {formatSize(progress.done, '0 B')}
                {progress.total > 0 ? ` of ${formatSize(progress.total)}` : ''}
              </>
            )}
          </span>
          <button
            type="button"
            onClick={close}
            className="border-edge text-secondary hover:bg-hover hover:text-primary rounded-md border px-3 py-1.5 text-[13px] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={start}
            disabled={!name.trim() || running}
            className="text-accent rounded-md bg-[var(--accent-glow)] px-3 py-1.5 text-[13px] transition-colors hover:opacity-90 disabled:cursor-default disabled:opacity-30"
          >
            Compress
          </button>
        </div>
      </div>
    </div>
  )
}
