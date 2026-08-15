/**
 * The formats the app can *write* (PLAN.md §M18).
 *
 * Shorter than the list it can read, and permanently so: RAR compression is
 * proprietary and no maintained pure-Go library writes 7z. Both are absent
 * rather than present and failing at the end of a long job — which is the
 * difference between a limitation and a bug (decision 14).
 *
 * `backend/archive`'s `TestCreateFormatsMatchFrontend` reads this file, so a
 * format offered here that Go cannot write fails the build rather than the user.
 */

export interface ArchiveFormat {
  id: string
  label: string
  /** What the file is called, appended to the chosen name. */
  extension: string
  note?: string
}

export const CREATE_FORMATS: ArchiveFormat[] = [
  { id: 'zip', label: 'Zip', extension: '.zip', note: 'Opens everywhere' },
  { id: 'tar.gz', label: 'Tar + Gzip', extension: '.tar.gz' },
  { id: 'tar.zst', label: 'Tar + Zstandard', extension: '.tar.zst', note: 'Fast, small' },
  { id: 'tar.xz', label: 'Tar + XZ', extension: '.tar.xz', note: 'Smallest, slowest' },
  { id: 'tar.bz2', label: 'Tar + Bzip2', extension: '.tar.bz2' },
  { id: 'tar.lz4', label: 'Tar + LZ4', extension: '.tar.lz4', note: 'Fastest, largest' },
  { id: 'tar.br', label: 'Tar + Brotli', extension: '.tar.br' },
  { id: 'tar', label: 'Tar', extension: '.tar', note: 'No compression' },
]

/**
 * Formats the app can open but never produce. Named in the dialog so the
 * absence reads as a fact about the world rather than an oversight.
 */
export const READ_ONLY_FORMATS = ['7z', 'rar']

export function formatById(id: string): ArchiveFormat | undefined {
  return CREATE_FORMATS.find((format) => format.id === id)
}

/**
 * Only zip, and that is the whole story: WinZip AES-256 is the one
 * interoperable answer in this set. A password on a tar.gz would mean inventing
 * an envelope, and a file nobody else can open is worse than no encryption.
 */
export function encryptable(id: string): boolean {
  return id === 'zip'
}

/** The sizes the split control offers, in megabytes. 0 is "one file". */
export const SPLIT_SIZES_MB = [0, 10, 100, 700, 1024, 4096]
