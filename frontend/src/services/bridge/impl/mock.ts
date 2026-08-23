/**
 * In-memory implementation of the bridge contract.
 *
 * Selected by VITE_BRIDGE=mock. It exists so the entire UI — navigation, views,
 * selection, file operations — can run and be tested in a plain browser with no
 * Go process (Vitest, Playwright, `npm run dev:mock`).
 *
 * The seed tree is the mockup's dataset, re-rooted from its numeric `parentId`
 * hierarchy onto real-looking absolute paths under /Users/dev.
 */

import type {
  ArchiveHandlers,
  Bridge,
  ExternalDrop,
  HashHandlers,
  SearchHandlers,
} from '../types'
import { mockDb } from './mockDb'
import { MOUNT_PREFIX } from '@/services/archives/mountPaths'
import { algorithmSpec } from '@/constants/hashAlgorithms'
import type { HashResult } from '@/types/hashing'
import type {
  ConflictPolicy,
  FileChangeKind,
  FileItem,
  FileSystemEvent,
  OperationResult,
  SearchCriteria,
  TrashedItem,
} from '@/types/file'
import { FsError } from '@/types/errors'
import { normaliseTags, type FileTag } from '@/constants/tags'
import { categorize } from '@/utils/fileCategory'
import {
  basename,
  dirname,
  extname,
  isAncestor,
  isHiddenName,
  join,
  nextAvailableName,
  normalize,
  ROOT,
} from '@/utils/path'

interface Node {
  path: string
  isDirectory: boolean
  size: number
  createdAt: number
  modifiedAt: number
  content?: string
  /** Reflected in `permissions`, so the x bit survives a read (M15). */
  executable?: boolean
  /** A browse mount is extracted read-only, and the listing has to show that. */
  readOnly?: boolean
  /** Finder tags (§M22). Absent means untagged, which is almost every node. */
  tags?: FileTag[]
}

/** 1×1 transparent PNG, shared by the image preview and the thumbnailer. */
const TRANSPARENT_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const HOME = '/Users/dev'
const TRASH = `${HOME}/.Trash`
const FIXED_NOW = Date.UTC(2025, 0, 22)

/** [relative path, size in bytes, days before FIXED_NOW]. Size 0 = directory. */
const SEED: [string, number, number][] = [
  ['Desktop', 0, 4],
  ['Documents', 0, 38],
  ['Documents/Work', 0, 10],
  ['Documents/Work/Client Proposals', 0, 12],
  ['Documents/Work/Client Proposals/Acme Corp Proposal.pdf', 3450000, 16],
  ['Documents/Work/Client Proposals/Globex Draft v2.pdf', 2100000, 13],
  ['Documents/Work/Contract Draft.pdf', 890000, 14],
  ['Documents/Work/Team Structure.xlsx', 67200, 35],
  ['Documents/Work/Sprint Planning.docx', 234000, 2],
  ['Documents/Personal', 0, 52],
  ['Documents/Personal/Travel Plans.docx', 45600, 31],
  ['Documents/Personal/Tax Returns', 0, 287],
  ['Documents/Personal/Tax Returns/Tax 2023.pdf', 567000, 287],
  ['Documents/Annual Report 2024.pdf', 2457600, 17],
  ['Documents/Meeting Notes.docx', 156800, 4],
  ['Documents/Budget Template.xlsx', 89200, 63],
  ['Documents/Project Roadmap.pptx', 5120000, 7],
  ['Documents/Resume.pdf', 324000, 129],
  ['Downloads', 0, 2],
  ['Downloads/node-v20.11.0-x64.pkg', 32400000, 20],
  ['Downloads/Figma-Desktop-Setup.dmg', 145000000, 25],
  ['Downloads/project-backup-jan.zip', 67800000, 3],
  ['Downloads/wallpaper-collection.zip', 234000000, 68],
  ['Downloads/.DS_Store', 6148, 2],
  ['Movies', 0, 43],
  ['Movies/tutorial-react-hooks.mp4', 256000000, 43],
  ['Movies/conference-talk-2024.mkv', 890000000, 58],
  ['Movies/screen-recording-jan.mp4', 45000000, 2],
  ['Movies/vacation-highlight-reel.mp4', 780000000, 150],
  ['Music', 0, 75],
  ['Music/Playlists', 0, 94],
  ['Music/Playlists/Workout Mix', 0, 94],
  ['Music/Playlists/Chill Vibes.m3u', 2400, 99],
  ['Music/Playlists/Focus Flow.m3u', 1800, 94],
  ['Music/Midnight Drive.mp3', 8450000, 160],
  ['Music/Ocean Waves.flac', 45000000, 216],
  ['Music/City Lights.mp3', 9200000, 134],
  ['Pictures', 0, 12],
  ['Pictures/Screenshots', 0, 1],
  ['Pictures/Screenshots/bug-report-01.png', 890000, 1],
  ['Pictures/Screenshots/design-review.png', 1200000, 4],
  ['Pictures/Screenshots/api-response.png', 340000, 7],
  ['Pictures/Camera Roll', 0, 12],
  ['Pictures/Camera Roll/IMG_20250101_001.jpg', 3400000, 21],
  ['Pictures/Camera Roll/IMG_20250105_002.jpg', 4100000, 17],
  ['Pictures/Camera Roll/IMG_20250110_003.jpg', 3800000, 12],
  ['Pictures/Wallpapers', 0, 48],
  ['Pictures/Wallpapers/mountain-lake-4k.jpg', 8900000, 48],
  ['Pictures/Wallpapers/neon-city.jpg', 5600000, 63],
  ['Pictures/Wallpapers/abstract-fractal.png', 3200000, 104],
  ['Pictures/vacation-sunset.jpg', 4500000, 155],
  ['Projects', 0, 0],
  ['Projects/vault-explorer', 0, 0],
  ['Projects/vault-explorer/src', 0, 0],
  ['Projects/vault-explorer/src/index.js', 1200, 0],
  ['Projects/vault-explorer/src/app.js', 15600, 0],
  ['Projects/vault-explorer/src/styles.css', 8900, 1],
  ['Projects/vault-explorer/src/utils.js', 4500, 2],
  ['Projects/vault-explorer/README.md', 8900, 0],
  ['Projects/vault-explorer/package.json', 2400, 0],
  ['Projects/vault-explorer/.gitignore', 380, 7],
  ['Projects/data-pipeline', 0, 4],
  ['Projects/data-pipeline/tests', 0, 4],
  ['Projects/data-pipeline/tests/test_pipeline.py', 8900, 4],
  ['Projects/data-pipeline/tests/test_utils.py', 3400, 5],
  ['Projects/data-pipeline/pipeline.py', 23400, 4],
  ['Projects/data-pipeline/config.yaml', 1800, 5],
  ['Projects/data-pipeline/requirements.txt', 680, 7],
  ['Projects/design-system', 0, 10],
  ['Projects/design-system/components', 0, 10],
  ['Projects/design-system/components/Button.tsx', 5600, 10],
  ['Projects/design-system/components/Input.tsx', 4200, 11],
  ['Projects/design-system/components/Modal.tsx', 7800, 10],
  ['Projects/design-system/docs', 0, 12],
  ['Projects/design-system/docs/getting-started.md', 3400, 12],
  ['Projects/design-system/docs/api-reference.md', 8900, 12],
  ['Projects/design-system/tokens.json', 12400, 10],
]

