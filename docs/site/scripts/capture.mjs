/**
 * Regenerates the guide's screenshots in docs/site/assets/img/guide.
 *
 * Drives the frontend against the mock bridge (an in-memory /Users/dev), so the
 * images are repeatable and contain no real filenames. The mock has no image
 * bytes, so the mock module is rewritten on its way to the browser to paint a
 * landscape per image path — nothing in the app itself changes.
 *
 * Usage:
 *   (cd frontend && npm run dev:mock -- --port 5199 --strictPort)   # in one terminal
 *   cd docs/site/scripts && npm i --no-save playwright && npx playwright install chromium
 *   node capture.mjs            # every scene
 *   node capture.mjs photos,search   # just these
 *   node capture.mjs readme          # the four README images in docs/screenshots
 *
 * Shots are taken at 2× and 1280×800, then scaled to 1600px wide with `sips`.
 */

import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://localhost:5199/'
const OUT = new URL('../assets/img/guide/', import.meta.url).pathname
const RAW = new URL('./raw/', import.meta.url).pathname
mkdirSync(RAW, { recursive: true })

// Paints a landscape "photo" per filename, so image views have pixels to show.
const PAINTER = `
async function __paint(path, w, h) {
  let s = 0; for (const c of path) s = (s * 31 + c.charCodeAt(0)) >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const skies = [['#0f2027','#f7797d'],['#1e3c72','#f6d365'],['#355c7d','#f8b195'],['#141e30','#7f7fd5'],['#2c3e50','#fd746c'],['#0b486b','#f56217'],['#3a1c71','#ffaf7b']]
  const [a, b] = skies[Math.floor(rnd() * skies.length)]
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d')
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, a); sky.addColorStop(1, b)
  g.fillStyle = sky; g.fillRect(0, 0, w, h)
  g.fillStyle = 'rgba(255,240,200,0.9)'; g.beginPath(); g.arc(w * (0.2 + rnd() * 0.6), h * (0.3 + rnd() * 0.2), h * 0.08, 0, 7); g.fill()
  for (let layer = 0; layer < 4; layer++) {
    const base = h * (0.5 + layer * 0.13), shade = 20 + layer * 14
    g.fillStyle = 'rgba(' + (shade / 2) + ',' + (shade / 2) + ',' + shade + ',' + (0.55 + layer * 0.15) + ')'
    g.beginPath(); g.moveTo(0, h); let y = base
    for (let x = 0; x <= w; x += w / 12) { y = base - rnd() * h * 0.18; g.lineTo(x, y) }
    g.lineTo(w, h); g.fill()
  }
  const blob = await c.convertToBlob({ type: 'image/png' })
  const bytes = new Uint8Array(await blob.arrayBuffer()); let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
const __isImg = (p) => /\\.(jpe?g|png|gif|webp|heic)$/i.test(p)
`

/**
 * The window's close / minimise / zoom buttons, where macOS draws them over the
 * app's inset title bar. The browser has no window, so the README shots would
 * otherwise show an empty strip where every real screenshot has them.
 */
