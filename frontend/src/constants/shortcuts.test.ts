import { describe, expect, it } from 'vitest'
import { findMenuItem } from '@/constants/menus'
import {
  SHORTCUTS,
  ariaKeyShortcuts,
  findCommand,
  formatAccelerator,
  isBareKey,
  parseAccelerator,
} from '@/constants/shortcuts'

/** A `KeyboardEvent`'s shape, as far as matching is concerned. */
function press(
  code: string,
  modifiers: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
) {
  return {
    code,
    metaKey: modifiers.meta ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    shiftKey: modifiers.shift ?? false,
    altKey: modifiers.alt ?? false,
  }
}

describe('parsing', () => {
  it('spells letters and digits as physical key codes', () => {
    // The reason the table is written in characters but matched on codes:
    // macOS rewrites `event.key` when Option is held, so `Cmd+Alt+L` arrives
    // as `¬` and a `.key` comparison would never fire.
    expect(parseAccelerator('Cmd+Alt+L')).toEqual({
      code: 'KeyL',
      cmd: true,
      shift: false,
      alt: true,
    })
    expect(parseAccelerator('Cmd+1').code).toBe('Digit1')
  })

  it('passes named keys through unchanged', () => {
    expect(parseAccelerator('Shift+Backspace')).toEqual({
      code: 'Backspace',
      cmd: false,
      shift: true,
      alt: false,
    })
  })
})

describe('matching', () => {
  it('accepts Ctrl wherever Cmd is expected, for external keyboards', () => {
    expect(findCommand(press('KeyC', { meta: true }))?.id).toBe('edit.copy')
    expect(findCommand(press('KeyC', { ctrl: true }))?.id).toBe('edit.copy')
  })

  it('will not fire a shortcut when an extra modifier is held', () => {
    // Cmd+Shift+C is not Copy. Without an exact modifier match every binding
    // would swallow the combinations built on top of it.
    expect(findCommand(press('KeyC', { meta: true, shift: true }))).toBeNull()
  })

  it('distinguishes trash from permanent delete by Shift alone', () => {
    expect(findCommand(press('Backspace'))?.id).toBe('file.moveToTrash')
    expect(findCommand(press('Backspace', { shift: true }))?.id).toBe('file.delete')
  })

  it('reports which accelerator matched, not just the command', () => {
    // Both spellings of "move to trash" — a Mac keyboard's and a PC one's.
    expect(findCommand(press('Delete'))?.shortcut.code).toBe('Delete')
    expect(findCommand(press('Backspace'))?.shortcut.code).toBe('Backspace')
  })
})

describe('the table itself', () => {
  it('never binds one combination to two commands', () => {
    // A duplicate would leave the second command permanently unreachable, and
    // the first one firing where the user expected the other.
    const seen = new Map<string, string>()
    for (const entry of SHORTCUTS) {
      const parsed = parseAccelerator(entry.accelerator)
      const key = `${parsed.cmd}|${parsed.shift}|${parsed.alt}|${parsed.code}`
      const previous = seen.get(key)
      expect(previous, `${entry.accelerator} is bound to both ${previous} and ${entry.id}`).toBe(
        undefined,
      )
      seen.set(key, entry.id)
    }
  })

  it('only binds commands the menus actually implement', () => {
    for (const entry of SHORTCUTS) {
      expect(findMenuItem(entry.id), `${entry.id} has a shortcut but no menu item`).toBeDefined()
    }
  })

  it('reserves the bare keys for exactly the ones that need no modifier', () => {
    const bare = SHORTCUTS.filter((entry) => isBareKey(parseAccelerator(entry.accelerator)))
    expect(bare.map((entry) => entry.accelerator).sort()).toEqual([
      'Backspace',
      'Delete',
      'Enter',
      'Shift+Backspace',
      'Shift+Delete',
      'Space',
    ])
  })
})

describe('display', () => {
  it('uses the macOS glyphs, in the order Apple prints them', () => {
    expect(formatAccelerator('Cmd+Shift+N')).toBe('⇧⌘N')
    expect(formatAccelerator('Cmd+Alt+C')).toBe('⌥⌘C')
    expect(formatAccelerator('Cmd+BracketLeft')).toBe('⌘[')
    expect(formatAccelerator('Space')).toBe('␣')
    expect(formatAccelerator('Cmd+ArrowUp')).toBe('⌘↑')
  })

  it('announces the binding separately from the label', () => {
    // The glyphs are `aria-hidden`, so this is what a screen reader reads.
    expect(ariaKeyShortcuts('Cmd+Shift+N')).toBe('Shift+Meta+N')
    expect(ariaKeyShortcuts('Enter')).toBe('Enter')
  })
})