/**
 * Seeded tags, by path relative to home (§M22).
 *
 * Two files rather than none, because "the Tags column draws nothing" and "the
 * Tags column is broken" look identical on an untagged tree — and browser dev
 * has no Finder to tag anything with.
 */
const SEED_TAGS: Record<string, FileTag[]> = {
  'Documents/Work/Contract Draft.pdf': [
    { name: 'Urgent', color: 6 },
    { name: 'Work', color: 4 },
  ],
  'Documents/Personal/Travel Plans.docx': [{ name: 'Green', color: 2 }],
}

const DAY = 86_400_000

function buildTree(): Map<string, Node> {
  const nodes = new Map<string, Node>()

  const ensureDirectory = (path: string, modifiedAt: number): void => {
    if (nodes.has(path) || path === ROOT) return
    const parent = dirname(path)
    if (parent !== ROOT) ensureDirectory(parent, modifiedAt)
    nodes.set(path, { path, isDirectory: true, size: 0, createdAt: modifiedAt, modifiedAt })
  }

  ensureDirectory(HOME, FIXED_NOW)
  ensureDirectory(TRASH, FIXED_NOW)
  ensureDirectory('/Applications', FIXED_NOW)
  ensureDirectory('/Volumes', FIXED_NOW)

  for (const [relative, size, daysAgo] of SEED) {
    const path = join(HOME, relative)
    const modifiedAt = FIXED_NOW - daysAgo * DAY
    ensureDirectory(dirname(path), modifiedAt)
    // Size 0 marks a directory in the seed table; no 0-byte files are seeded.
    if (size === 0) {
      ensureDirectory(path, modifiedAt)
    } else {
      nodes.set(path, { path, isDirectory: false, size, createdAt: modifiedAt, modifiedAt })
    }
  }

  for (const [relative, tags] of Object.entries(SEED_TAGS)) {
    const node = nodes.get(join(HOME, relative))
    if (node) node.tags = tags.map((tag) => ({ ...tag }))
  }

  return nodes
}

let nodes = buildTree()
const listeners = new Set<(event: FileSystemEvent) => void>()
const watched = new Set<string>()

/**
 * Test hook: rebuilds the seed tree.
 *
 * The tree is module state, so without this a test that trashed a folder would
 * hand the next test a filesystem missing it. Called from test/setup.ts.
 */
