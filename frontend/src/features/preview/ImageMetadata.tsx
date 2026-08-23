import { useQuery } from '@tanstack/react-query'
import { Check, Copy, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { bridge } from '@/services/bridge'
import { toast } from '@/stores/toastStore'
import type { FileItem } from '@/types/file'
import { imageFacts } from './imageFacts'
import { previewKindFor } from './previewKind'

/**
 * The metadata an image editor shows, in the preview panel (PLAN.md §M23).
 *
 * Everything on screen here comes from the file's own header — ImageIO reads
 * it, `imageFacts` decides what is worth a row and how it reads, and this draws
 * it. There is no judgement left in this file, which is the point: what "1/250
 * s" means is testable without React.
 *
 * The section is **quiet when there is nothing to say**. A `.svg`, a text file
 * named `.png`, a format the system cannot identify — all of them resolve to no
 * section at all rather than to an error, because the panel above already told
 * the user everything that is known about the file.
 */

/** Cached by path and mtime, exactly as the preview image above it is. */
const imageInfoKey = (path: string, mtime: number) => ['image-info', path, mtime] as const

export function ImageMetadata({ item }: { item: FileItem }) {
  const isImage = previewKindFor(item) === 'image'

  const { data, isPending, isError } = useQuery({
    queryKey: imageInfoKey(item.path, item.modifiedAt),
    queryFn: () => bridge.images.read(item.path),
    enabled: isImage,
    // A file that is not an image will not become one; retrying a rejected
    // identification three times is three round trips to the same answer.
    retry: false,
    staleTime: Infinity,
  })

  if (!isImage) return null

  if (isPending) {
    return (
      <div className="text-muted mt-3 flex items-center gap-1.5 text-[11px]">
        <Loader2 size={11} className="animate-spin" />
        Reading image data…
      </div>
    )
  }

  // Not an error state: it means "the system does not consider this an image",
  // which for an SVG or a misnamed file is simply the truth.
  if (isError || !data) return null

  const groups = imageFacts(data)
  if (groups.length === 0) return null

  return (
    <section aria-label="Image metadata" className="mt-4">
      {groups.map((group) => (
        <div key={group.title} className="mb-3 last:mb-0">
          <header className="text-muted mb-1 flex items-center justify-between text-[10px] font-semibold tracking-[0.5px] uppercase">
            <span>{group.title}</span>
            {/* Coordinates are the one thing here anybody needs *out* of the
                app — into a map, a caption, a spreadsheet. */}
            {group.title === 'Location' && data.hasGps && (
              <CopyCoordinates latitude={data.latitude} longitude={data.longitude} />
            )}
          </header>

          <dl>
            {group.facts.map((fact) => (
              <div
                key={fact.label}
                className="flex justify-between gap-3 border-b border-[var(--border-subtle)] py-1.5 text-xs last:border-b-0"
              >
                <dt className="text-muted shrink-0">{fact.label}</dt>
                {/* `title` as well as `truncate`: a lens model is longer than
                    a 280px panel and hovering should not require widening it. */}
                <dd className="text-primary truncate text-right font-medium" title={fact.value}>
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  )
}

/**
 * Copies `-22.90680, -43.17290` — the signed pair, not the hemisphere notation
 * shown above it. Every map, spreadsheet and geocoder takes this form; none of
 * them takes "22.90680° S".
 */
function CopyCoordinates({ latitude, longitude }: { latitude: number; longitude: number }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard.writeText(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => toast.error('Could not copy the coordinates'),
    )
  }

  return (
    <button
      type="button"
      aria-label="Copy coordinates"
      onClick={copy}
      className="text-muted hover:text-primary flex items-center gap-1 rounded px-1 py-0.5 text-[10px] normal-case transition-colors"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
