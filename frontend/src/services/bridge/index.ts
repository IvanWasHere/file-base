/**
 * The public bridge entrypoint. Everything in the app imports native capability
 * from here and nowhere else:
 *
 *   import { bridge } from '@/services/bridge'
 *   const items = await bridge.fs.readDirectory(path)
 *
 * `@bridge` is a Vite alias resolving to impl/wails or impl/mock depending on
 * VITE_BRIDGE (see vite.config.ts).
 */

export { bridge } from '@bridge'
export type * from './types'