export function __resetMockFilesystem(): void {
  nodes = buildTree()
  listeners.clear()
  watched.clear()
  searchHandlers.clear()
  cancelled.clear()
  archiveHandlers.clear()
  archiveCancelled.clear()
  hashHandlers.clear()
  hashCancelled.clear()
  dropHandlers.clear()
  menuHandlers.clear()
}

/**
 * Mirrors the backend: an event is reported for the watched *directory*, and
 * removing a watched directory itself is reported as `gone`.
 *
 * Not coalesced — batching is a backend concern, and a mock that delayed events
 * would make every test that asserts on one wait for a timer.
 */
function emit(kind: FileChangeKind, path: string): void {
  if (watched.has(path) && kind === 'remove') {
    deliver({ dir: path, kinds: [kind], paths: [path], gone: true })
    return
  }
  const dir = dirname(path)
  if (!watched.has(dir)) return
  deliver({ dir, kinds: [kind], paths: [path], gone: false })
}

function deliver(event: FileSystemEvent): void {
  for (const listener of listeners) listener(event)
}

function toFileItem(node: Node): FileItem {
  const name = basename(node.path)
  const extension = node.isDirectory ? '' : extname(name)
  return {
    id: node.path,
    path: node.path,
    name,
    extension,
    size: node.size,
    isDirectory: node.isDirectory,
    createdAt: node.createdAt,
    modifiedAt: node.modifiedAt,
    permissions: node.isDirectory
      ? node.readOnly
        ? 'dr-xr-xr-x'
        : 'drwxr-xr-x'
      : node.readOnly
        ? '-r--r--r--'
        : node.executable
          ? '-rwxr-xr-x'
          : '-rw-r--r--',
    hidden: isHiddenName(name),
    symlink: false,
    mimeType: node.isDirectory ? 'inode/directory' : 'application/octet-stream',
    category: categorize(extension, node.isDirectory),
    broken: false,
    // Copied, not shared: a caller mutating the array it was handed would be
    // editing the mock filesystem in place.
    tags: node.tags ? node.tags.map((tag) => ({ ...tag })) : [],
  }
}

function requireNode(path: string): Node {
  const node = nodes.get(normalize(path))
  if (!node) throw new FsError('not-found', `No such file or directory: ${path}`, path)
  return node
}

function childrenOf(path: string): Node[] {
  const parent = normalize(path)
  const result: Node[] = []
  for (const node of nodes.values()) {
    if (node.path !== parent && dirname(node.path) === parent) result.push(node)
  }
  return result
}

/** Every descendant, deepest first — safe ordering for deletes. */
function descendantsOf(path: string): Node[] {
  const parent = normalize(path)
  return [...nodes.values()]
    .filter((node) => node.path !== parent && isAncestor(parent, node.path))
    .sort((a, b) => b.path.length - a.path.length)
}

/**
 * Mirrors validateName in backend/filesystem/operations.go. Kept in sync
 * deliberately: a mock that accepts "../escape" would let a test pass against
 * behaviour the real backend refuses.
 */
function assertValidName(name: string, path: string): void {
  if (!name.trim()) throw new FsError('invalid-name', 'The name cannot be empty', path)
  if (name === '.' || name === '..') throw new FsError('invalid-name', 'That name is reserved', path)
  if (name.includes('/')) throw new FsError('invalid-name', 'A name cannot contain "/"', path)
  if (name.includes('\0')) {
    throw new FsError('invalid-name', 'A name cannot contain a null character', path)
  }
  if (name.length > 255) throw new FsError('invalid-name', 'That name is too long', path)
}

function transfer(
  sources: string[],
  destDir: string,
  policy: ConflictPolicy,
  mode: 'copy' | 'move',
): OperationResult {
  const result: OperationResult = { succeeded: [], conflicts: [], failures: [] }
  const destination = normalize(destDir)

  for (const source of sources) {
    const node = nodes.get(normalize(source))
    if (!node) {
      result.failures.push({ path: source, message: 'Source no longer exists' })
      continue
    }
    if (node.isDirectory && isAncestor(node.path, destination)) {
      // Checked for copy as well as move: copying a folder into its own subtree
      // would grow without terminating.
      result.failures.push({ path: source, message: 'A folder cannot be moved into itself' })
      continue
    }

    const taken = new Set(childrenOf(destination).map((child) => basename(child.path)))
    let name = basename(node.path)

    // Already where it was asked to go. Only keep-both is meaningful here —
    // that is Duplicate; any other policy would replace the item with itself.
    if (join(destination, name) === node.path && policy !== 'keep-both') {
      result.succeeded.push({ source: node.path, target: node.path })
      continue
    }

    if (taken.has(name)) {
      switch (policy) {
        case 'skip':
          continue
        case 'keep-both':
          name = nextAvailableName(name, taken)
          break
        case 'replace': {
          const victim = join(destination, name)
          for (const descendant of descendantsOf(victim)) nodes.delete(descendant.path)
          nodes.delete(victim)
          break
        }
        default:
          // 'fail', and anything unrecognised. Defaulting an unknown policy to
          // "ask" rather than "overwrite" keeps a typo from destroying data.
          result.conflicts.push(source)
          continue
      }
    }

    const target = join(destination, name)
    const subtree = [node, ...descendantsOf(node.path)]
    for (const item of subtree) {
      const rebased = item.path === node.path ? target : target + item.path.slice(node.path.length)
      nodes.set(rebased, { ...item, path: rebased })
      if (mode === 'move') nodes.delete(item.path)
    }

    if (mode === 'move') emit('remove', node.path)
    emit('create', target)
    result.succeeded.push({ source: node.path, target })
  }

  return result
}

