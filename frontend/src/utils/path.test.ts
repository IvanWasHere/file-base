import { describe, expect, it } from 'vitest'
import {
  basename,
  dirname,
  extname,
  isAncestor,
  join,
  nextAvailableName,
  normalize,
  stem,
  toSegments,
} from './path'

describe('normalize', () => {
  it('collapses duplicate separators and strips trailing ones', () => {
    expect(normalize('/Users//dev/Documents/')).toBe('/Users/dev/Documents')
  })

  it('preserves root', () => {
    expect(normalize('/')).toBe('/')
    expect(normalize('')).toBe('/')
  })
})

describe('basename / dirname', () => {
  it('splits a nested path', () => {
    expect(basename('/Users/dev/notes.md')).toBe('notes.md')
    expect(dirname('/Users/dev/notes.md')).toBe('/Users/dev')
  })

  it('bottoms out at root', () => {
    expect(dirname('/Users')).toBe('/')
    expect(dirname('/')).toBe('/')
    expect(basename('/')).toBe('/')
  })
})

describe('extname / stem', () => {
  it('lowercases and drops the dot', () => {
    expect(extname('Report.PDF')).toBe('pdf')
  })

  it('treats dotfiles as extensionless', () => {
    expect(extname('.gitignore')).toBe('')
    expect(stem('.gitignore')).toBe('.gitignore')
  })

  it('uses the last dot', () => {
    expect(extname('archive.tar.gz')).toBe('gz')
    expect(stem('archive.tar.gz')).toBe('archive.tar')
  })
})

describe('toSegments', () => {
  it('builds breadcrumbs root-first with cumulative paths', () => {
    expect(toSegments('/Users/dev/Documents')).toEqual([
      { name: '/', path: '/' },
      { name: 'Users', path: '/Users' },
      { name: 'dev', path: '/Users/dev' },
      { name: 'Documents', path: '/Users/dev/Documents' },
    ])
  })
})

describe('isAncestor', () => {
  it('guards moving a folder into itself', () => {
    expect(isAncestor('/Users/dev', '/Users/dev/Documents')).toBe(true)
    expect(isAncestor('/Users/dev', '/Users/dev')).toBe(true)
  })

  it('does not match sibling prefixes', () => {
    expect(isAncestor('/Users/dev', '/Users/developer')).toBe(false)
  })
})

describe('nextAvailableName', () => {
  it('returns the name unchanged when free', () => {
    expect(nextAvailableName('Report.pdf', new Set())).toBe('Report.pdf')
  })

  it('follows the Finder copy scheme', () => {
    const taken = new Set(['Report.pdf'])
    expect(nextAvailableName('Report.pdf', taken)).toBe('Report copy.pdf')

    taken.add('Report copy.pdf')
    expect(nextAvailableName('Report.pdf', taken)).toBe('Report copy 2.pdf')
  })

  it('does not stack "copy copy" when duplicating a copy', () => {
    const taken = new Set(['Report copy.pdf'])
    expect(nextAvailableName('Report copy.pdf', taken)).toBe('Report copy 2.pdf')
  })

  it('handles extensionless names', () => {
    expect(nextAvailableName('Archive', new Set(['Archive']))).toBe('Archive copy')
  })
})

describe('join', () => {
  it('joins and normalizes', () => {
    expect(join('/Users/dev', 'Documents', 'notes.md')).toBe('/Users/dev/Documents/notes.md')
  })
})
