/**
 * §M27: the tab strip scrolls once tabs stop fitting.
 *
 * jsdom has no layout, so nothing ever overflows on its own and `scrollLeft`
 * is inert. `makeScrollable` installs a real scroll container's arithmetic on
 * the strip — a width, a content width, clamping at both ends and a `scroll`
 * event — which is exactly what the component reads. What is *not* faked is
 * anything the component does: the measuring, the clamped arithmetic of a
 * button press and the wheel translation are all its own.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { TabBar } from './TabBar'
import { __resetIdCounter, useWorkspaceStore } from '@/stores/workspaceStore'

const HOME = '/Users/dev'

const strip = () => screen.getByRole('tablist', { name: 'Open tabs' })
const leftButton = () => screen.queryByRole('button', { name: 'Scroll tabs left' })
const rightButton = () => screen.queryByRole('button', { name: 'Scroll tabs right' })

/** Opens `count` tabs, so the strip has something to overflow with. */
function openTabs(count: number): void {
  const { openTab } = useWorkspaceStore.getState()
  for (let i = 0; i < count; i++) openTab(`${HOME}/folder-${i}`)
}

/**
 * Gives an element the scrolling behaviour jsdom does not implement.
 *
 * Returns a reader for the offset, so a test can assert where the strip ended
 * up rather than only that something was called.
 */
function makeScrollable(
  element: HTMLElement,
  { content, visible }: { content: number; visible: number },
): () => number {
  let scrollLeft = 0
  const limit = Math.max(0, content - visible)

  Object.defineProperty(element, 'scrollWidth', { configurable: true, get: () => content })
  Object.defineProperty(element, 'clientWidth', { configurable: true, get: () => visible })
  Object.defineProperty(element, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      // A real container clamps, which is what makes "at the end" reachable.
      scrollLeft = Math.min(Math.max(0, value), limit)
      element.dispatchEvent(new Event('scroll'))
    },
  })

  // The component measured on mount, before any of this existed.
  fireEvent.scroll(element)
  return () => scrollLeft
}

beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [], panes: {}, activeTabId: null })
  __resetIdCounter()
})

/**
 * The invisible text a tab is sized never to be narrower than.
 *
 * jsdom has no layout, so what is checked here is the *contract* — which
 * characters the tab is holding room for. Whether that room is wide enough is
 * the browser's arithmetic, not the component's, and was measured against the
 * running app instead (§M28).
 */
const floorTextOf = (tab: HTMLElement): string =>
  // `span`, because the folder icon beside it is aria-hidden too.
  tab.querySelector('span[aria-hidden="true"]')?.textContent ?? ''

const tabNamed = (name: string): HTMLElement =>
  screen.getAllByRole('tab').find((tab) => tab.textContent?.includes(name))!

describe('how narrow a tab may get', () => {
  it('holds ten characters of a long name open, and the ellipsis after them', () => {
    useWorkspaceStore.getState().openTab(`${HOME}/Screenshots and Drafts`)
    render(<TabBar />)

    // The mark that says there are more characters takes room of its own; a
    // floor without it shows nine characters and a dot.
    expect(floorTextOf(tabNamed('Screenshots and Drafts'))).toBe('Screenshot…')
  })

  it('asks for no more than the name it has', () => {
    useWorkspaceStore.getState().openTab(`${HOME}/dev`)
    render(<TabBar />)

    // Otherwise a tab called "dev" would be padded out to the width of one
    // called "Screenshots", and a bar of short names would waste most of a
    // window.
    expect(floorTextOf(tabNamed('dev'))).toBe('dev')
  })

  it('counts a name of exactly ten as fitting', () => {
    useWorkspaceStore.getState().openTab(`${HOME}/Ten Chars!`)
    render(<TabBar />)

    expect('Ten Chars!').toHaveLength(10)
    // No ellipsis is coming, so no room is held for one.
    expect(floorTextOf(tabNamed('Ten Chars!'))).toBe('Ten Chars!')
  })

  it('measures the floor in the script the name is written in', () => {
    useWorkspaceStore.getState().openTab(`${HOME}/文档文件夹文档文件夹文档`)
    render(<TabBar />)

    // Ten characters, not ten zeroes' worth of width: a CJK glyph is about
    // twice as wide as the `ch` unit, and a floor priced in `ch` showed five
    // of these.
    expect(floorTextOf(tabNamed('文档'))).toBe('文档文件夹文档文件夹…')
  })

  it('keeps the sizer out of the accessible name', () => {
    useWorkspaceStore.getState().openTab(`${HOME}/Screenshots and Drafts`)
    render(<TabBar />)

    // Hidden from assistive technology, or every tab would announce its name
    // twice — once truncated.
    expect(screen.getByRole('tab', { name: 'Screenshots and Drafts' })).toBeInTheDocument()
  })
})

