import { Folder, Plus, X } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { basename, ROOT } from '@/utils/path'

/**
 * The mockup's `.tab-bar`, ported.
 *
 * The window uses a hidden-inset title bar, so this strip sits in the title
 * area and needs to clear the traffic lights — hence the left padding. The
 * whole bar is also the window's drag region, with the interactive parts opted
 * back out via `--wails-draggable: no-drag`.
 */
export function TabBar() {
  const tabs = useWorkspaceStore((state) => state.tabs)
  const panes = useWorkspaceStore((state) => state.panes)
  const activeTabId = useWorkspaceStore((state) => state.activeTabId)
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab)
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const openTab = useWorkspaceStore((state) => state.openTab)

  const labelFor = (tabId: string): string => {
    const tab = tabs.find((candidate) => candidate.id === tabId)
    const path = tab ? panes[tab.activePaneId]?.path : undefined
    if (!path) return 'Untitled'
    return path === ROOT ? 'Macintosh HD' : basename(path)
  }

  const activePath = (() => {
    const tab = tabs.find((candidate) => candidate.id === activeTabId)
    return tab ? (panes[tab.activePaneId]?.path ?? ROOT) : ROOT
  })()

  return (
    <div
      role="tablist"
      aria-label="Open tabs"
      className="bg-deep border-edge flex h-10 shrink-0 items-end gap-0.5 border-b pr-2"
      style={{ paddingLeft: 78, '--wails-draggable': 'drag' } as React.CSSProperties}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setActiveTab(tab.id)
              }
            }}
            title={labelFor(tab.id)}
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
            className={`group relative top-px flex max-w-[180px] min-w-[80px] cursor-default items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? 'border-accent text-accent bg-surface z-10'
                : 'border-edge bg-surface text-secondary hover:bg-elevated hover:text-primary'
            }`}
          >
            <Folder size={11} className="shrink-0" />
            <span className="truncate">{labelFor(tab.id)}</span>
            <button
              type="button"
              aria-label={`Close ${labelFor(tab.id)}`}
              onClick={(event) => {
                event.stopPropagation()
                closeTab(tab.id)
              }}
              className="hover:bg-hover ml-auto flex size-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
            >
              <X size={10} />
            </button>
          </div>
        )
      })}

      <button
        type="button"
        aria-label="New tab"
        onClick={() => openTab(activePath)}
        style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
        className="text-muted hover:bg-elevated hover:text-primary mb-1 ml-1 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