function drawTrafficLights() {
  const bar = document.createElement('div')
  bar.style.cssText = 'position:fixed;top:19px;left:20px;display:flex;gap:8px;z-index:2147483647;pointer-events:none'
  for (const color of ['#ff5f57', '#febc2e', '#28c840']) {
    const dot = document.createElement('span')
    dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${color};box-shadow:inset 0 0 0 0.5px rgba(0,0,0,.25)`
    bar.append(dot)
  }
  document.body.append(bar)
}

async function scene(name, fn, { width = 1280, height = 800, clipTop = 36, out = OUT, maxSize = 1600, chrome = false } = {}) {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
  await p.route(/\/src\/services\/bridge\/impl\/mock\.ts/, async (route) => {
    const res = await route.fetch()
    let body = await res.text()
    body = body.replace(/readFileBase64: async \(path\) => \{\s*requireNode\(path\);?\s*return TRANSPARENT_PIXEL;?/,
      'readFileBase64: async (path) => { requireNode(path); return __isImg(path) ? __paint(path, 1600, 1066) : TRANSPARENT_PIXEL;')
    body = body.replace('return `data:image/png;base64,${TRANSPARENT_PIXEL}`',
      'return `data:image/png;base64,${__isImg(path) ? await __paint(path, 480, 320) : TRANSPARENT_PIXEL}`')
    if (!body.includes('__paint(path, 1600')) throw new Error('painter patch did not apply')
    await route.fulfill({ response: res, body: PAINTER + body })
  })
  await p.goto(APP)
  await p.getByRole('row', { name: /^Documents\b/ }).waitFor()
  try {
    await fn(p)
    if (chrome) await p.evaluate(drawTrafficLights)
    await p.waitForTimeout(800)
    await p.screenshot({ path: `${RAW}${name}.png`, clip: { x: 0, y: clipTop, width, height: height - clipTop } })
    execFileSync('sips', ['-Z', String(maxSize), `${RAW}${name}.png`, '--out', `${out}${name}.png`], { stdio: 'ignore' })
    console.log('ok', name)
  } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); await p.screenshot({ path: `${RAW}${name}-FAIL.png` }) }
  await b.close()
}
const row = (p, n) => p.getByRole('row', { name: new RegExp(`^${n}\\b`) }).first()
async function go(p, ...names) { for (const n of names) await row(p, n).dblclick() }

const menu = async (p, top, item) => {
  await p.getByRole('menubar', { name: 'Application' }).getByRole('menuitem', { name: top, exact: true }).click()
  if (item) await p.getByRole('menuitem', { name: item }).first().click()
}
const showPreview = (p) => p.getByRole('button', { name: 'Toggle preview' }).click()

const SCENES = {
  overview: async (p) => { await go(p, 'Pictures', 'Wallpapers'); await showPreview(p); await row(p, 'neon-city\\.jpg').click(); await p.waitForTimeout(1500) },
  details: async (p) => { await go(p, 'Documents'); await row(p, 'Meeting Notes\\.docx').click() },
  icons: async (p) => { await go(p, 'Pictures', 'Camera Roll'); await p.keyboard.press('Meta+2'); await p.waitForTimeout(1000) },
  photos: async (p) => { await go(p, 'Pictures', 'Wallpapers'); await p.keyboard.press('Meta+5'); await p.waitForTimeout(1500) },
  'image-metadata': [async (p) => { await go(p, 'Pictures', 'Camera Roll'); await showPreview(p); await row(p, 'IMG_20250101_001\\.jpg').click(); await p.waitForTimeout(1500) }, { height: 1000 }],
  'menu-view': async (p) => { await menu(p, 'View'); await p.getByRole('menuitem', { name: 'Split Layout' }).hover() },
  'split-grid': async (p) => {
    await menu(p, 'View'); await p.getByRole('menuitem', { name: 'Split Layout' }).hover()
    await p.getByRole('menuitemcheckbox', { name: /2 × 2/ }).click()
    const dirs = [['Documents'], ['Pictures', 'Wallpapers'], ['Downloads'], ['Projects']]
    for (let i = 0; i < 4; i++) for (const d of dirs[i]) {
      await p.getByRole('grid').nth(i).getByRole('row', { name: new RegExp(`^${d}\\b`) }).first().dblclick()
      await p.waitForTimeout(300)
    }
    await p.getByRole('grid').nth(1).getByRole('row', { name: /^neon-city/ }).click()
    await p.keyboard.press('Meta+2')
  },
  'context-menu': [async (p) => { await go(p, 'Documents'); await row(p, 'Annual Report 2024\\.pdf').click({ button: 'right', position: { x: 120, y: 10 } }) }, { height: 900 }],
  search: async (p) => {
    await p.getByRole('button', { name: 'Search' }).first().click()
    await p.getByRole('button', { name: 'Subfolders' }).click()
    await p.locator('input[aria-label="Search"]').fill('report')
    await p.waitForTimeout(1500)
  },
  'search-filters': async (p) => { await p.getByRole('button', { name: 'Search' }).first().click(); await p.getByRole('button', { name: 'Filters' }).click() },
  compress: async (p) => {
    await go(p, 'Documents')
    await row(p, 'Annual Report 2024\\.pdf').click()
    await row(p, 'Resume\\.pdf').click({ modifiers: ['Shift'] })
    await menu(p, 'File', 'Compress…')
  },
  hashes: async (p) => { await go(p, 'Downloads'); await row(p, 'node-v20\\.11\\.0-x64\\.pkg').click(); await p.getByRole('button', { name: 'Calculate Hashes' }).click(); await p.waitForTimeout(1500) },
  template: async (p) => { await go(p, 'Projects'); await menu(p, 'File', 'New File from Template…'); await p.getByText('Markdown Document').click() },
  settings: async (p) => { await menu(p, 'File', 'Settings…') },
  tags: async (p) => { await go(p, 'Documents'); await row(p, 'Meeting Notes\\.docx').click(); await menu(p, 'File', 'Tags…') },
  'open-with': async (p) => { await go(p, 'Documents'); await row(p, 'Meeting Notes\\.docx').click(); await menu(p, 'File', 'Open With…') },
  'text-reader': async (p) => {
    await go(p, 'Movies')
    await p.getByRole('row').nth(1).click({ button: 'right' })
    await p.getByRole('menuitem', { name: 'Open in Text Reader' }).click()
    await p.waitForTimeout(1200)
  },
  light: async (p) => {
    await menu(p, 'View'); await p.getByRole('menuitem', { name: 'Theme' }).hover()
    await p.getByRole('menuitemcheckbox', { name: /Light/ }).first().click()
    await go(p, 'Documents'); await showPreview(p); await row(p, 'Project Roadmap\\.pptx').click()
  },
}

/**
 * The four images in the root README's table (docs/screenshots/screen1-4.png).
 * 16:9 at 1920×1080, the whole window including the title-bar strip.
 */
const README = { width: 1440, height: 810, clipTop: 0, chrome: true, maxSize: 1920, out: new URL('../../screenshots/', import.meta.url).pathname }

const pane = (p, i) => p.getByRole('grid').nth(i)
const paneRow = (p, i, name) => pane(p, i).getByRole('row', { name: new RegExp(`^${name}\\b`) }).first()

/** A lived-in window: three tabs, Split Right with three folders, one in Photos view. */
async function workspace(p) {
  // Open in New Tab switches to the tab it opens, so come back each time.
  for (const folder of ['Downloads', 'Projects']) {
    await row(p, folder).click({ button: 'right' })
    await p.getByRole('menuitem', { name: 'Open in New Tab' }).click()
    await p.getByRole('tab').first().click()
    await row(p, 'Documents').waitFor()
  }
  await menu(p, 'View'); await p.getByRole('menuitem', { name: 'Split Layout' }).hover()
  await p.getByRole('menuitemcheckbox', { name: 'Split Right' }).click()
  const dirs = [['Documents'], ['Pictures', 'Wallpapers'], ['Projects', 'vault-explorer']]
  for (let i = 0; i < 3; i++) for (const d of dirs[i]) { await paneRow(p, i, d).dblclick(); await p.waitForTimeout(300) }
  await paneRow(p, 1, 'neon-city').click()
  await p.keyboard.press('Meta+5')
  await p.waitForTimeout(1200)
}

const README_SCENES = {
  screen1: async (p) => {
    await workspace(p)
    await showPreview(p)
    await p.waitForTimeout(1500)
  },
  screen2: async (p) => {
    await workspace(p)
    await paneRow(p, 0, 'Annual Report 2024\\.pdf').click()
    await paneRow(p, 0, 'Project Roadmap\\.pptx').click({ modifiers: ['Shift'] })
    await menu(p, 'File', 'Compress…')
    await p.locator('#archive-name').fill('Q1 handoff')
    await p.locator('#archive-split').selectOption({ index: 2 })
    await p.locator('#archive-password').fill('correct horse battery')
  },
  screen3: async (p) => {
    await go(p, 'Downloads')
    await row(p, 'Figma-Desktop-Setup\\.dmg').click()
    await row(p, 'wallpaper-collection\\.zip').click({ modifiers: ['Shift'] })
    await p.getByRole('button', { name: 'Calculate Hashes' }).click()
    await p.waitForTimeout(2000)
    const dialog = p.getByRole('dialog')
    const digest = (await dialog.getByText(/^[0-9a-f]{64}$/).nth(1).textContent()).trim()
    await dialog.getByPlaceholder(/Paste a checksum/).fill(`${digest}  node-v20.11.0-x64.pkg`)
    await p.waitForTimeout(600)
  },
  screen4: async (p) => {
    await go(p, 'Projects', 'design-system')
    await menu(p, 'File', 'New File from Template…')
    await p.getByText('React Component').click()
    await p.getByRole('dialog').getByRole('textbox').fill('Button.tsx')
    await p.waitForTimeout(500)
  },
}

if (process.argv[2] === 'readme') {
  for (const [name, fn] of Object.entries(README_SCENES)) if (!process.argv[3] || process.argv[3].split(',').includes(name)) await scene(name, fn, README)
  process.exit(0)
}

const only = process.argv[2]?.split(',')
for (const [name, entry] of Object.entries(SCENES)) {
  if (only && !only.includes(name)) continue
  const [fn, opts] = Array.isArray(entry) ? entry : [entry, {}]
  await scene(name, fn, opts)
}