function create(
  parent: string,
  name: string,
  isDirectory: boolean,
  content = '',
  executable = false,
): FileItem {
  const parentPath = normalize(parent)
  assertValidName(name, parentPath)
  requireNode(parentPath)
  const path = join(parentPath, name)
  // Mirrors the backend's O_EXCL: creation never overwrites, whatever content
  // it was handed (M15 decision 3). A mock that replaced the node would let a
  // test pass against behaviour the real filesystem refuses.
  if (nodes.has(path)) {
    throw new FsError('already-exists', `${name} already exists`, path)
  }
  const node: Node = {
    path,
    isDirectory,
    size: content.length,
    createdAt: FIXED_NOW,
    modifiedAt: FIXED_NOW,
    ...(content ? { content } : {}),
    ...(executable ? { executable: true } : {}),
  }
  nodes.set(path, node)
  emit('create', path)
  return toFileItem(node)
}

/** Moves a node and its whole subtree onto a new path prefix. */
function rekey(node: Node, target: string): Node {
  for (const descendant of descendantsOf(node.path)) {
    const rebased = target + descendant.path.slice(node.path.length)
    nodes.set(rebased, { ...descendant, path: rebased })
    nodes.delete(descendant.path)
  }
  nodes.delete(node.path)
  const moved: Node = { ...node, path: target }
  nodes.set(target, moved)
  return moved
}

/**
 * Trash is a move, not a delete — mirroring the backend, so undo has something
 * to restore from. A mock that discarded the node would make undo untestable.
 */
function moveToTrash(paths: string[]): TrashedItem[] {
  const trashed: TrashedItem[] = []
  for (const path of paths) {
    const node = requireNode(path)
    const taken = new Set(childrenOf(TRASH).map((child) => basename(child.path)))
    const target = join(TRASH, nextAvailableName(basename(node.path), taken))
    const original = node.path
    rekey(node, target)
    emit('remove', original)
    trashed.push({ originalPath: original, trashPath: target })
  }
  return trashed
}

function remove(paths: string[]): void {
  for (const path of paths) {
    const node = requireNode(path)
    for (const descendant of descendantsOf(node.path)) nodes.delete(descendant.path)
    nodes.delete(node.path)
    emit('remove', node.path)
  }
}

/**
 * The in-memory equivalent of the Go walk.
 *
 * Kept in step with backend/search deliberately — the criteria semantics
 * (case-insensitive name match, hidden subtrees skipped whole, size bounds
 * applying to files only) are what the UI is written against, and a mock that
 * matched differently would let tests pass against behaviour the app does not
 * have.
 */
