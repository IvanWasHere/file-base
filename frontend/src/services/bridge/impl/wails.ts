/**
 * Real Wails v2 implementation of the bridge contract.
 *
 * This file and its siblings under ./impl are the ONLY places permitted to
 * import from `wailsjs/` (see eslint.config.js). A move to Wails v3 rewrites
 * this directory and nothing else.
 *
 * Implemented in M1: filesystem reads and shell integration.
 * Implemented since: mutations (M6), watcher (M7), search (M8), file drop (M9),
 * previews and thumbnails (M10).
 * Still stubbed: dialogs, whose two in-window consumers landed in M6 instead.
 * Stubs throw a labelled error rather than silently resolving.
 */

import type { Bridge } from '../types'
import {
  fileDropEvent,
  guard,
  hashDoneEvent,
  hashProgressEvent,
  hashResultEvent,
  menuCommandEvent,
  searchBatchEvent,
  searchDoneEvent,
  toFileItem,
  toFileSystemEvent,
  toHashDone,
  toHashProgress,
  toHashResult,
  toOperationResult,
  toExternalDrop,
  toSearchBatch,
  toSearchDone,
  watcherEvent,
} from './decode'
import {
  Copy,
  CreateFile,
  CreateFolder,
  Delete,
  Exists,
  ListVolumes,
  Move,
  ReadDirectory,
  ReadFileBase64,
  ReadFileInfo,
  ReadFileInfos,
  ReadTextFile,
  Rename,
  StandardPaths,
  Trash,
} from '../../../../wailsjs/go/filesystem/FS'
import { Cancel, Find } from '../../../../wailsjs/go/search/Search'
// Aliased: both packages bind a `Cancel`, and importing them under one name
// would silently give whichever came last.
import { Cancel as CancelHash, Hash } from '../../../../wailsjs/go/hashing/Hashing'
import { Generate } from '../../../../wailsjs/go/thumbs/Thumbs'
import { OpenFile, OpenWith, RevealInFinder } from '../../../../wailsjs/go/shell/Shell'
import { Exec, Query, Tx } from '../../../../wailsjs/go/db/DB'
import { Unwatch, Watch } from '../../../../wailsjs/go/watcher/Watcher'
import { EventsOn } from '../../../../wailsjs/runtime/runtime'

function notImplemented(method: string, milestone: string): never {
  throw new Error(
    `bridge.${method} is not wired up yet — Go implementation lands in ${milestone}. ` +
      `Run with VITE_BRIDGE=mock to use the in-memory filesystem.`,
  )
}

