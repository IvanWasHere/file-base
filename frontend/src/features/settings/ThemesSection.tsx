import { Check, FolderOpen, RefreshCw, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { type Theme, type ThemeMode } from '@/constants/palette'
import { SYSTEM_THEME } from '@/constants/themes'
import { bridge } from '@/services/bridge'
import { standardPathsQuery } from '@/services/filesystem/queries'
import { exportTheme, refreshExternalThemes } from '@/services/theme/themeFiles'
import { resolveTheme, systemPrefersDark } from '@/services/theme/theme'
import { usableThemes, useThemeStore } from '@/stores/themeStore'
import { useToastStore } from '@/stores/toastStore'
import { useUiStore } from '@/stores/uiStore'

/**
 * Choosing a theme, and installing one (PLAN.md §M24).
 *
 * The list is the whole feature. Everything below it — Reload, the folder, the
 * export — exists so that "add your own" is a thing someone can actually do
 * without being told a file format first: press Export, get a complete file
 * named after a theme you already like, edit four lines, press Reload.
 *
 * Nothing is applied on OK, as everywhere else in Settings: clicking a theme
 * repaints the window behind the modal immediately. Seeing it is the
 * confirmation, and it is also how you find out you do not like it.
 */
export function ThemesSection() {
  const preference = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const external = useThemeStore((state) => state.external)
  const { data: paths } = useQuery(standardPathsQuery())
  const push = useToastStore((state) => state.push)
  const [busy, setBusy] = useState(false)

  const folder = paths?.themes ?? ''
  const installed = usableThemes(external)
  const broken = external.filter((theme) => theme.problem !== undefined)

  // Re-read on open rather than only at startup: the reason someone is looking
  // at this panel is often that they just edited a file in another window.
  useEffect(() => {
    if (folder) void refreshExternalThemes(folder)
  }, [folder])

  const reload = async () => {
    if (!folder || busy) return
    setBusy(true)
    try {
      const themes = await refreshExternalThemes(folder)
      const usable = themes.filter((theme) => theme.problem === undefined).length
      push({
        tone: 'success',
        message:
          themes.length === 0
            ? 'No themes in the folder yet'
            : `${usable} theme${usable === 1 ? '' : 's'} loaded`,
        ...(themes.length > usable
          ? { detail: `${themes.length - usable} file could not be used` }
          : {}),
      })
    } finally {
      setBusy(false)
    }
  }

  const reveal = async () => {
    if (!folder) return
    try {
      await bridge.fs.exists(folder)
      await bridge.shell.revealInFinder(folder)
    } catch {
      push({ tone: 'error', message: 'Could not open the themes folder', detail: folder })
    }
  }

  /**
   * Writes the theme currently on screen into the folder, under a new name.
   *
   * The current one rather than a blank template, because a palette is edited
   * by nudging: nobody sits down to choose thirty-three colours, they take the
   * one they nearly like and change the accent.
   */
  const exportCurrent = async () => {
    if (!folder || busy) return
    setBusy(true)
    try {
      const current = resolveTheme(preference, systemPrefersDark(), installed)
      const path = await exportTheme(folder, current)
      const themes = await refreshExternalThemes(folder)
      const created = themes.find((theme) => theme.path === path)
      // Selected straight away: the copy is identical to what is on screen, so
      // switching to it changes nothing visible and leaves every later edit of
      // the file one Reload from being seen.
      if (created && created.problem === undefined) setTheme(created.id)
      push({
        tone: 'success',
        message: 'Theme exported',
        detail: path,
        action: { label: 'Show', run: () => void bridge.shell.revealInFinder(path) },
      })
    } catch {
      push({ tone: 'error', message: 'Could not write the theme file', detail: folder })
    } finally {
      setBusy(false)
    }
  }

  const forMode = (mode: ThemeMode) =>
    installed.filter((theme) => theme.mode === mode && theme.source === 'builtin')
  const fromFolder = installed.filter((theme) => theme.source === 'external')

  return (
    <section>
      <header>
        <h3 className="font-display text-primary text-[14px] font-semibold">Themes</h3>
        <p className="text-secondary mt-1 text-[13px] leading-snug">
          A theme is only colours — every one the app draws. Nothing else about it can change, which
          is what makes one safe to take from a stranger.
        </p>
      </header>

      <ul className="mt-3 flex flex-col gap-0.5">
        <li>
          <ThemeRow
            name="Match System"
            detail="Follows macOS"
            checked={preference === SYSTEM_THEME}
            onSelect={() => setTheme(SYSTEM_THEME)}
          />
        </li>
      </ul>

      <Group label="Dark">
        {forMode('dark').map((theme) => (
          <ThemeRow
            key={theme.id}
            name={theme.name}
            swatch={theme}
            checked={preference === theme.id}
            onSelect={() => setTheme(theme.id)}
          />
        ))}
      </Group>

      <Group label="Light">
        {forMode('light').map((theme) => (
          <ThemeRow
            key={theme.id}
            name={theme.name}
            swatch={theme}
            checked={preference === theme.id}
            onSelect={() => setTheme(theme.id)}
          />
        ))}
      </Group>

      <Group label="From the themes folder">
        {fromFolder.length === 0 && broken.length === 0 && (
          <p className="text-muted px-2 py-1.5 text-[13px]">
            Nothing installed. Export a theme below to get a file to edit.
          </p>
        )}
        {fromFolder.map((theme) => (
          <ThemeRow
            key={theme.id}
            name={theme.name}
            swatch={theme}
            detail={theme.author ? `by ${theme.author}` : theme.mode === 'light' ? 'Light' : 'Dark'}
            note={theme.problem}
            checked={preference === theme.id}
            onSelect={() => setTheme(theme.id)}
          />
        ))}
        {/* Listed, not hidden: a file that silently did nothing reads as a bug
            in the app rather than a typo in the theme (§M15 decision 14). */}
        {broken.map((theme) => (
          <ThemeRow
            key={theme.id}
            name={theme.name}
            detail={theme.problem}
            disabled
            checked={false}
            onSelect={() => undefined}
          />
        ))}
      </Group>

      <div className="mt-5 flex flex-wrap gap-2">
        <Action
          icon={<RefreshCw size={12} />}
          label="Reload"
          onClick={() => void reload()}
          disabled={busy || !folder}
        />
        <Action
          icon={<FolderOpen size={12} />}
          label="Open Themes Folder"
          onClick={() => void reveal()}
          disabled={!folder}
        />
        <Action
          icon={<Upload size={12} />}
          label="Export Current Theme"
          onClick={() => void exportCurrent()}
          disabled={busy || !folder}
        />
      </div>

      <p className="text-muted mt-3 font-mono text-[11px] break-all">{folder}</p>
    </section>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <h4 className="text-muted mt-4 px-2 text-[11px] font-semibold tracking-wide uppercase">
        {label}
      </h4>
      <ul className="mt-1 flex flex-col gap-0.5">
        {Array.isArray(children) ? (
          children.map((child, index) => <li key={index}>{child}</li>)
        ) : (
          <li>{children}</li>
        )}
      </ul>
    </>
  )
}

/**
 * Five colours off the palette, which is enough to recognise a theme.
 *
 * A real preview would be a screenshot of the app, and the app is right there
 * behind the modal — clicking the row is a better preview than any swatch.
 */
function Swatch({ theme }: { theme: Theme }) {
  const keys = ['bg-surface', 'accent', 'ft-image', 'ft-code', 'text-primary'] as const
  return (
    <span
      aria-hidden
      className="border-edge flex h-4 shrink-0 overflow-hidden rounded border"
      style={{ width: 46 }}
    >
      {keys.map((key) => (
        <span key={key} className="h-full flex-1" style={{ background: theme.colors[key] }} />
      ))}
    </span>
  )
}

function ThemeRow({
  name,
  detail,
  note,
  swatch,
  checked,
  disabled,
  onSelect,
}: {
  name: string
  detail?: string | undefined
  note?: string | undefined
  swatch?: Theme | undefined
  checked: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
        disabled ? 'cursor-default opacity-60' : 'hover:bg-hover'
      } ${checked ? 'bg-[var(--accent-glow)]' : ''}`}
    >
      {swatch ? <Swatch theme={swatch} /> : <span aria-hidden className="w-[46px] shrink-0" />}
      <span className={`min-w-0 flex-1 truncate ${checked ? 'text-accent' : 'text-primary'}`}>
        {name}
      </span>
      {note && <span className="text-danger shrink-0 text-xs">{note}</span>}
      {detail && !note && <span className="text-muted shrink-0 text-xs">{detail}</span>}
      <span aria-hidden className="w-3 shrink-0">
        {checked && <Check size={12} className="text-accent" />}
      </span>
    </button>
  )
}

function Action({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="border-edge text-secondary hover:bg-hover hover:text-primary flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] transition-colors disabled:cursor-default disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  )
}