function runSearch(criteria: SearchCriteria): FileItem[] {
  const root = normalize(criteria.root)
  const query = criteria.query.trim().toLowerCase()
  const extensions = new Set(
    criteria.extensions.map((extension) => extension.replace(/^\./, '').toLowerCase()),
  )
  const limit = criteria.maxResults > 0 ? criteria.maxResults : 5000

  const results: FileItem[] = []
  for (const node of [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    if (node.path === root || !isAncestor(root, node.path)) continue

    const relative = node.path.slice(root === ROOT ? 1 : root.length + 1)
    // A hidden ancestor hides everything beneath it, as skipping the subtree
    // does in the backend.
    if (!criteria.includeHidden && relative.split('/').some(isHiddenName)) continue

    const item = toFileItem(node)
    if (query && !item.name.toLowerCase().includes(query)) continue
    if (criteria.kind === 'file' && item.isDirectory) continue
    if (criteria.kind === 'folder' && !item.isDirectory) continue
    if (extensions.size > 0 && (item.isDirectory || !extensions.has(item.extension))) continue

    if (!item.isDirectory) {
      if (criteria.minSize > 0 && item.size < criteria.minSize) continue
      if (criteria.maxSize > 0 && item.size > criteria.maxSize) continue
    }
    if (criteria.modifiedAfter > 0 && item.modifiedAt < criteria.modifiedAfter) continue
    if (criteria.modifiedBefore > 0 && item.modifiedAt > criteria.modifiedBefore) continue

    results.push(item)
    if (results.length >= limit) break
  }
  return results
}

const searchHandlers = new Set<SearchHandlers>()
const cancelled = new Set<string>()
let searchCounter = 0

const dropHandlers = new Set<(drop: ExternalDrop) => void>()

/**
 * Test hook: simulates Finder dropping files onto the window.
 *
 * The real event comes from the native layer above the webview, so there is no
 * way to produce it from a test — this is the seam that makes the handling
 * testable at all.
 */
export function __emitFileDrop(drop: ExternalDrop): void {
  for (const handler of dropHandlers) handler(drop)
}

const hashHandlers = new Set<HashHandlers>()
const hashCancelled = new Set<string>()
let hashCounter = 0
let saidSoAboutDigests = false

/**
 * A stand-in digest, derived from what the mock knows a file's bytes to be.
 *
 * Web Crypto has no MD5, no SHA-224 and no CRC32, so a faithful mock would mean
 * shipping a second hash implementation in TypeScript: a second thing to get
 * wrong, and a standing invitation for something to use it for real. Digest
 * *correctness* is a Go concern, pinned there by published test vectors for
 * every algorithm (PLAN.md M14 decision 15).
 *
 * What this does preserve is the property the UI is written against: equal
 * content produces an equal digest, so match-grouping and the verify field have
 * something true to work with. A mock file is defined by its size and its
 * content, and a copy keeps both — so duplicating a file and hashing both really
 * does badge them as matching.
 */
function syntheticDigest(seed: string, length: number): string {
  // FNV-1a for the seed, xorshift32 to expand it. Neither is a hash anybody
  // should mistake for one, which is rather the point.
  let state = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 0x01000193) >>> 0
  }
  if (state === 0) state = 0x9e3779b9

  let hex = ''
  while (hex.length < length) {
    state = (state ^ (state << 13)) >>> 0
    state = (state ^ (state >>> 17)) >>> 0
    state = (state ^ (state << 5)) >>> 0
    hex += state.toString(16).padStart(8, '0')
  }
  return hex.slice(0, length)
}

/* ---------- archives (M18) ---------- */

const archiveHandlers = new Set<ArchiveHandlers>()
const archiveCancelled = new Set<string>()
let archiveCounter = 0
let mountCounter = 0

/**
 * A mock archive is a JSON manifest stored as the file's content.
 *
 * There is no compression here and there could not be: the point of the mock is
 * that the *UI* — mounting, browsing, progress, the password prompt, releasing —
 * can be driven with no Go process. Whether the bytes are really deflated is
 * `backend/archive`'s business, and its own tests check that against the real
 * `unzip`, `tar` and an independent AES implementation.
 */
interface MockArchive {
  mock: 'archive'
  password: string
  entries: { name: string; content: string; size: number }[]
}

function readMockArchive(path: string): MockArchive | null {
  const node = nodes.get(normalize(path))
  if (!node || node.isDirectory) return null
  try {
    const parsed: unknown = JSON.parse(node.content ?? '')
    if (typeof parsed === 'object' && parsed !== null && (parsed as MockArchive).mock === 'archive') {
      return parsed as MockArchive
    }
  } catch {
    // Not one of ours.
  }
  return null
}

/** Every directory between `root` and `path`, inclusive, outermost first. */
function ancestorsBetween(root: string, path: string): string[] {
  const chain: string[] = []
  let current = path
  while (current && current !== root && current !== ROOT && isAncestor(root, current)) {
    chain.unshift(current)
    current = dirname(current)
  }
  return chain
}

/** Every descendant of a source, with the name it takes inside the archive. */
function manifestFor(sources: readonly string[]): MockArchive['entries'] {
  const entries: MockArchive['entries'] = []
  for (const source of sources) {
    const node = nodes.get(normalize(source))
    if (!node) continue
    const base = dirname(node.path)
    const collect = (candidate: Node) => {
      if (candidate.isDirectory) return
      entries.push({
        name: candidate.path.slice(base.length + 1),
        content: candidate.content ?? '',
        size: candidate.size,
      })
    }
    collect(node)
    for (const descendant of descendantsOf(node.path)) collect(descendant)
  }
  return entries
}

const menuHandlers = new Set<(id: string) => void>()

/**
 * Test hook: simulates a pick from the native macOS menu.
 *
 * Same reasoning as `__emitFileDrop` — the menu lives outside the webview, so
 * this is the only way to exercise the dispatch path without a running app.
 */
export function __emitMenuCommand(id: string): void {
  for (const handler of menuHandlers) handler(id)
}

