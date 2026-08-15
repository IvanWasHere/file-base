import { beforeEach, describe, expect, it } from 'vitest'
import { applyPlaceholders, ensureTemplatesFolder, loadCustomTemplates } from './templateService'
import { BUILTIN_TEMPLATES, nameFromTemplate, templateForName } from '@/constants/fileTemplates'
import { bridge } from '@/services/bridge'

const NOW = new Date(2026, 2, 9, 14, 5)

describe('applyPlaceholders', () => {
  it('substitutes the four tokens', () => {
    const out = applyPlaceholders(
      '{{name}} / {{date}} / {{time}} / {{year}}',
      'release notes.md',
      NOW,
    )
    expect(out).toBe('release notes / 2026-03-09 / 14:05 / 2026')
  })

  it('uses the stem, not the whole filename', () => {
    expect(applyPlaceholders('# {{name}}', 'Design Doc.md', NOW)).toBe('# Design Doc')
  })

  it('replaces every occurrence, not just the first', () => {
    expect(applyPlaceholders('{{name}}{{name}}', 'a.txt', NOW)).toBe('aa')
  })

  /**
   * The reason this matters, and it is not politeness: Handlebars, Jinja and Go
   * templates all use these braces. A template *for* one of those files would be
   * gutted by the thing meant to produce it.
   */
  it('leaves an unrecognised token exactly as it is', () => {
    const source = 'Hello {{user.name}}, {{#if x}}{{y}}{{/if}} — {{year}}'
    expect(applyPlaceholders(source, 'page.hbs', NOW)).toBe(
      'Hello {{user.name}}, {{#if x}}{{y}}{{/if}} — 2026',
    )
  })

  it('leaves content with no tokens untouched', () => {
    const source = '#!/usr/bin/env bash\nset -euo pipefail\n'
    expect(applyPlaceholders(source, 'run.sh', NOW)).toBe(source)
  })
})

describe('templateForName', () => {
  it('finds a template by the typed extension', () => {
    expect(templateForName('notes.md', BUILTIN_TEMPLATES)?.id).toBe('markdown')
    expect(templateForName('index.html', BUILTIN_TEMPLATES)?.id).toBe('html')
  })

  it('is case-insensitive about the extension', () => {
    expect(templateForName('INDEX.HTML', BUILTIN_TEMPLATES)?.id).toBe('html')
  })

  // Dockerfile and .gitignore are files with names, not types.
  it('matches a whole filename before trying extensions', () => {
    expect(templateForName('Dockerfile', BUILTIN_TEMPLATES)?.id).toBe('dockerfile')
    expect(templateForName('.gitignore', BUILTIN_TEMPLATES)?.id).toBe('gitignore')
  })

  // "Any type" means an extension no template claims still works — the file is
  // simply created empty.
  it('finds nothing for an extension no template claims', () => {
    expect(templateForName('data.xyz', BUILTIN_TEMPLATES)).toBeUndefined()
    expect(templateForName('README', BUILTIN_TEMPLATES)).toBeUndefined()
    expect(templateForName('', BUILTIN_TEMPLATES)).toBeUndefined()
  })

  // A leading dot names a hidden file; it does not introduce an extension.
  it('does not read a leading dot as an extension', () => {
    expect(templateForName('.md', BUILTIN_TEMPLATES)).toBeUndefined()
  })
})

describe('nameFromTemplate', () => {
  it('keeps the stem and swaps the extension', () => {
    const markdown = BUILTIN_TEMPLATES.find((template) => template.id === 'markdown')
    expect(nameFromTemplate(markdown!, 'notes')).toBe('notes.md')
  })

  it('takes the whole name for a filename template', () => {
    const dockerfile = BUILTIN_TEMPLATES.find((template) => template.id === 'dockerfile')
    expect(nameFromTemplate(dockerfile!, 'anything')).toBe('Dockerfile')
  })
})

describe('the built-in set', () => {
  // Decision 7, as an assertion: a template whose content is empty would be a
  // row in the list that does nothing Cmd+N does not already do.
  it('gives every template content worth having', () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.content.length, `${template.id} has no content`).toBeGreaterThan(0)
      expect(template.label).toBeTruthy()
      expect(template.source).toBe('builtin')
    }
  })

  it('ships no plain-text template, because Cmd+N already makes that file', () => {
    expect(BUILTIN_TEMPLATES.some((template) => template.extension === 'txt')).toBe(false)
  })

  // The one whose mode matters as much as its contents.
  it('marks the shell script executable and gives it a shebang', () => {
    const shell = BUILTIN_TEMPLATES.find((template) => template.id === 'shell')
    expect(shell?.executable).toBe(true)
    expect(shell?.content.startsWith('#!')).toBe(true)
  })

  it('gives every template a unique id', () => {
    const ids = BUILTIN_TEMPLATES.map((template) => template.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

const FOLDER = '/Users/dev/Library/Application Support/MacFileExplorer/Templates'

describe('custom templates', () => {
  beforeEach(async () => {
    await ensureTemplatesFolder(FOLDER)
  })

  it('creates the folder, parents and all, when it is missing', async () => {
    expect(await bridge.fs.exists(FOLDER)).toBe(true)
  })

  it('reads a dropped file as a template, with its own extension', async () => {
    await bridge.fs.createFile(FOLDER, 'note.md', '# {{name}}\n')

    const templates = await loadCustomTemplates(FOLDER)
    const note = templates.find((template) => template.label === 'note.md')
    expect(note?.extension).toBe('md')
    expect(note?.content).toBe('# {{name}}\n')
    expect(note?.source).toBe('custom')
    expect(note?.problem).toBeUndefined()
  })

  // If your template file is executable, so is the file made from it.
  it('carries the executable bit across', async () => {
    await bridge.fs.createFile(FOLDER, 'deploy.sh', '#!/bin/sh\n', true)

    const templates = await loadCustomTemplates(FOLDER)
    expect(templates.find((template) => template.label === 'deploy.sh')?.executable).toBe(true)
  })

  it('offers a whole filename for a template that has no extension', async () => {
    await bridge.fs.createFile(FOLDER, 'Makefile', 'all:\n\techo hi\n')

    const templates = await loadCustomTemplates(FOLDER)
    expect(templates.find((template) => template.label === 'Makefile')?.filename).toBe('Makefile')
  })

  // A broken template is listed with the reason rather than hidden: one that
  // silently vanishes looks like a bug in the app, and the user is the one who
  // has to go and fix the file.
  it('lists a binary file with its reason instead of dropping it', async () => {
    await bridge.fs.createFile(FOLDER, 'logo.png', 'PNG\0�binary')

    const templates = await loadCustomTemplates(FOLDER)
    const logo = templates.find((template) => template.label === 'logo.png')
    expect(logo).toBeDefined()
    expect(logo?.problem).toBe('Not a text file')
  })

  it('never throws when the folder is missing', async () => {
    await expect(loadCustomTemplates('/nowhere/at/all')).resolves.toEqual([])
  })

  it('sorts by name and ignores folders', async () => {
    await bridge.fs.createFile(FOLDER, 'b.md', 'b')
    await bridge.fs.createFile(FOLDER, 'a.md', 'a')
    await bridge.fs.createFolder(FOLDER, 'nested')

    const templates = await loadCustomTemplates(FOLDER)
    expect(templates.map((template) => template.label)).toEqual(['a.md', 'b.md'])
  })
})
