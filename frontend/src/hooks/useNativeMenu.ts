import { useEffect, useRef } from 'react'
import { isMenuCommandId } from '@/constants/menus'
import { useMenuCommands } from '@/hooks/useMenuCommands'
import { bridge } from '@/services/bridge'

/**
 * Dispatches picks from the native macOS menu (`backend/appmenu`).
 *
 * The native menu carries labels and command ids and nothing else — no state,
 * no enablement. Whether a command can run is decided here, at the moment it is
 * invoked, from the same `isEnabled` the in-window menus use. Keeping enablement
 * out of Go avoids pushing a menu update across the bridge on every selection
 * change, which is several times a second while a marquee is being dragged.
 */
export function useNativeMenu(): void {
  const commands = useMenuCommands()

  // Subscribed once. `useMenuCommands` returns new closures every render, and
  // re-subscribing to a native event stream that often would be churn.
  const latest = useRef(commands)
  useEffect(() => {
    latest.current = commands
  }, [commands])

  useEffect(
    () =>
      bridge.desktop.onMenuCommand((id) => {
        // A native menu built by an older binary can name a command this build
        // no longer has; ignoring it beats dispatching into a dead switch.
        if (!isMenuCommandId(id)) return
        if (latest.current.isEnabled(id)) latest.current.run(id)
      }),
    [],
  )
}
