import { Fragment, useCallback, useRef } from 'react'
import { ExplorerPane } from './ExplorerPane'
import { useSplitResize } from '@/hooks/useSplitResize'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import type { Tab } from '@/types/workspace'

/**
 * Lays out a tab's panes with draggable dividers between them.
 *
 * Sizes are fractions applied as `flexGrow`, so a split survives a window
 * resize — the mockup wrote fixed pixel widths onto the DOM and did not.
 */
export function PaneGroup({ tab }: { tab: Tab }) {
  const panes = useWorkspaceStore((state) => state.panes)
  const setPaneSizes = useWorkspaceStore((state) => state.setPaneSizes)
  const setActivePane = useWorkspaceStore((state) => state.setActivePane)

  const container = useRef<HTMLDivElement>(null)

  const onResize = useCallback(
    (sizes: number[]) => setPaneSizes(tab.id, sizes),
    [setPaneSizes, tab.id],
  )

  const { startResize, nudge } = useSplitResize({
    containerRef: container,
    sizes: tab.paneSizes,
    onResize,
  })

  return (
    <div ref={container} className="flex min-w-0 flex-1 overflow-hidden">
      {tab.paneIds.map((paneId, index) => {
        const pane = panes[paneId]
        if (!pane) return null
        const last = index === tab.paneIds.length - 1

        return (
          <Fragment key={paneId}>
            <div
              className="flex min-w-0 flex-col overflow-hidden"
              style={{
                flexGrow: tab.paneSizes[index] ?? 1 / tab.paneIds.length,
                flexBasis: 0,
              }}
            >
              <ExplorerPane
                pane={pane}
                index={index}
                isActive={tab.activePaneId === paneId}
                showLetter={tab.paneIds.length > 1}
                onFocus={() => setActivePane(tab.id, paneId)}
              />
            </div>

            {!last && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize pane ${index + 1}`}
                tabIndex={0}
                onMouseDown={(event) => startResize(index, event)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault()
                    nudge(index, -1)
                  }
                  if (event.key === 'ArrowRight') {
                    event.preventDefault()
                    nudge(index, 1)
                  }
                }}
                className="bg-edge hover:bg-accent focus-visible:bg-accent w-1 shrink-0 cursor-col-resize transition-colors"
              />
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
