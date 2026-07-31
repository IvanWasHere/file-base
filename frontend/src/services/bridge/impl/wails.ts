/**
 * Real Wails v2 implementation of the bridge contract.
 *
 * This file and its siblings under ./impl are the ONLY places permitted to
 * import from `wailsjs/` (see eslint.config.js). A move to Wails v3 rewrites
 * this directory and nothing else.
 *
 * Implemented in M1: filesystem reads and shell integration.
 * Implemented in M6: filesystem mutations.
 * Still stubbed: dialogs (M6), watcher (M7), previews and thumbs (M10).
 * Stubs throw a milestone-labelled error rather than silently resolving.
 */

import type { Bridge } from '../types'
import { guard, toFileItem, toOperationResult } from './decode'
import {
  Copy,
  CreateFile,
  CreateFolder,
  Delete,
  Exists,
  ListVolumes,
  Move,
  ReadDirectory,
  ReadFileInfo,
  Rename,
  StandardPaths,
  Trash,
} from '../../../../wailsjs/go/filesystem/FS'
import { OpenFile, OpenWith, RevealInFinder } from '../../../../wailsjs/go/shell/Shell'
import { Exec, Query, Tx } from '../../../../wailsjs/go/db/DB'

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
    readTextFile: () => notImplemented('fs.readTextFile', 'M10'),
    readFileBase64: () => notImplemented('fs.readFileBase64', 'M10'),
    listVolumes: () => guard(() => ListVolumes()),
    standardPaths: () => guard(() => StandardPaths()),
    exists: (path) => guard(() => Exists(path)),

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
  watcher: {
    watch: () => notImplemented('watcher.watch', 'M7'),
    unwatch: () => notImplemented('watcher.unwatch', 'M7'),
    subscribe: () => notImplemented('watcher.subscribe', 'M7'),
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
    generate: () => notImplemented('thumbs.generate', 'M10'),
  },
}
