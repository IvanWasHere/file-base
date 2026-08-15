/**
 * What kind of preview a file gets, and how much of it may be read.
 *
 * Split from the components so the classification can be tested on its own —
 * and because deciding from the extension, rather than by attempting each
 * reader in turn, is the point: discovering that a 2GB video is not an image by
 * base64-encoding it is not a plan.
 *
 * The caps differ because the failure modes differ. Text is truncated, since a
 * partial log is still readable. Images and PDFs are refused, since half an
 * image is a broken image rather than a preview.
 */

import type { FileItem } from '@/types/file'

export const TEXT_CAP = 128 * 1024
export const IMAGE_CAP = 12 * 1024 * 1024
export const PDF_CAP = 40 * 1024 * 1024

/**
 * The React Query key for a file's decoded contents.
 *
 * Shared rather than private to the preview panel because M13's photo stage
 * reads the same bytes for the same file: with one key, opening the preview on
 * the photo already on the stage is a cache hit instead of a second base64 of
 * the same image. `mtime` is part of the key, so an edited file is a different
 * entry rather than something to invalidate.
 */
export const previewKey = (path: string, kind: string, mtime: number) =>
  ['preview', kind, path, mtime] as const

/**
 * Image extensions and the mime type each actually has.
 *
 * A map rather than `image/${extension}`, which produces `image/jpg` — not a
 * real type. Browsers sniff a data URL and render it anyway, so the mistake is
 * invisible until something stops sniffing; SVG is the one that fails loudly,
 * since it renders as nothing without `image/svg+xml`.
 */
const IMAGE_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
}

/** The mime type to declare in an image's data URL. */
export function imageMimeFor(extension: string): string {
  return IMAGE_MIMES[extension] ?? 'application/octet-stream'
}

/**
 * Extensions worth showing as text.
 *
 * A list rather than "anything not binary": guessing wrong on a 500MB database
 * file means reading 128KB of noise and rendering it, and the file-type
 * categories the app already computes do not separate text from binary.
 */
const TEXT_TYPES = new Set([
  'txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini',
  'cfg', 'conf', 'env', 'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'js', 'jsx', 'mjs',
  'cjs', 'ts', 'tsx', 'go', 'rs', 'py', 'rb', 'php', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp',
  'cs', 'sh', 'bash', 'zsh', 'fish', 'sql', 'graphql', 'gql', 'lua', 'r', 'dart', 'vue', 'svelte',
  'gitignore', 'dockerfile', 'makefile', 'lock',
])

export type PreviewKind = 'image' | 'text' | 'pdf' | 'none'

export function previewKindFor(item: FileItem): PreviewKind {
  if (item.isDirectory || item.broken) return 'none'
  if (item.extension in IMAGE_MIMES) return 'image'
  if (item.extension === 'pdf') return 'pdf'
  if (TEXT_TYPES.has(item.extension)) return 'text'
  // Extensionless files with a text-ish name — README, LICENSE, Makefile.
  if (!item.extension && item.size > 0 && item.size < TEXT_CAP) return 'text'
  return 'none'
}
