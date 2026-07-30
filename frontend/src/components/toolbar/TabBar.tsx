import { Folder, Plus, X } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { basename, ROOT } from '@/utils/path'

/**
 * The mockup's `.tab-bar`, ported.
 *
 * Sits in its own full-width row below the menu bar, so tab titles get the
 * whole window width instead of sharing the title strip with the traffic
 * lights — the menu bar above now carries that inset.
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
      className="bg-deep border-edge flex h-9 shrink-0 items-end gap-0.5 border-b px-2"
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
            className={`group relative top-px flex max-w-[180px] min-w-[80px] cursor-default items-center gap-1.5 border border-b-0 px-3 py-1.5 text-xs font-medium transition-colors ${
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
        className="text-muted hover:bg-elevated hover:text-primary mb-1 ml-1 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