describe('the tab strip', () => {
  it('shows no arrows while the tabs fit', async () => {
    openTabs(2)
    render(<TabBar />)

    expect(await screen.findAllByRole('tab')).toHaveLength(2)
    expect(leftButton()).toBeNull()
    expect(rightButton()).toBeNull()
  })

  it('shows both arrows once they do not, with Left dead at the start', async () => {
    openTabs(20)
    render(<TabBar />)
    makeScrollable(strip(), { content: 3000, visible: 800 })

    await waitFor(() => expect(leftButton()).toBeInTheDocument())
    // Nothing is hidden to the left yet, so the button is present but dead —
    // present, because a button that comes and goes shifts the tabs sideways
    // every time the strip reaches an edge.
    expect(leftButton()).toBeDisabled()
    expect(rightButton()).toBeEnabled()
  })

  it('scrolls a screenful when an arrow is pressed', async () => {
    const user = userEvent.setup()
    openTabs(20)
    render(<TabBar />)
    const at = makeScrollable(strip(), { content: 3000, visible: 800 })

    await waitFor(() => expect(rightButton()).toBeEnabled())
    await user.click(rightButton()!)

    // 60% of the visible width: most of a screenful, with an item of context
    // carried over.
    expect(at()).toBe(480)
    await waitFor(() => expect(leftButton()).toBeEnabled())

    await user.click(leftButton()!)
    expect(at()).toBe(0)
    await waitFor(() => expect(leftButton()).toBeDisabled())
  })

  it('adds a second press to the first, not to where the strip has got to', async () => {
    const user = userEvent.setup()
    openTabs(20)
    render(<TabBar />)
    const at = makeScrollable(strip(), { content: 3000, visible: 800 })

    await waitFor(() => expect(rightButton()).toBeEnabled())

    // `scroll-behavior: smooth` means the strip is still travelling when the
    // second press lands, and `scrollLeft` reads where it *is*. Measuring from
    // there would make two presses move less than two steps — modelled here by
    // the strip lagging halfway behind.
    await user.click(rightButton()!)
    const target = at()
    Object.defineProperty(strip(), 'scrollLeft', {
      configurable: true,
      get: () => target / 2,
      set: (value: number) => {
        Object.defineProperty(strip(), 'scrollLeft', { configurable: true, value })
      },
    })

    await user.click(rightButton()!)
    expect(strip().scrollLeft).toBe(960)
  })

  it('stops at the far end rather than scrolling into nothing', async () => {
    const user = userEvent.setup()
    openTabs(20)
    render(<TabBar />)
    const at = makeScrollable(strip(), { content: 1000, visible: 800 })

    await waitFor(() => expect(rightButton()).toBeEnabled())
    await user.click(rightButton()!)

    // A 480px step into 200px of travel: the container clamps, and the button
    // has to notice that it has arrived.
    expect(at()).toBe(200)
    await waitFor(() => expect(rightButton()).toBeDisabled())
    expect(leftButton()).toBeEnabled()
  })

  it('turns a vertical wheel into sideways travel', () => {
    openTabs(20)
    render(<TabBar />)
    const at = makeScrollable(strip(), { content: 3000, visible: 800 })

    const event = new WheelEvent('wheel', {
      deltaY: 120,
      deltaX: 0,
      cancelable: true,
      bubbles: true,
    })
    strip().dispatchEvent(event)

    expect(at()).toBe(120)
    // Claimed, so the gesture does not also reach whatever would scroll behind.
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves a sideways gesture to the element itself', () => {
    openTabs(20)
    render(<TabBar />)
    const at = makeScrollable(strip(), { content: 3000, visible: 800 })

    // A trackpad swipe is already horizontal scrolling and the container
    // handles it natively; translating it too would double the distance.
    const event = new WheelEvent('wheel', {
      deltaX: 90,
      deltaY: 4,
      cancelable: true,
      bubbles: true,
    })
    strip().dispatchEvent(event)

    expect(at()).toBe(0)
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores the wheel when everything already fits', () => {
    openTabs(2)
    render(<TabBar />)
    const at = makeScrollable(strip(), { content: 400, visible: 800 })

    const event = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true })
    strip().dispatchEvent(event)

    expect(at()).toBe(0)
    // Not claimed: over a strip with nowhere to go, the gesture belongs to
    // whatever is behind it.
    expect(event.defaultPrevented).toBe(false)
  })

  it('keeps the arrows and New Tab out of the scrolling area', async () => {
    openTabs(20)
    render(<TabBar />)
    makeScrollable(strip(), { content: 3000, visible: 800 })

    await waitFor(() => expect(rightButton()).toBeInTheDocument())
    // A control that scrolls away with the tabs is a control nobody can reach.
    expect(within(strip()).queryByRole('button', { name: 'New tab' })).toBeNull()
    expect(within(strip()).queryByRole('button', { name: 'Scroll tabs right' })).toBeNull()
    // And the tablist holds tabs and nothing else, which is what the role means.
    expect(within(strip()).getAllByRole('tab')).toHaveLength(20)
  })
})
