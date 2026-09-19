import { useQuery } from '@tanstack/react-query'
import {
  Download,
  FileText,
  Home,
  LayoutGrid,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { useDropZone } from '@/hooks/useFileDrag'
import { standardPathsQuery } from '@/services/filesystem/queries'
import { useIsDropTarget } from '@/stores/dragStore'
import { useUiStore } from '@/stores/uiStore'
import { useActivePane, useActiveTab, useWorkspaceStore } from '@/stores/workspaceStore'
import type { StandardPaths } from '@/types/file'

/**
 * The icon rail (PLAN.md §M29).
 *
 * A second, much narrower sidebar to the left of the first, holding the six
 * places people actually keep things in. It is *always* on screen — that is
 * the point of it, and why the button that hides the wide sidebar lives here
 * rather than in the sidebar it hides: a control that disappears with the
 * thing it controls cannot bring it back.
 *
 * Six places rather than the nine next door: this is the short list, and a
 * rail long enough to need scrolling would be a sidebar with the words taken
 * off. Pictures, Music and Movies stay in the wide one.
 */

interface Place {
  key: keyof StandardPaths
  label: string
  icon: LucideIcon
  /** Matches the wide sidebar's colour for the same place (§M24). */
  colorVar: string
}

const PLACES: Place[] = [
  { key: 'home', label: 'Home', icon: Home, colorVar: 'var(--accent)' },
  { key: 'desktop', label: 'Desktop', icon: Monitor, colorVar: 'var(--ft-document)' },
  { key: 'documents', label: 'Documents', icon: FileText, colorVar: 'var(--ft-document)' },
  { key: 'applications', label: 'Applications', icon: LayoutGrid, colorVar: 'var(--ft-code)' },
  { key: 'downloads', label: 'Downloads', icon: Download, colorVar: 'var(--ft-archive)' },
  { key: 'trash', label: 'Trash', icon: Trash2, colorVar: 'var(--text-muted)' },
]

export function PlacesRail() {
  const tab = useActiveTab()
  const pane = useActivePane()
  const panes = useWorkspaceStore((state) => state.panes)
  const navigate = useWorkspaceStore((state) => state.navigate)
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)

  const { data: paths } = useQuery(standardPathsQuery())

  // Highlights when *any* pane in the tab is showing the location, which is
  // what the wide sidebar does — two sidebars disagreeing about where you are
  // would be worse than either of them being wrong.
  const isActive = (path: string): boolean =>
    !!tab && tab.paneIds.some((paneId) => panes[paneId]?.path === path)

  return (
    // A second navigation landmark beside "Places", named so the two are
    // distinguishable to anyone listing them.
    <nav
      aria-label="Quick places"
      className="bg-deep border-edge flex w-11 shrink-0 flex-col items-center gap-0.5 border-r py-1.5"
    >
      <button
        type="button"
        aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-expanded={sidebarOpen}
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        onClick={toggleSidebar}
        className="text-muted hover:bg-hover hover:text-primary flex size-8 shrink-0 items-center justify-center rounded-md transition-colors"
      >
        {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>

      {/* A rule, because the button above acts on the window and everything
          below it acts on the pane. Decorative, not a `separator`: the only
          separators this app exposes are the draggable dividers between panes,
          and a line drawn between a button and six links is not one of those. */}
      <div aria-hidden className="bg-edge my-1 h-px w-5" />

      {paths &&
        PLACES.map((place) => (
          <RailButton
            key={place.key}
            label={place.label}
            icon={place.icon}
            colorVar={place.colorVar}
            path={paths[place.key]}
            active={isActive(paths[place.key])}
            onClick={() => {
              if (pane) navigate(pane.id, paths[place.key])
            }}
          />
        ))}
    </nav>
  )
}

/**
 * One place, and a drop target like its twin in the wide sidebar.
 *
 * Dropping onto it matters more here than there: the rail is what is left when
 * the wide sidebar is hidden, and hiding a sidebar should not take away the
 * ability to drag a file into Documents.
 */
function RailButton({
  label,
  icon: Icon,
  colorVar,
  path,
  active,
  onClick,
}: {
  label: string
  icon: LucideIcon
  colorVar: string
  path: string
  active: boolean
  onClick: () => void
}) {
  const dropZone = useDropZone(path)
  const isTarget = useIsDropTarget(path)

  return (
    <button
      type="button"
      // Both, and the same words: the tooltip is what makes an icon-only rail
      // usable, and the accessible name is what makes it usable without one.
      aria-label={label}
      title={label}
      onClick={onClick}
      data-drop-path={path}
      {...dropZone}
      aria-current={active ? 'location' : undefined}
      className={`flex size-8 shrink-0 items-center justify-center rounded-md transition-colors ${
        active ? 'bg-[var(--accent-glow)]' : 'hover:bg-hover'
      } ${isTarget ? 'ring-accent bg-[var(--accent-glow)] ring-2 ring-inset' : ''}`}
    >
      <Icon size={16} style={{ color: colorVar }} />
    </button>
  )
}