export const bridge: Bridge = {
  fs: {
    // Async so the not-found throw becomes a rejection. Reading a missing
    // directory is an error, not an empty folder — the backend reports
    // not-found, and a mock that returned [] made a deleted folder look merely
    // empty, hiding the whole error path from tests and browser dev.
    readDirectory: async (path, options) => {
      const node = requireNode(path)
      if (!node.isDirectory) {
        throw new FsError('not-a-directory', `${basename(node.path)} is not a folder`, node.path)
      }
      return childrenOf(node.path)
        .map(toFileItem)
        .filter((item) => options?.includeHidden || !item.hidden)
    },
    // `async` throughout below: these can fail, and an async method turns a
    // throw into a rejection. A synchronous throw from a Promise-returning API
    // would bypass every `.catch()` in the app.
    readFileInfo: async (path) => toFileItem(requireNode(path)),
    readTextFile: async (path) => requireNode(path).content ?? '',
    readFileBase64: async (path) => {
      requireNode(path)
      return TRANSPARENT_PIXEL
    },
    listVolumes: () =>
      Promise.resolve([
        {
          name: 'Macintosh HD',
          path: ROOT,
          totalBytes: 994_662_584_320,
          freeBytes: 412_316_860_416,
          removable: false,
          root: true,
        },
        {
          name: 'External',
          path: '/Volumes/External',
          totalBytes: 549_755_813_888,
          freeBytes: 466_035_507_200,
          removable: true,
          root: false,
        },
      ]),
    standardPaths: () =>
      Promise.resolve({
        home: HOME,
        desktop: join(HOME, 'Desktop'),
        documents: join(HOME, 'Documents'),
        downloads: join(HOME, 'Downloads'),
        applications: '/Applications',
        movies: join(HOME, 'Movies'),
        music: join(HOME, 'Music'),
        pictures: join(HOME, 'Pictures'),
        trash: join(HOME, '.Trash'),
        // Mirrors the backend: beside the database, not in the home tree. Not
        // seeded — the folder starts absent here exactly as it does on a fresh
        // install, so the "create it on first open" path is the one tests take.
        templates: join(HOME, 'Library/Application Support/MacFileExplorer/Templates'),
      }),
    exists: (path) => Promise.resolve(nodes.has(normalize(path))),
    readFileInfos: async (paths) =>
      paths
        .map((path) => nodes.get(normalize(path)))
        .filter((node): node is Node => node !== undefined)
        .map(toFileItem),
    createFolder: async (parent, name) => create(parent, name, true),
    createFile: async (parent, name, content, executable) =>
      create(parent, name, false, content, executable),
    rename: async (path, newName) => {
      assertValidName(newName, normalize(path))
      const node = requireNode(path)
      const target = join(dirname(node.path), newName)
      if (target === node.path) return toFileItem(node)
      if (nodes.has(target)) {
        throw new FsError('already-exists', `${newName} already exists`, target)
      }

      const renamed = rekey(node, target)
      emit('rename', target)
      return toFileItem(renamed)
    },
    move: async (sources, destDir, policy) => transfer(sources, destDir, policy, 'move'),
    copy: async (sources, destDir, policy) => transfer(sources, destDir, policy, 'copy'),
    trash: async (paths) => moveToTrash(paths),
    delete: async (paths) => remove(paths),
    // Mirrors the backend: replaces rather than merges, and an empty list
    // means untagged rather than "tagged with nothing".
    setTags: async (paths, tags) => {
      const applied = normaliseTags(tags)
      for (const path of paths) {
        const node = requireNode(path)
        if (applied.length === 0) {
          delete node.tags
        } else {
          node.tags = applied.map((tag) => ({ ...tag }))
        }
        // Setting an extended attribute is a change to the file's metadata, and
        // the real watcher reports it as one — so the listing refreshes the
        // same way it does after a chmod.
        emit('chmod', path)
      }
    },
  },
  search: {
    find: async (criteria) => {
      searchCounter += 1
      const id = `mock-search-${searchCounter}`
      const items = runSearch(criteria)

      // Delivered on a microtask, not synchronously: the caller has not yet
      // received the id when find() is still running, so a synchronous batch
      // would arrive for a search the UI cannot attribute yet.
      void Promise.resolve().then(() => {
        if (cancelled.has(id)) {
          cancelled.delete(id)
          for (const handler of searchHandlers) {
            handler.onDone({ id, scanned: 0, matched: 0, truncated: false, cancelled: true, error: '' })
          }
          return
        }
        for (const handler of searchHandlers) {
          if (items.length > 0) handler.onBatch({ id, items, scanned: items.length })
          handler.onDone({
            id,
            scanned: items.length,
            matched: items.length,
            truncated: criteria.maxResults > 0 && items.length >= criteria.maxResults,
            cancelled: false,
            error: '',
          })
        }
      })

      return id
    },
    cancel: async (id) => {
      cancelled.add(id)
    },
    subscribe: (handlers) => {
      searchHandlers.add(handlers)
      return () => searchHandlers.delete(handlers)
    },
  },
  desktop: {
    // Finder cannot reach a mock, so this exists to be driven by tests through
    // `__emitFileDrop`.
    onFileDrop: (handler) => {
      dropHandlers.add(handler)
      return () => dropHandlers.delete(handler)
    },
    // Likewise unreachable without a native menu; driven by `__emitMenuCommand`.
    onMenuCommand: (handler) => {
      menuHandlers.add(handler)
      return () => menuHandlers.delete(handler)
    },
  },
  watcher: {
    watch: (path) => {
      watched.add(normalize(path))
      return Promise.resolve()
    },
    unwatch: (path) => {
      watched.delete(normalize(path))
      return Promise.resolve()
    },
    subscribe: (handler) => {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  },
  shell: {
    openFile: (path) => {
      console.info('[mock] open', path)
      return Promise.resolve()
    },
    revealInFinder: (path) => {
      console.info('[mock] reveal', path)
      return Promise.resolve()
    },
    openWith: (path, appPath) => {
      console.info('[mock] openWith', path, appPath)
      return Promise.resolve()
    },
  },
  dialogs: {
    openDirectory: () => Promise.resolve(HOME),
    save: (_title, defaultName) => Promise.resolve(join(HOME, defaultName ?? 'Untitled')),
    message: (options) => Promise.resolve(options.defaultButton ?? options.buttons[0] ?? 'OK'),
  },
  // Real SQLite (sql.js), so migrations and repositories are exercised against
  // an actual SQL engine rather than a fake that would accept invalid SQL.
  db: mockDb,
  thumbs: {
    // A 1×1 transparent PNG as a data URL — enough for the caching, the
    // IntersectionObserver plumbing and the img element to be exercised.
    generate: async (path) => {
      const node = requireNode(path)
      if (node.isDirectory) throw new FsError('unknown', 'a folder has no thumbnail', path)
      return `data:image/png;base64,${TRANSPARENT_PIXEL}`
    },
  },
  archives: {
    create: async (request) => {
      archiveCounter += 1
      const id = `mock-archive-${archiveCounter}`
      const entries = manifestFor(request.sources)

      void Promise.resolve().then(() => {
        if (archiveCancelled.has(id)) {
          archiveCancelled.delete(id)
          for (const handler of archiveHandlers) {
            handler.onDone({ id, path: '', entries: 0, bytes: 0, cancelled: true })
          }
          return
        }

        const payload: MockArchive = { mock: 'archive', password: request.password, entries }
        const body = JSON.stringify(payload)
        const parent = dirname(request.destination)
        const name = basename(request.destination)

        try {
          // Through `create`, so the mock keeps the backend's O_EXCL promise:
          // compressing onto an existing name fails rather than overwriting it.
          create(parent, name, false, body)
        } catch (error) {
          for (const handler of archiveHandlers) {
            handler.onDone({
              id, path: '', entries: 0, bytes: 0, cancelled: false,
              error: error instanceof FsError ? error : new FsError('unknown', String(error)),
            })
          }
          return
        }

        const bytes = entries.reduce((sum, entry) => sum + entry.size, 0)
        for (const handler of archiveHandlers) {
          handler.onProgress({ id, entry: entries[0]?.name ?? '', done: bytes, total: bytes })
          handler.onDone({
            id, path: request.destination, entries: entries.length, bytes, cancelled: false,
          })
        }
      })

      return id
    },

    extract: async (request) => {
      archiveCounter += 1
      const id = `mock-archive-${archiveCounter}`
      const archive = readMockArchive(request.path)

      void Promise.resolve().then(() => {
        const fail = (error: FsError) => {
          for (const handler of archiveHandlers) {
            handler.onDone({ id, path: '', entries: 0, bytes: 0, cancelled: false, error })
          }
        }

        if (archiveCancelled.has(id)) {
          archiveCancelled.delete(id)
          for (const handler of archiveHandlers) {
            handler.onDone({ id, path: '', entries: 0, bytes: 0, cancelled: true })
          }
          return
        }
        if (!archive) {
          fail(new FsError('unknown', 'this file is not an archive we can open', request.path))
          return
        }
        if (archive.password && archive.password !== request.password) {
          fail(
            new FsError(
              'password-required',
              request.password ? 'That password did not work.' : 'This archive is protected. Enter its password.',
              request.path,
            ),
          )
          return
        }

        let bytes = 0
        for (const entry of archive.entries) {
          // The same refusal the backend makes, so a test can prove the UI
          // reports it rather than proving the mock is lenient.
          if (entry.name.split('/').includes('..') || entry.name.startsWith('/')) {
            fail(
              new FsError(
                'unknown',
                'this archive contains an entry that would write outside the destination',
                request.path,
              ),
            )
            return
          }

          const target = join(request.destination, entry.name)
          const parent = dirname(target)
          if (!nodes.has(parent)) {
            for (const segment of ancestorsBetween(request.destination, parent)) {
              if (!nodes.has(segment)) {
                nodes.set(segment, {
                  path: segment, isDirectory: true, size: 0,
                  createdAt: FIXED_NOW, modifiedAt: FIXED_NOW,
                })
              }
            }
          }
          nodes.set(target, {
            path: target, isDirectory: false, size: entry.size,
            createdAt: FIXED_NOW, modifiedAt: FIXED_NOW,
            ...(entry.content ? { content: entry.content } : {}),
            ...(request.readOnly ? { readOnly: true } : {}),
          })
          bytes += entry.size
        }

        for (const handler of archiveHandlers) {
          handler.onProgress({ id, entry: archive.entries[0]?.name ?? '', done: bytes, total: bytes })
          handler.onDone({
            id, path: request.destination, entries: archive.entries.length, bytes, cancelled: false,
          })
        }
      })

      return id
    },

    cancel: async (id) => {
      archiveCancelled.add(id)
    },

    // Beside the archive under a hashed, hidden name, as `backend/archive` does
    // (§M21). The location is the part the UI can see — the breadcrumb, the
    // session guard and "is this pane inside a mount" all read the path — so a
    // mock that kept extracting somewhere else would be testing a layout the
    // app no longer has.
    newMount: async (archivePath) => {
      const archive = normalize(archivePath)
      const beside = dirname(archive)
      let root = join(beside, `${MOUNT_PREFIX}${syntheticDigest(archive, 16)}`)
      // The backend falls back to a sibling with a random name when the hashed
      // one is already taken — a second pane opening the same archive while the
      // first extraction is still running.
      if (nodes.has(root)) {
        mountCounter += 1
        root = join(beside, `${MOUNT_PREFIX}${mountCounter}`)
      }

      nodes.set(root, {
        path: root, isDirectory: true, size: 0, createdAt: FIXED_NOW, modifiedAt: FIXED_NOW,
      })
      const mount = join(root, basename(archive))
      nodes.set(mount, {
        path: mount, isDirectory: true, size: 0, createdAt: FIXED_NOW, modifiedAt: FIXED_NOW,
      })
      return mount
    },

    releaseMount: async (mountPath) => {
      const root = dirname(normalize(mountPath))
      // Mirrors the backend's guard: this deletes recursively — and now inside
      // the user's own folders — so anything without the app's prefix is
      // refused rather than trusted.
      if (!basename(root).startsWith(MOUNT_PREFIX)) {
        throw new FsError('unknown', 'that is not an archive mount', mountPath)
      }
      for (const descendant of descendantsOf(root)) nodes.delete(descendant.path)
      nodes.delete(root)
    },

    subscribe: (handlers) => {
      archiveHandlers.add(handlers)
      return () => archiveHandlers.delete(handlers)
    },
  },
  hashing: {
    hash: async (request) => {
      hashCounter += 1
      const id = `mock-hash-${hashCounter}`
      const { digestLength } = algorithmSpec(request.algorithm)

      // Said once per session, plainly, because a synthetic digest that looks
      // like a real one is exactly the kind of thing someone copies into a
      // ticket. Nothing marks the string itself: the UI has to receive digests
      // of the right shape or none of it is being exercised.
      if (!saidSoAboutDigests) {
        saidSoAboutDigests = true
        console.info(
          '[mock] hash digests are synthetic — derived from the mock filesystem, ' +
            'not computed. Real digests come from backend/hashing.',
        )
      }

      const deliver = (result: HashResult) => {
        for (const handler of hashHandlers) handler.onResult(result)
      }

      // Deferred to a microtask per file, which means the first result can be
      // delivered before the caller has the id — the same ordering the real
      // Wails IPC has, and the race M8 was bitten by. The service subscribes
      // first and buffers; delivering synchronously here would hide that.
      void (async () => {
        let completed = 0
        let failed = 0

        for (const path of request.paths) {
          await Promise.resolve()

          if (hashCancelled.has(id)) {
            hashCancelled.delete(id)
            for (const handler of hashHandlers) {
              handler.onDone({ id, completed, failed, cancelled: true })
            }
            return
          }

          const node = nodes.get(normalize(path))
          if (!node) {
            failed += 1
            deliver({
              id,
              path,
              digest: '',
              bytes: 0,
              error: new FsError('not-found', `No such file or directory: ${path}`, path),
            })
            continue
          }
          if (node.isDirectory) {
            failed += 1
            deliver({
              id,
              path: node.path,
              digest: '',
              bytes: 0,
              error: new FsError('unknown', 'a folder has no checksum', node.path),
            })
            continue
          }

          // One tick per file, so the progress path is exercised rather than
          // going straight from queued to done.
          for (const handler of hashHandlers) {
            handler.onProgress({
              id,
              path: node.path,
              bytesRead: Math.floor(node.size / 2),
              total: node.size,
            })
          }

          completed += 1
          deliver({
            id,
            path: node.path,
            digest: syntheticDigest(
              `${request.algorithm} ${node.size} ${node.content ?? ''}`,
              digestLength,
            ),
            bytes: node.size,
          })
        }

        for (const handler of hashHandlers) {
          handler.onDone({ id, completed, failed, cancelled: false })
        }
      })()

      return id
    },
    cancel: async (id) => {
      hashCancelled.add(id)
    },
    subscribe: (handlers) => {
      hashHandlers.add(handlers)
      return () => hashHandlers.delete(handlers)
    },
  },
}
