/**
 * Real Wails v2 implementation of the bridge contract.
 *
 * This file and its siblings under ./impl are the ONLY places permitted to
 * import from `wailsjs/` (see eslint.config.js). A move to Wails v3 rewrites
 * this directory and nothing else.
 *
 * Implemented in M1: filesystem reads and shell integration.
 * Still stubbed: mutations (M5/M6), dialogs (M6), watcher (M7), thumbs (M10).
 * Stubs throw a milestone-labelled error rather than silently resolving.
 */

import type { Bridge } from '../types'
import { guard, toFileItem } from './decode'
import {
  Exists,
  ListVolumes,
  ReadDirectory,
  ReadFileInfo,
  StandardPaths,
} from '../../../../wailsjs/go/filesystem/FS'
import { OpenFile, OpenWith, RevealInFinder } from '../../../../wailsjs/go/shell/Shell'

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

    createFolder: () => notImplemented('fs.createFolder', 'M6'),
    createFile: () => notImplemented('fs.createFile', 'M6'),
    rename: () => notImplemented('fs.rename', 'M6'),
    move: () => notImplemented('fs.move', 'M6'),
    copy: () => notImplemented('fs.copy', 'M6'),
    trash: () => notImplemented('fs.trash', 'M6'),
    delete: () => notImplemented('fs.delete', 'M6'),
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
    query: () => notImplemented('db.query', 'M5'),
    exec: () => notImplemented('db.exec', 'M5'),
    transaction: () => notImplemented('db.transaction', 'M5'),
  },
  thumbs: {
    generate: () => notImplemented('thumbs.generate', 'M10'),
  },
}
