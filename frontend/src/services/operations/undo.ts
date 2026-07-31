/**
 * Inverting an undo entry.
 *
 * Split out from the store (which holds only data) and from the hook (which
 * holds React wiring) so the interesting part — what the opposite of each
 * operation actually is — can be read and tested on its own.
 *
 * Every inverse runs with the 'fail' conflict policy. An undo that silently
 * overwrote something created since would be a second destructive act dressed
 * up as a correction; if the original name is taken, the undo reports that and
 * stops.
 */

import type { Bridge } from '@/services/bridge'
import type { UndoEntry } from '@/stores/historyStore'
import { basename, dirname } from '@/utils/path'

export interface UndoOutcome {
  /** Directories whose cached listing the undo may have changed. */
  touched: string[]
  /** Human-readable reasons an item could not be put back. */
  problems: string[]
}

/**
 * Restores one item to an exact path, whatever its current name.
 *
 * A move is not enough on its own: the item may have been renamed on the way
 * out (keep-both), so it is moved back to the right folder and then renamed
 * back to the right name.
 */
async function restoreTo(bridge: Bridge, from: string, to: string): Promise<string | null> {
  const targetDir = dirname(to)
  const targetName = basename(to)

  if (await bridge.fs.exists(to)) {
    return `${targetName} already exists`
  }

  if (dirname(from) !== targetDir) {
    const result = await bridge.fs.move([from], targetDir, 'fail')
    if (result.conflicts.length > 0) return `${basename(from)} already exists in the destination`
    const failure = result.failures[0]
    if (failure) return failure.message
    const moved = result.succeeded[0]
    if (!moved) return `${basename(from)} could not be moved back`
    from = moved.target
  }

  if (basename(from) !== targetName) {
    await bridge.fs.rename(from, targetName)
  }
  return null
}

export async function invert(bridge: Bridge, entry: UndoEntry): Promise<UndoOutcome> {
  const problems: string[] = []

  switch (entry.kind) {
    case 'create':
      // The item was brand new, so removing it restores the previous state
      // exactly. Trash rather than delete: the user may have put something in
      // the folder since, and an undo must not be the thing that destroys it.
      await bridge.fs.trash([entry.path])
      return { touched: [dirname(entry.path)], problems }

    case 'rename': {
      const problem = await restoreTo(bridge, entry.to, entry.from)
      if (problem) problems.push(problem)
      return { touched: [dirname(entry.from), dirname(entry.to)], problems }
    }

    case 'move': {
      const touched = new Set<string>()
      for (const pair of entry.pairs) {
        touched.add(dirname(pair.from))
        touched.add(dirname(pair.to))
        const problem = await restoreTo(bridge, pair.to, pair.from)
        if (problem) problems.push(problem)
      }
      return { touched: [...touched], problems }
    }

    case 'copy':
      // Only the duplicates are removed; the originals were never touched.
      await bridge.fs.trash(entry.created)
      return { touched: [...new Set(entry.created.map(dirname))], problems }

    case 'trash': {
      const touched = new Set<string>()
      for (const item of entry.items) {
        touched.add(dirname(item.originalPath))
        const problem = await restoreTo(bridge, item.trashPath, item.originalPath)
        if (problem) problems.push(problem)
      }
      return { touched: [...touched], problems }
    }
  }
}
