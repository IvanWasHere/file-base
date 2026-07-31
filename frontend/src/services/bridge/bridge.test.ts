/**
 * Proves the bridge seam is real: this suite imports only `@/services/bridge`,
 * yet exercises a working filesystem — because VITE_BRIDGE=mock swaps the
 * implementation underneath. No Go process is involved.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { bridge } from '@/services/bridge'
import { isFsError } from '@/types/errors'

const HOME = '/Users/dev'
let scratch: string

beforeEach(async () => {
  // A unique folder per test keeps the shared in-memory tree from leaking state.
  const created = await bridge.fs.createFolder(
    HOME,
    `scratch-${Math.random().toString(36).slice(2)}`,
  )
  scratch = created.path
})

describe('fs.readDirectory', () => {
  it('lists the seeded home directory', async () => {
    const items = await bridge.fs.readDirectory(HOME)
    const names = items.map((item) => item.name)
    expect(names).toContain('Documents')
    expect(names).toContain('Downloads')
    expect(names).toContain('Projects')
  })

  it('hides dotfiles unless asked', async () => {
    const downloads = `${HOME}/Downloads`
    const visible = await bridge.fs.readDirectory(downloads)
    expect(visible.map((item) => item.name)).not.toContain('.DS_Store')

    const all = await bridge.fs.readDirectory(downloads, { includeHidden: true })
    expect(all.map((item) => item.name)).toContain('.DS_Store')
  })

  it('derives category and extension in TypeScript', async () => {
    const items = await bridge.fs.readDirectory(`${HOME}/Pictures/Wallpapers`)
    const jpg = items.find((item) => item.name === 'neon-city.jpg')
    expect(jpg?.extension).toBe('jpg')
    expect(jpg?.category).toBe('image')
    expect(jpg?.isDirectory).toBe(false)
  })

  it('raises a typed error for a missing path', async () => {
    // Not an empty listing: a folder that is gone and a folder with nothing in
    // it are different, and only the first should put a pane into its error
    // state. The Go backend reports not-found here too.
    await expect(bridge.fs.readDirectory('/nope/nowhere')).rejects.toSatisfy(
      (error: unknown) => isFsError(error) && error.code === 'not-found',
    )

    await expect(bridge.fs.readFileInfo('/nope/nowhere')).rejects.toSatisfy(
      (error: unknown) => isFsError(error) && error.code === 'not-found',
    )
  })

  it('refuses to list a file as though it were a folder', async () => {
    const file = await bridge.fs.createFile(scratch, 'notes.txt')
    await expect(bridge.fs.readDirectory(file.path)).rejects.toSatisfy(
      (error: unknown) => isFsError(error) && error.code === 'not-a-directory',
    )
  })
})

describe('fs mutations', () => {
  it('creates, renames and deletes a folder', async () => {
    const created = await bridge.fs.createFolder(scratch, 'Reports')
    expect(created.isDirectory).toBe(true)

    const renamed = await bridge.fs.rename(created.path, 'Archive')
    expect(renamed.name).toBe('Archive')
    expect(await bridge.fs.exists(created.path)).toBe(false)
    expect(await bridge.fs.exists(renamed.path)).toBe(true)

    await bridge.fs.delete([renamed.path])
    expect(await bridge.fs.exists(renamed.path)).toBe(false)
  })

  it('rejects a duplicate name', async () => {
    await bridge.fs.createFolder(scratch, 'Duplicate')
    await expect(bridge.fs.createFolder(scratch, 'Duplicate')).rejects.toSatisfy(
      (error: unknown) => isFsError(error) && error.code === 'already-exists',
    )
  })

  it('renames descendants along with their parent', async () => {
    const parent = await bridge.fs.createFolder(scratch, 'Parent')
    const child = await bridge.fs.createFile(parent.path, 'child.txt')

    const renamed = await bridge.fs.rename(parent.path, 'Renamed')
    expect(await bridge.fs.exists(child.path)).toBe(false)
    expect(await bridge.fs.exists(`${renamed.path}/child.txt`)).toBe(true)
  })

  it('applies the keep-both conflict policy', async () => {
    const source = await bridge.fs.createFolder(scratch, 'Source')
    const target = await bridge.fs.createFolder(scratch, 'Target')
    await bridge.fs.createFile(source.path, 'notes.txt')
    await bridge.fs.createFile(target.path, 'notes.txt')

    const result = await bridge.fs.copy([`${source.path}/notes.txt`], target.path, 'keep-both')
    expect(result.succeeded).toEqual([
      { source: `${source.path}/notes.txt`, target: `${target.path}/notes copy.txt` },
    ])

    const listing = await bridge.fs.readDirectory(target.path)
    expect(listing.map((item) => item.name).sort()).toEqual(['notes copy.txt', 'notes.txt'])
  })

  it('reports a conflict instead of overwriting when the policy is fail', async () => {
    const source = await bridge.fs.createFolder(scratch, 'A')
    const target = await bridge.fs.createFolder(scratch, 'B')
    await bridge.fs.createFile(source.path, 'same.txt')
    await bridge.fs.createFile(target.path, 'same.txt')

    const result = await bridge.fs.copy([`${source.path}/same.txt`], target.path, 'fail')
    expect(result.conflicts).toEqual([`${source.path}/same.txt`])
    expect(result.succeeded).toEqual([])
  })

  it('duplicates in place when copying into the folder an item already lives in', async () => {
    await bridge.fs.createFile(scratch, 'notes.txt')

    const result = await bridge.fs.copy([`${scratch}/notes.txt`], scratch, 'keep-both')
    expect(result.succeeded).toEqual([
      { source: `${scratch}/notes.txt`, target: `${scratch}/notes copy.txt` },
    ])
    expect(await bridge.fs.exists(`${scratch}/notes.txt`)).toBe(true)
  })

  // A name is a name, not a path. Without this the frontend could write outside
  // the folder the user is looking at by passing "../".
  it('rejects names that are not a single path component', async () => {
    for (const name of ['', '   ', '.', '..', '../escape', 'a/b']) {
      await expect(bridge.fs.createFolder(scratch, name)).rejects.toSatisfy(
        (error: unknown) => isFsError(error) && error.code === 'invalid-name',
      )
    }

    const target = await bridge.fs.createFolder(scratch, 'Target')
    await expect(bridge.fs.rename(target.path, '../escape')).rejects.toSatisfy(
      (error: unknown) => isFsError(error) && error.code === 'invalid-name',
    )
    expect(await bridge.fs.exists(target.path)).toBe(true)
  })

  it('refuses to move a folder into itself', async () => {
    const outer = await bridge.fs.createFolder(scratch, 'Outer')
    const inner = await bridge.fs.createFolder(outer.path, 'Inner')

    const result = await bridge.fs.move([outer.path], inner.path, 'fail')
    expect(result.succeeded).toEqual([])
    expect(result.failures[0]?.message).toMatch(/into itself/)
  })
})

describe('watcher', () => {
  it('notifies subscribers about changes in watched directories only', async () => {
    const events: string[] = []
    const unsubscribe = bridge.watcher.subscribe((event) =>
      events.push(`${event.kinds.join('+')}:${event.dir}:${event.paths.join(',')}`),
    )

    await bridge.watcher.watch(scratch)
    const created = await bridge.fs.createFile(scratch, 'watched.txt')
    expect(events).toContain(`create:${scratch}:${created.path}`)

    await bridge.watcher.unwatch(scratch)
    await bridge.fs.createFile(scratch, 'unwatched.txt')
    expect(events.some((entry) => entry.includes('unwatched.txt'))).toBe(false)

    unsubscribe()
  })

  // A pane showing a folder that disappears needs to know it disappeared, not
  // merely that "something changed" in it.
  it('reports the watched directory itself going away', async () => {
    const doomed = await bridge.fs.createFolder(scratch, 'Doomed')
    const events: { dir: string; gone: boolean }[] = []
    const unsubscribe = bridge.watcher.subscribe((event) =>
      events.push({ dir: event.dir, gone: event.gone }),
    )

    await bridge.watcher.watch(doomed.path)
    await bridge.fs.delete([doomed.path])

    expect(events).toContainEqual({ dir: doomed.path, gone: true })
    unsubscribe()
  })
})

describe('standardPaths', () => {
  it('resolves well-known locations natively rather than by string building', async () => {
    const paths = await bridge.fs.standardPaths()
    expect(paths.home).toBe(HOME)
    expect(paths.downloads).toBe(`${HOME}/Downloads`)
    expect(paths.applications).toBe('/Applications')
  })
})
