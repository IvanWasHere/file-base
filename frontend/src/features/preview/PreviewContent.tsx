import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { FileWarning, Loader2 } from 'lucide-react'
import { FileIcon } from '@/components/common/FileIcon'
import { bridge } from '@/services/bridge'
import type { FileItem } from '@/types/file'
import { describeFsError, isFsError } from '@/types/errors'
import { formatSize } from '@/utils/format'
import { IMAGE_CAP, PDF_CAP, TEXT_CAP, imageMimeFor, previewKindFor } from './previewKind'

/**
 * The content half of the preview panel (PLAN.md M10).
 *
 * What a file *is* decides how it is shown, and the decision is made from the
 * extension rather than by trying each reader in turn — a failed attempt to
 * base64 a 2GB video is not something to discover by doing it.
 *
 * Every reader is capped. The caps differ because the failure modes do: text is
 * truncated (a partial log is still readable), images and PDFs are refused
 * (half an image is a broken image, not a preview).
 */

const previewKey = (path: string, kind: string, mtime: number) =>
  ['preview', kind, path, mtime] as const

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface border-edge mb-4 flex min-h-[120px] items-center justify-center overflow-hidden rounded-lg border">
      {children}
    </div>
  )
}

function Pending() {
  return (
    <Frame>
      <Loader2 size={18} className="text-muted animate-spin" />
    </Frame>
  )
}

function Unavailable({ item, reason }: { item: FileItem; reason: string }) {
  return (
    <Frame>
      <div className="text-muted flex flex-col items-center gap-1.5 px-4 py-6 text-center">
        <FileWarning size={20} strokeWidth={1.25} className="opacity-50" />
        <span className="text-[11px]">{reason}</span>
        <FileIcon category={item.category} size={20} />
      </div>
    </Frame>
  )
}

function ImagePreview({ item }: { item: FileItem }) {
  const { data, isPending, error } = useQuery({
    queryKey: previewKey(item.path, 'image', item.modifiedAt),
    queryFn: () => bridge.fs.readFileBase64(item.path, IMAGE_CAP),
    retry: false,
  })

  // An extension is a claim, not a fact. Reading the bytes of a text file named
  // `.png` succeeds perfectly well; only the decoder knows it is not an image,
  // and by then the element is already in the tree. Tracked against the file so
  // selecting a different one clears it without an effect.
  const [undecodable, setUndecodable] = useState<string | null>(null)

  if (isPending) return <Pending />
  if (error || !data || undecodable === item.path) {
    return (
      <Unavailable
        item={item}
        reason={isFsError(error) ? describeFsError(error) : 'This image could not be shown.'}
      />
    )
  }

  return (
    <Frame>
      <img
        src={`data:${imageMimeFor(item.extension)};base64,${data}`}
        alt={item.name}
        onError={() => setUndecodable(item.path)}
        className="max-h-[220px] w-full object-contain"
      />
    </Frame>
  )
}

function TextPreview({ item }: { item: FileItem }) {
  const { data, isPending, error } = useQuery({
    queryKey: previewKey(item.path, 'text', item.modifiedAt),
    queryFn: () => bridge.fs.readTextFile(item.path, TEXT_CAP),
    retry: false,
  })

  if (isPending) return <Pending />
  if (error || data === undefined) {
    return (
      <Unavailable
        item={item}
        reason={isFsError(error) ? describeFsError(error) : 'This file could not be read.'}
      />
    )
  }

  // Go reads at most TEXT_CAP bytes and says nothing about it; the comparison
  // against the size already known here is what makes truncation visible.
  const truncated = item.size > TEXT_CAP

  return (
    <div className="mb-4">
      <pre className="bg-surface border-edge text-secondary max-h-[240px] overflow-auto rounded-lg border p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
        {data || '(empty file)'}
      </pre>
      {truncated && (
        <p className="text-muted mt-1 text-[10px]">
          Showing the first {formatSize(TEXT_CAP)} of {formatSize(item.size)}.
        </p>
      )}
    </div>
  )
}

function PdfPreview({ item }: { item: FileItem }) {
  const { data, isPending, error } = useQuery({
    queryKey: previewKey(item.path, 'pdf', item.modifiedAt),
    queryFn: () => bridge.fs.readFileBase64(item.path, PDF_CAP),
    retry: false,
  })

  if (isPending) return <Pending />
  if (error || !data) {
    return (
      <Unavailable
        item={item}
        reason={isFsError(error) ? describeFsError(error) : 'This PDF could not be shown.'}
      />
    )
  }

  return (
    <div className="border-edge mb-4 h-[260px] overflow-hidden rounded-lg border">
      {/* WKWebView renders PDFs natively, so the whole document is scrollable
          here rather than only its first page. */}
      <embed
        src={`data:application/pdf;base64,${data}`}
        type="application/pdf"
        title={item.name}
        className="size-full"
      />
    </div>
  )
}

export function PreviewContent({ item }: { item: FileItem }) {
  switch (previewKindFor(item)) {
    case 'image':
      return <ImagePreview item={item} />
    case 'text':
      return <TextPreview item={item} />
    case 'pdf':
      return <PdfPreview item={item} />
    case 'none':
      return (
        <Frame>
          <div
            className="flex h-[120px] w-full items-center justify-center"
            style={{ background: `var(--ft-bg-${item.category})` }}
          >
            <FileIcon category={item.category} size={48} />
          </div>
        </Frame>
      )
  }
}
