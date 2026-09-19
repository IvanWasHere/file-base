import { ChevronLeft, ChevronRight, Folder, Plus, X } from 'lucide-react'
import { useEffect } from 'react'
import { useOverflowScroll } from '@/hooks/useOverflowScroll'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { basename, ROOT } from '@/utils/path'

/**
 * How many characters of a folder's name a tab promises to show (§M28).
 *
 * Ten, because that is where a name stops being a name: "Docum…" and
 * "Downlo…" are the same word to someone glancing at a bar, and a tab you
 * cannot read is a tab you have to click to identify — which is the whole job
 * the bar exists to save.
 */
const MIN_CHARACTERS = 10

/**
 * The text a tab is sized never to be narrower than.
 *
 * The ellipsis is part of it: a truncated label has to fit ten characters
 * *and* the mark that says there are more, or the tab shows nine and a dot.
 * A name that already fits needs neither, which is what keeps a tab called
 * "dev" from being padded out to the width of one called "Screenshots".
 */
function floorText(label: string): string {
  return label.length > MIN_CHARACTERS ? `${label.slice(0, MIN_CHARACTERS)}…` : label
}

/**
 * The mockup's `.tab-bar`, ported.
 *
 * Sits in its own full-width row below the menu bar, so tab titles get the
 * whole window width instead of sharing the title strip with the traffic
 * lights — the menu bar above now carries that inset.
 *
 * Tabs shrink as they multiply, down to a width where a name is still worth
 * reading — ten characters of it, or all of it when it is shorter (§M28).
 * Past that the strip scrolls rather than shrinking further (§M27). The
 * arrows and the New Tab button sit outside it, because a control that scrolls
 * away is a control nobody can reach.
 */
export function TabBar() {
  const tabs = useWorkspaceStore((state) => state.tabs)
  const panes = useWorkspaceStore((state) => state.panes)
  const activeTabId = useWorkspaceStore((state) => state.activeTabId)
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab)
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const openTab = useWorkspaceStore((state) => state.openTab)

  // Destructured rather than held as one object: the lint rule that guards
  // against reading a ref during render cannot tell `strip.overflowing` from
  // `strip.ref`, and flags every use of the whole.
  const {
    ref: stripRef,
    overflowing,
    atStart,
    atEnd,
    scroll,
    measure,
  } = useOverflowScroll<HTMLDivElement>()

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

  // Opening or closing a tab changes the strip's width without resizing it, so
  // the arrows have to be told. The ResizeObserver inside the hook only sees
  // the box, not what is in it.
  useEffect(() => {
    measure()
  }, [tabs.length, measure])

  /**
   * The tab you just switched to has to be visible, or Cmd+T on a full strip
   * opens a tab off the right-hand edge and the window appears not to have
   * changed. `nearest` so a tab already on screen is left where it is.
   */
  useEffect(() => {
    if (!activeTabId) return
    const element = stripRef.current?.querySelector(`[data-tab-id="${activeTabId}"]`)
    // jsdom has no `scrollIntoView`, and this is a reveal rather than the
    // feature — not being able to do it should not take the tab bar with it.
    if (element instanceof HTMLElement && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [activeTabId, stripRef])

  return (
    <div className="bg-deep border-edge flex h-9 shrink-0 items-end gap-0.5 border-b px-2">
      {overflowing && (
        <ScrollButton
          direction={-1}
          label="Scroll tabs left"
          disabled={atStart}
          onScroll={scroll}
        />
      )}

      <div
        ref={stripRef}
        role="tablist"
        aria-label="Open tabs"
        // `min-w-0` so the strip may be narrower than its content — without it
        // a flex item refuses to shrink below its intrinsic width and the bar
        // grows past the window instead of scrolling.
        //
        // `-mb-px pb-px` buys back the pixel the strip costs. A tab's `top-px`
        // lifts it over the bar's bottom border — the pixel that joins the
        // active tab to the pane below it — and an overflow container clips at
        // its padding box, so without the negative margin to reach that far and
        // the padding to keep the tab inside, that pixel is cut off and the
        // active tab floats free of the pane.
        className="tab-strip -mb-px flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden pb-px"
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          const label = labelFor(tab.id)
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
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
              title={label}
              // No `min-w-*`: a flex item's automatic minimum is its
              // min-content width, and the sizer below is what that adds up
              // to. The floor is therefore the icon, the close button, the
              // padding and ten characters — measured by the browser, in the
              // font it is actually drawing, rather than by arithmetic here
              // that would have to be kept in step with the markup (§M28).
              // `max-w-[260px]` rather than the 180px a tab used to be capped
              // at, because a cap and a floor cannot argue: CSS clamps a
              // content-based minimum by whatever fixed maximum is in force,
              // through `max-width`, through a grid track's growth limit, and
              // through a flex item's automatic minimum alike. At 180px the
              // clamp won and a ten-character CJK name was cut to eight, with
              // the close button pushed out past the tab's own border. 260 sits
              // above the widest floor there is — ten full-width glyphs, an
              // ellipsis and the furniture come to about 198px — so the cap
              // goes on doing its job of stopping one long name from eating the
              // bar, without ever being the thing that decides how much of a
              // name is readable.
              className={`group relative top-px flex max-w-[260px] cursor-default items-center gap-1.5 border border-b-0 px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'border-accent text-accent bg-surface z-10'
                  : 'border-edge bg-surface text-secondary hover:bg-elevated hover:text-primary'
              }`}
            >
              <Folder size={11} className="shrink-0" />
              {/*
                Two texts in one grid cell: the first is never painted and sets
                how narrow the cell may become, the second is the label and
                truncates inside whatever width that leaves. An `auto` grid
                track takes its minimum from the widest item's min-content, and
                the truncating one has a min-content of zero — so the sizer
                alone decides the floor.

                Measured rather than calculated because `ch` is the width of a
                zero, and a zero is nothing like a Chinese character or a
                capital W: a `10ch` floor showed five characters of a CJK name
                and six of an all-caps one (§M28).
              */}
              <span className="grid">
                <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap">
                  {floorText(label)}
                </span>
                <span className="col-start-1 row-start-1 truncate">{label}</span>
              </span>
              <button
                type="button"
                aria-label={`Close ${label}`}
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
      </div>

      {overflowing && (
        <ScrollButton direction={1} label="Scroll tabs right" disabled={atEnd} onScroll={scroll} />
      )}

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

/**
 * Disabled rather than hidden at the end it cannot travel: a button that
 * vanishes takes its width with it, and the tabs would shuffle sideways every
 * time the strip reached an edge.
 */
function ScrollButton({
  direction,
  label,
  disabled,
  onScroll,
}: {
  direction: -1 | 1
  label: string
  disabled: boolean
  onScroll: (direction: -1 | 1) => void
}) {
  const Icon = direction === -1 ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={() => onScroll(direction)}
      className="text-muted hover:bg-elevated hover:text-primary mb-1 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-30"
    >
      <Icon size={14} />
    </button>
  )
}
