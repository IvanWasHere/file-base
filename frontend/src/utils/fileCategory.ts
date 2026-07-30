/**
 * File categorisation — ported and expanded from the mockup's
 * `getFileCategory` / `getFileIcon`.
 *
 * The mockup categorised a hand-authored `type` field. Real files only have an
 * extension, so the mapping is extension-driven. This is TypeScript-side by
 * design: Go returns raw metadata and makes no presentation decisions.
 */

import type { FileCategory } from '@/types/file'

const EXTENSIONS: Record<string, FileCategory> = {}

/** Space-separated so the table stays readable after Prettier formats it. */
function register(category: FileCategory, extensions: string): void {
  for (const extension of extensions.split(' ')) EXTENSIONS[extension] = category
}

register('image', 'png jpg jpeg gif webp bmp tiff tif svg heic heif avif ico raw cr2 nef psd')
register('document', 'pdf doc docx xls xlsx ppt pptx odt ods odp pages numbers key rtf txt epub md')
register(
  'code',
  'js jsx ts tsx go py rb rs java kt swift c h cpp hpp cs php sh zsh bash html css scss sass less vue svelte sql lua pl r dart ex exs elm clj scala',
)
register('music', 'mp3 flac wav aac m4a ogg opus wma aiff m3u')
register('video', 'mp4 mkv avi mov wmv flv webm m4v mpg mpeg 3gp')
register('archive', 'zip rar 7z tar gz bz2 xz zst dmg pkg iso app exe msi deb rpm')
register('data', 'json yaml yml xml csv tsv toml ini plist db sqlite')

export function categorize(extension: string, isDirectory: boolean): FileCategory {
  if (isDirectory) return 'folder'
  return EXTENSIONS[extension.toLowerCase()] ?? 'default'
}

/**
 * Lucide icon name per category (the PRD mandates Lucide over the mockup's
 * Font Awesome). Resolved to a component in components/common/FileIcon.tsx so
 * this module stays free of React imports and testable in isolation.
 */
export const CATEGORY_ICON: Record<FileCategory, string> = {
  folder: 'Folder',
  image: 'Image',
  document: 'FileText',
  code: 'FileCode',
  music: 'Music',
  video: 'Film',
  archive: 'FileArchive',
  data: 'Database',
  default: 'File',
}

/** CSS custom properties defined in styles/theme.css, in both themes. */
export function categoryColorVar(category: FileCategory): string {
  return `var(--ft-${category})`
}

export function categoryBackgroundVar(category: FileCategory): string {
  return `var(--ft-bg-${category})`
}

/** Column label in Details view — the mockup's `getTypeLabel`. */
export function typeLabel(extension: string, isDirectory: boolean): string {
  if (isDirectory) return 'Folder'
  return extension ? extension.toUpperCase() : 'File'
}