export const bridge: Bridge = {
  fs: {
    /**
     * Go returns hidden entries flagged rather than removed — "show hidden
     * files" is a user setting, so the filter belongs here, not in the backend.
     */
    readDirectory: (path, options) =>
      guard(async () => {
        const wire = await ReadDirectory(path, options?.followSymlinks ?? false)
        const items = wire.map(toFileItem)
        return options?.includeHidden ? items : items.filter((item) => !item.hidden)
      }),
    readFileInfo: (path) => guard(async () => toFileItem(await ReadFileInfo(path))),
    readTextFile: (path, maxBytes) => guard(() => ReadTextFile(path, maxBytes)),
    readFileBase64: (path, maxBytes) => guard(() => ReadFileBase64(path, maxBytes)),
    listVolumes: () => guard(() => ListVolumes()),
    standardPaths: () => guard(() => StandardPaths()),
    exists: (path) => guard(() => Exists(path)),
    readFileInfos: (paths) =>
      guard(async () => (await ReadFileInfos(paths)).map(toFileItem)),

    createFolder: (parent, name) =>
      guard(async () => toFileItem(await CreateFolder(parent, name))),
    createFile: (parent, name) => guard(async () => toFileItem(await CreateFile(parent, name))),
    rename: (path, newName) => guard(async () => toFileItem(await Rename(path, newName))),
    // The conflict policy is decided in TS and applied in Go — Go never picks a
    // winner (PLAN.md §1). `OpResult` is structurally `OperationResult`, so it
    // needs no translation, only the class-to-plain-object flattening.
    move: (sources, destDir, policy) =>
      guard(async () => toOperationResult(await Move(sources, destDir, policy))),
    copy: (sources, destDir, policy) =>
      guard(async () => toOperationResult(await Copy(sources, destDir, policy))),
    trash: (paths) =>
      guard(async () =>
        (await Trash(paths)).map((item) => ({
          originalPath: item.originalPath,
          trashPath: item.trashPath,
        })),
      ),
    delete: (paths) => guard(() => Delete(paths)),
  },
  search: {
    find: (criteria) => guard(() => Find(criteria)),
    cancel: (id) => guard(() => Cancel(id)),
    // Both streams are subscribed together and torn down together: a listener
    // for completion that outlived its result listener would report a search
    // finishing with results nobody collected.
    subscribe: (handlers) => {
      const offBatch = EventsOn(searchBatchEvent, (payload: unknown) => {
        const batch = toSearchBatch(payload)
        if (batch) handlers.onBatch(batch)
      })
      const offDone = EventsOn(searchDoneEvent, (payload: unknown) => {
        const done = toSearchDone(payload)
        if (done) handlers.onDone(done)
      })
      return () => {
        offBatch()
        offDone()
      }
    },
  },
  desktop: {
    onFileDrop: (handler) =>
      EventsOn(fileDropEvent, (payload: unknown) => {
        const drop = toExternalDrop(payload)
        if (drop) handler(drop)
      }),
    onMenuCommand: (handler) =>
      EventsOn(menuCommandEvent, (payload: unknown) => {
        if (typeof payload === 'string' && payload.length > 0) handler(payload)
      }),
  },
  watcher: {
    watch: (path) => guard(() => Watch(path)),
    unwatch: (path) => guard(() => Unwatch(path)),
    // EventsOn already returns its own unsubscribe, which is exactly the
    // contract the bridge asks for.
    subscribe: (handler) =>
      EventsOn(watcherEvent, (payload: unknown) => {
        const event = toFileSystemEvent(payload)
        if (event) handler(event)
      }),
  },
  shell: {
    openFile: (path) => guard(() => OpenFile(path)),
    revealInFinder: (path) => guard(() => RevealInFinder(path)),
    openWith: (path, appPath) => guard(() => OpenWith(path, appPath)),
  },
  dialogs: {
    openDirectory: () => notImplemented('dialogs.openDirectory', 'M6'),
    save: () => notImplemented('dialogs.save', 'M6'),
    message: () => notImplemented('dialogs.message', 'M6'),
  },
  db: {
    // Go owns the driver; every query, migration and table lives in
    // services/db on this side of the bridge (PLAN.md §0).
    query: <T>(sql: string, args: unknown[] = []) => guard(() => Query(sql, args) as Promise<T[]>),
    exec: (sql, args = []) => guard(() => Exec(sql, args)),
    transaction: (statements) =>
      guard(() =>
        Tx(statements.map((statement) => ({ sql: statement.sql, args: statement.args }))),
      ),
  },
  thumbs: {
    generate: (path, size) => guard(() => Generate(path, size)),
  },
  hashing: {
    hash: (request) => guard(() => Hash(request)),
    cancel: (id) => guard(() => CancelHash(id)),
    // All three streams are subscribed and torn down together, as in search: a
    // completion listener that outlived its result listener would report a job
    // finishing with digests nobody collected.
    subscribe: (handlers) => {
      const offResult = EventsOn(hashResultEvent, (payload: unknown) => {
        const result = toHashResult(payload)
        if (result) handlers.onResult(result)
      })
      const offProgress = EventsOn(hashProgressEvent, (payload: unknown) => {
        const progress = toHashProgress(payload)
        if (progress) handlers.onProgress(progress)
      })
      const offDone = EventsOn(hashDoneEvent, (payload: unknown) => {
        const done = toHashDone(payload)
        if (done) handlers.onDone(done)
      })
      return () => {
        offResult()
        offProgress()
        offDone()
      }
    },
  },
}
