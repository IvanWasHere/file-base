/**
 * Which volume a path lives on.
 *
 * Drag and drop needs this because macOS decides copy-versus-move by it: a drag
 * within one volume moves, a drag across volumes copies. Getting that wrong is
 * not cosmetic — a "move" from an external drive is a full copy plus a delete,
 * and users rely on the distinction to know whether the original survives.
 *
 * Mount points come from the volume list the sidebar already reads, so this
 * stays a pure string operation rather than another trip to the backend.
 */

import { normalize } from '@/utils/path'

/**
 * The mount point serving `path`: the longest mount that is a prefix of it.
 *
 * Longest wins because "/" is a prefix of everything — a file under
 * /Volumes/Backup belongs to /Volumes/Backup, not to the boot volume.
 */
export function volumeOf(path: string, mountPoints: readonly string[]): string {
  const target = normalize(path)
  let best = '/'

  for (const mount of mountPoints) {
    const candidate = normalize(mount)
    if (candidate === '/') continue
    if (target === candidate || target.startsWith(`${candidate}/`)) {
      if (candidate.length > best.length) best = candidate
    }
  }
  return best
}

export function sameVolume(a: string, b: string, mountPoints: readonly string[]): boolean {
  return volumeOf(a, mountPoints) === volumeOf(b, mountPoints)
}

/**
 * What a drag would do if dropped now.
 *
 * Follows Finder: same volume moves, different volumes copies, and holding
 * Option forces a copy either way. Cmd forcing a move is deliberately absent —
 * it would silently turn a cross-volume drag into a delete-after-copy, and this
 * app has no progress UI for the long operation that would follow.
 */
export function dropEffectFor(
  sources: readonly string[],
  destination: string,
  mountPoints: readonly string[],
  modifiers: { altKey: boolean },
): 'copy' | 'move' {
  if (modifiers.altKey) return 'copy'
  const first = sources[0]
  if (!first) return 'move'
  return sameVolume(first, destination, mountPoints) ? 'move' : 'copy'
}
