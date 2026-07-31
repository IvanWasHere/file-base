/**
 * Undo, exercised against the mock filesystem — the same code path the app
 * runs, with a real (in-memory) tree underneath rather than a stubbed bridge.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { invert } from './undo'
import { bridge } from '@/services/bridge'

const HOME = '/Users/dev'
let scratch: string

beforeEach(async () => {
  const created = await bridge.fs.createFolder(HOME, 'undo-scratch')
  scratch = created.path
})

describe('create', () => {
  it('removes the item it created', async () => {
    const folder = await bridge.fs.createFolder(scratch, 'New')

    const { problems } = await invert(bridge, {
      kind: 'create',
      label: 'New Folder',
      path: folder.path,
    })

    expect(problems).toEqual([])
    expect(await bridge.fs.exists(folder.path)).toBe(false)
  })
})

describe('rename', () => {
  it('puts the original name back', async () => {
    const file = await bridge.fs.createFile(scratch, 'draft.txt')
    const renamed = await bridge.fs.rename(file.path, 'final.txt')

    const { problems } = await invert(bridge, {
      kind: 'rename',
      label: 'Rename to final.txt',
      from: file.path,
      to: renamed.path,
    })

    expect(problems).toEqual([])
    expect(await bridge.fs.exists(file.path)).toBe(true)
    expect(await bridge.fs.exists(renamed.path)).toBe(false)
  })

  it('reports rather than overwrites when the old name was taken since', async () => {
    const file = await bridge.fs.createFile(scratch, 'draft.txt')
    const renamed = await bridge.fs.rename(file.path, 'final.txt')
    // Something else now occupies the name the undo wants to restore.
    await bridge.fs.createFile(scratch, 'draft.txt')

    const { problems } = await invert(bridge, {
      kind: 'rename',
      label: 'Rename to final.txt',
      from: file.path,
      to: renamed.path,
    })

    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/already exists/)
    // Neither file was destroyed.
    expect(await bridge.fs.exists(file.path)).toBe(true)
    expect(await bridge.fs.exists(renamed.path)).toBe(true)
  })
})

describe('move', () => {
  it('returns each item to the folder it came from', async () => {
    const source = await bridge.fs.createFolder(scratch, 'Source')
    const dest = await bridge.fs.createFolder(scratch, 'Dest')
    const file = await bridge.fs.createFile(source.path, 'notes.txt')

    const result = await bridge.fs.move([file.path], dest.path, 'fail')
    const moved = result.succeeded[0]
    if (!moved) throw new Error('expected the move to succeed')

    const { problems, touched } = await invert(bridge, {
      kind: 'move',
      label: 'Move 1 item',
      pairs: [{ from: moved.source, to: moved.target }],
    })

    expect(problems).toEqual([])
    expect(await bridge.fs.exists(file.path)).toBe(true)
    expect(await bridge.fs.exists(moved.target)).toBe(false)
    expect(touched).toContain(source.path)
    expect(touched).toContain(dest.path)
  })

  // keep-both renames on the way out, so a plain move back would restore the
  // item under the wrong name.
  it('restores the original name after a keep-both collision', async () => {
    const source = await bridge.fs.createFolder(scratch, 'Source')
    const dest = await bridge.fs.createFolder(scratch, 'Dest')
    const file = await bridge.fs.createFile(source.path, 'notes.txt')
    await bridge.fs.createFile(dest.path, 'notes.txt')

    const result = await bridge.fs.move([file.path], dest.path, 'keep-both')
    const moved = result.succeeded[0]
    if (!moved) throw new Error('expected the move to succeed')
    expect(moved.target).toBe(`${dest.path}/notes copy.txt`)

    const { problems } = await invert(bridge, {
      kind: 'move',
      label: 'Move 1 item',
      pairs: [{ from: moved.source, to: moved.target }],
    })

    expect(problems).toEqual([])
    expect(await bridge.fs.exists(`${source.path}/notes.txt`)).toBe(true)
    expect(await bridge.fs.exists(moved.target)).toBe(false)
    // The file that caused the collision is still where it was.
    expect(await bridge.fs.exists(`${dest.path}/notes.txt`)).toBe(true)
  })
})

describe('copy', () => {
  it('removes the duplicates and leaves the originals alone', async () => {
    const source = await bridge.fs.createFolder(scratch, 'Source')
    const dest = await bridge.fs.createFolder(scratch, 'Dest')
    const file = await bridge.fs.createFile(source.path, 'notes.txt')

    const result = await bridge.fs.copy([file.path], dest.path, 'fail')
    const created = result.succeeded.map((moved) => moved.target)

    const { problems } = await invert(bridge, { kind: 'copy', label: 'Copy 1 item', created })

    expect(problems).toEqual([])
    expect(await bridge.fs.exists(created[0] ?? '')).toBe(false)
    expect(await bridge.fs.exists(file.path)).toBe(true)
  })
})

describe('trash', () => {
  it('restores items to where they were', async () => {
    const file = await bridge.fs.createFile(scratch, 'notes.txt')
    const trashed = await bridge.fs.trash([file.path])
    expect(await bridge.fs.exists(file.path)).toBe(false)

    const { problems } = await invert(bridge, {
      kind: 'trash',
      label: 'Move 1 item to Trash',
      items: trashed,
    })

    expect(problems).toEqual([])
    expect(await bridge.fs.exists(file.path)).toBe(true)
  })

  it('restores a folder with its contents', async () => {
    const folder = await bridge.fs.createFolder(scratch, 'Tree')
    await bridge.fs.createFile(folder.path, 'inside.txt')

    const trashed = await bridge.fs.trash([folder.path])
    const { problems } = await invert(bridge, {
      kind: 'trash',
      label: 'Move 1 item to Trash',
      items: trashed,
    })

    expect(problems).toEqual([])
    expect(await bridge.fs.exists(`${folder.path}/inside.txt`)).toBe(true)
  })

  it('refuses to overwrite something created at the original path since', async () => {
    const file = await bridge.fs.createFile(scratch, 'notes.txt')
    const trashed = await bridge.fs.trash([file.path])
    // The user made a new file with the same name after trashing the old one.
    await bridge.fs.createFile(scratch, 'notes.txt')

    const { problems } = await invert(bridge, {
      kind: 'trash',
      label: 'Move 1 item to Trash',
      items: trashed,
    })

    expect(problems).toHaveLength(1)
    // The replacement survived; an undo must not be a second destructive act.
    expect(await bridge.fs.exists(file.path)).toBe(true)
    expect(await bridge.fs.exists(trashed[0]?.trashPath ?? '')).toBe(true)
  })
})
