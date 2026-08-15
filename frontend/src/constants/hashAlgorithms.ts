/**
 * The algorithms the hash modal offers (PLAN.md M14).
 *
 * Every one is in Go's standard library — `backend/hashing` is the only thing
 * that can actually answer, and `TestAlgorithmsMatchFrontend` reads this file to
 * make sure the two lists agree. An algorithm offered here that Go cannot
 * compute would be a row failing for a reason nobody can act on.
 *
 * On "SHA128", which the original request listed: it does not exist. SHA-2 has
 * no 128-bit member. The 128-bit digest people mean is MD5, which is already
 * here, and the algorithm that usually sits beside it in a checksum panel is
 * SHA-1 — which is what the slot holds.
 */

export type HashAlgorithm =
  | 'crc32'
  | 'md5'
  | 'sha1'
  | 'sha224'
  | 'sha256'
  | 'sha384'
  | 'sha512'

/**
 * Which section of the sidebar an algorithm sits in.
 *
 * CRC32 is separated because it is not a hash: it detects accidental corruption
 * and nothing else. A checksum tool that lets someone verify a download with
 * CRC32 believing it proves the file is authentic is worse than one that leaves
 * CRC32 out.
 */
export type AlgorithmGroup = 'integrity' | 'legacy' | 'secure'

export interface AlgorithmSpec {
  id: HashAlgorithm
  label: string
  group: AlgorithmGroup
  /** Hex characters in the digest — used to recognise a pasted checksum. */
  digestLength: number
  /** Shown beside the name. Absent when there is nothing to warn about. */
  note?: string
}

export const GROUP_LABELS: Record<AlgorithmGroup, string> = {
  secure: 'Secure hashes',
  legacy: 'Published checksums',
  integrity: 'Integrity check',
}

/**
 * Ordered as the sidebar renders them: what to reach for first, then what
 * download pages still publish, then the thing that is not a hash at all.
 */
export const HASH_ALGORITHMS: AlgorithmSpec[] = [
  { id: 'sha256', label: 'SHA-256', group: 'secure', digestLength: 64 },
  { id: 'sha512', label: 'SHA-512', group: 'secure', digestLength: 128 },
  { id: 'sha384', label: 'SHA-384', group: 'secure', digestLength: 96 },
  { id: 'sha224', label: 'SHA-224', group: 'secure', digestLength: 56 },
  // Kept, because published checksums still use them — not because they should
  // be chosen for anything new.
  {
    id: 'sha1',
    label: 'SHA-1',
    group: 'legacy',
    digestLength: 40,
    note: 'Broken for security; fine for matching a published checksum',
  },
  {
    id: 'md5',
    label: 'MD5',
    group: 'legacy',
    digestLength: 32,
    note: 'Broken for security; fine for matching a published checksum',
  },
  {
    id: 'crc32',
    label: 'CRC32',
    group: 'integrity',
    digestLength: 8,
    note: 'Detects accidental corruption only — it proves nothing about origin',
  },
]

/** The one people who verify downloads verify with. */
export const DEFAULT_ALGORITHM: HashAlgorithm = 'sha256'

const BY_ID = new Map(HASH_ALGORITHMS.map((spec) => [spec.id, spec]))

export function algorithmSpec(id: HashAlgorithm): AlgorithmSpec {
  // Non-null: the map is built from the same list the union is written from.
  return BY_ID.get(id) as AlgorithmSpec
}

/**
 * Guards the value read back from the settings table.
 *
 * A database written by a later build can name an algorithm this one has never
 * heard of, and M13 decision 9 is the lesson: an unvalidated persisted enum
 * comes back as a view that renders nothing. Here it would be a job the backend
 * rejects outright.
 */
export function isHashAlgorithm(value: unknown): value is HashAlgorithm {
  return typeof value === 'string' && BY_ID.has(value as HashAlgorithm)
}

/** Groups in render order, each with its algorithms. Empty groups are dropped. */
export const ALGORITHM_GROUPS: { group: AlgorithmGroup; algorithms: AlgorithmSpec[] }[] = (
  ['secure', 'legacy', 'integrity'] as AlgorithmGroup[]
)
  .map((group) => ({
    group,
    algorithms: HASH_ALGORITHMS.filter((spec) => spec.group === group),
  }))
  .filter((entry) => entry.algorithms.length > 0)
