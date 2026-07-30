import {
  Database,
  File,
  FileArchive,
  FileCode,
  FileText,
  Film,
  Folder,
  Image,
  Music,
  type LucideIcon,
} from 'lucide-react'
import type { FileCategory } from '@/types/file'

/**
 * Lucide replaces the mockup's Font Awesome icons (PRD). Colour comes from the
 * `--ft-*` theme variables so both themes stay in step.
 */
const ICONS: Record<FileCategory, LucideIcon> = {
  folder: Folder,
  image: Image,
  document: FileText,
  code: FileCode,
  music: Music,
  video: Film,
  archive: FileArchive,
  data: Database,
  default: File,
}

interface FileIconProps {
  category: FileCategory
  size?: number
  className?: string
}

export function FileIcon({ category, size = 16, className }: FileIconProps) {
  const Icon = ICONS[category]
  return (
    <Icon
      size={size}
      strokeWidth={1.75}
      className={className}
      style={{ color: `var(--ft-${category})` }}
      aria-hidden
    />
  )
}
