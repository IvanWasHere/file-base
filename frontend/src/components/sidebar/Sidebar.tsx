import { useQuery } from '@tanstack/react-query'
import {
  Clapperboard,
  Clock,
  Download,
  FileText,
  HardDrive,
  Home,
  Image,
  LayoutGrid,
  Monitor,
  Music,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { useDropZone } from '@/hooks/useFileDrag'
import { useFavorites, useRecents } from '@/hooks/useFavorites'
import { useIsDropTarget } from '@/stores/dragStore'
import { standardPathsQuery, volumesQuery } from '@/services/filesystem/queries'
import { useActivePane, useActiveTab, useWorkspaceStore } from '@/stores/workspaceStore'
import type { StandardPaths } from '@/types/file'
import { formatSize } from '@/utils/format'
import { basename } from '@/utils/path'

/**
 * The mockup's `.sidebar`, ported — Quick Access, Drives, and the storage
 * meters — but sourced from the real filesystem instead of a hardcoded list.
 */

interface Favorite {
  key: keyof StandardPaths
  label: string
  icon: LucideIcon
  colorVar: string
}

const FAVORITES: Favorite[] = [
  { key: 'home', label: 'Home', icon: Home, colorVar: 'var(--accent)' },
  { key: 'desktop', label: 'Desktop', icon: Monitor, colorVar: 'var(--ft-document)' },
  { key: 'documents', label: 'Documents', icon: FileText, colorVar: 'var(--ft-document)' },
  { key: 'downloads', label: 'Downloads', icon: Download, colorVar: 'var(--ft-archive)' },
  { key: 'applications', label: 'Applications', icon: LayoutGrid, colorVar: 'var(--ft-code)' },
  { key: 'pictures', label: 'Pictures', icon: Image, colorVar: 'var(--ft-image)' },
  { key: 'music', label: 'Music', icon: Music, colorVar: 'var(--ft-music)' },
  { key: 'movies', label: 'Movies', icon: Clapperboard, colorVar: 'var(--ft-video)' },
  { key: 'trash', label: 'Trash', icon: Trash2, colorVar: 'var(--text-muted)' },
]

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="font-display text-muted px-1 pt-1 pb-2 text-[10px] font-semibold tracking-[1.2px] uppercase">
      {children}
    </div>
  )
}

/**
 * A place in the sidebar, which is also a drop target: dragging files onto
 * Documents or an external drive is one of the two things a sidebar is for.
 */
function SidebarItem({
  label,
  icon: Icon,
  colorVar,
  detail,
  active,
  path,
  onClick,
}: {
  label: string
  icon: LucideIcon
  colorVar?: string | undefined
  // `| undefined` explicitly: `exactOptionalPropertyTypes` distinguishes an
  // absent prop from one passed as undefined, and volumes without readable
  // capacity pass undefined here.
  detail?: string | undefined
  active: boolean
  path: string
  onClick: () => void
}) {
  const dropZone = useDropZone(path)
  const isTarget = useIsDropTarget(path)

  return (
    <button
      type="button"
      onClick={onClick}
      data-drop-path={path}
      {...dropZone}
      aria-current={active ? 'location' : undefined}
      title={label}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
        active
          ? 'text-accent bg-[var(--accent-glow)]'
          : 'text-secondary hover:bg-hover hover:text-primary'
      } ${isTarget ? 'ring-accent bg-[var(--accent-glow)] ring-2 ring-inset' : ''}`}
    >
      <Icon
        size={14}
        className="w-[18px] shrink-0"
        style={colorVar ? { color: colorVar } : undefined}
      />
      <span className="truncate">{label}</span>
      {detail && <span className="text-muted ml-auto shrink-0 text-[10px]">{detail}</span>}
    </button>
  )
}

export function Sidebar() {
  const tab = useActiveTab()
  const pane = useActivePane()
  const navigate = useWorkspaceStore((state) => state.navigate)

  const { data: paths } = useQuery(standardPathsQuery())
  const { data: volumes = [] } = useQuery(volumesQuery())
  const { favorites } = useFavorites()
  const { recents } = useRecents()

  const go = (path: string) => {
    if (pane) navigate(pane.id, path)
  }

  // Highlights when *any* pane in the tab is showing the location, matching the
  // mockup's `isActiveSidebarItem`.
  const panes = useWorkspaceStore((state) => state.panes)
  const isActive = (path: string): boolean =>
    !!tab && tab.paneIds.some((paneId) => panes[paneId]?.path === path)

  return (
    // A navigation landmark, not a complementary one: its job is moving the
    // active pane between locations.
    <nav
      aria-label="Places"
      className="bg-base border-edge flex w-[220px] shrink-0 flex-col gap-2 overflow-y-auto border-r p-[5px]"
    >
      <div>
        <SectionTitle>Quick Access</SectionTitle>
        {paths &&
          FAVORITES.map((favorite) => (
            <SidebarItem
              key={favorite.key}
              label={favorite.label}
              icon={favorite.icon}
              colorVar={favorite.colorVar}
              path={paths[favorite.key]}
              active={isActive(paths[favorite.key])}
              onClick={() => go(paths[favorite.key])}
            />
          ))}
      </div>

      {favorites.length > 0 && (
        <div>
          <SectionTitle>Favorites</SectionTitle>
          {favorites.map((favorite) => (
            <SidebarItem
              key={favorite.path}
              label={favorite.label}
              icon={Star}
              colorVar="var(--accent)"
              path={favorite.path}
              active={isActive(favorite.path)}
              onClick={() => go(favorite.path)}
            />
          ))}
        </div>
      )}

      {recents.length > 0 && (
        <div>
          <SectionTitle>Recent</SectionTitle>
          {recents.map((recent) => (
            <SidebarItem
              key={recent.path}
              label={basename(recent.path)}
              icon={Clock}
              path={recent.path}
              active={isActive(recent.path)}
              onClick={() => go(recent.path)}
            />
          ))}
        </div>
      )}

      {volumes.length > 0 && (
        <div>
          <SectionTitle>Drives</SectionTitle>
          {volumes.map((volume) => (
            <SidebarItem
              key={volume.path}
              label={volume.name}
              icon={HardDrive}
              detail={volume.totalBytes > 0 ? formatSize(volume.totalBytes) : undefined}
              path={volume.path}
              active={isActive(volume.path)}
              onClick={() => go(volume.path)}
            />
          ))}
        </div>
      )}

      {volumes.length > 0 && (
        <div className="border-edge mt-auto pt-3">
          <SectionTitle>Storage</SectionTitle>
          {volumes
            .filter((volume) => volume.totalBytes > 0)
            .map((volume) => {
              const used = volume.totalBytes - volume.freeBytes
              const ratio = used / volume.totalBytes
              return (
                <div key={volume.path} className="mb-2">
                  <div className="text-secondary mb-1 truncate text-[11px]">{volume.name}</div>
                  <div className="bg-hover h-1 overflow-hidden rounded-full">
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{
                        width: `${Math.min(ratio * 100, 100)}%`,
                        background: ratio > 0.8 ? 'var(--danger)' : 'var(--accent)',
                      }}
                    />
                  </div>
                  <div className="text-muted mt-1 text-[10px]">
                    {formatSize(volume.freeBytes)} free of {formatSize(volume.totalBytes)}
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </nav>
  )
}
