# Mac File Explorer — Implementation Plan

Porting the `frontend/ui-example/index.html` mockup (Mithril + Dexie) to a real
React + TypeScript + Wails file explorer, per the PRD.

---

## 0. Decisions locked in

| Decision | Choice | Rationale |
| --- | --- | --- |
| Wails version | **v2.13.0** (already installed) | v3 is still `v3.0.0-alpha2.119` — alpha. All Wails calls go through one TS adapter layer so a v3 migration touches ~6 files. |
| Tabs + split panes | **In the MVP** | Mockup treats them as core. Navigation/selection state is keyed per-pane from day one. |
| Persistence | **SQLite**, driver in Go, schema in TS | Go exposes only `Query` / `Exec` / `Tx`. Migrations, queries, repositories are TypeScript. |
| DB scope | App state, FTS5 search index, thumbnail cache, tags | Filesystem remains the source of truth for directory contents. |
| Visual style | Vault theme → CSS variables + Lucide | Mockup layout/palette preserved, themeable, PRD-compliant icons, self-hosted fonts (no CDN — the app runs offline). |

### What the mockup gets us vs. what changes

The mockup is a **layout and interaction spec**, not code to port line-by-line.

- **Keep:** the full chrome (tab bar → toolbar → sidebar / panes / preview → status bar), the palette, the four view modes, split-pane letters (A/B/C/D), resizable handles, file-type colour categories.
- **Replace:** `parentId` integer tree → real absolute **paths** as identity. `db.files.where('parentId')` → `ReadDirectory(path)`. Dexie → SQLite for app state only. `m.redraw()` → React reactivity. Font Awesome → Lucide. CDN Tailwind → build-time Tailwind.
- **Add (not in the mockup):** multi-selection, file operations, watcher, search, context menus, keyboard shortcuts, drag & drop, virtualization, error handling.

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ React components (dumb: props in, callbacks out)            │
├─────────────────────────────────────────────────────────────┤
│ Hooks — useExplorer, useDirectory, useSelection, useKeyboard│
├──────────────────────────┬──────────────────────────────────┤
│ Zustand stores           │ React Query                      │
│ (UI + session state)     │ (server state = the filesystem)  │
├──────────────────────────┴──────────────────────────────────┤
│ Services — filesystem, search, history, clipboard, db, ops  │
├─────────────────────────────────────────────────────────────┤
│ **Bridge layer** (services/bridge) ← the only Wails import  │
├─────────────────────────────────────────────────────────────┤
│ Go: filesystem · watcher · shell · dialogs · db · thumbs    │
└─────────────────────────────────────────────────────────────┘
```

Two rules that carry the architecture:

1. **Nothing outside `services/bridge/` may import from `wailsjs/`.** Enforced by an ESLint `no-restricted-imports` rule. This is the v3 migration seam *and* the test seam — an in-memory mock bridge lets the whole UI run in a plain browser under Vitest and Playwright with no Go process.
2. **Directory contents live in React Query, never in Zustand.** Zustand holds *which* path a pane shows; React Query holds *what is at* that path, keyed `['dir', path]`. Two panes on the same folder share one cache entry and one fetch. Watcher events invalidate keys. This falls straight out of the split-pane requirement.

### Go binding surface

Bound as separate structs so generated bindings are namespaced (`wailsjs/go/filesystem/FS`, etc.):

```go
// backend/filesystem — FS
ReadDirectory(path string, opts ReadOpts) ([]FileItem, error)  // opts: includeHidden, followSymlinks
ReadFileInfo(path string) (FileItem, error)
ReadTextFile(path string, maxBytes int) (string, error)        // preview
ReadFileBase64(path string, maxBytes int) (string, error)      // image preview
ListVolumes() ([]Volume, error)                                // /Volumes + capacity
StandardPaths() (map[string]string, error)                     // home, desktop, downloads…
CreateFolder(parent, name string) (FileItem, error)
CreateFile(parent, name string) (FileItem, error)
Rename(path, newName string) (FileItem, error)
Move(sources []string, destDir string, conflict Policy) (OpResult, error)
Copy(sources []string, destDir string, conflict Policy) (OpResult, error)
Trash(paths []string) error
Delete(paths []string) error                                   // permanent
Exists(path string) (bool, error)

// backend/watcher — Watcher     → emits "fs:change" via runtime.EventsEmit
Watch(path string) error
Unwatch(path string) error

// backend/shell — Shell
OpenFile(path string) error
RevealInFinder(path string) error
OpenWith(path, appPath string) error

// backend/dialogs — Dialogs
OpenDirectoryDialog(title, defaultDir string) (string, error)
SaveDialog(title, defaultName string) (string, error)
MessageDialog(opts DialogOpts) (string, error)

// backend/db — DB  (the entire persistence API)
Query(sql string, args []any) ([]map[string]any, error)
Exec(sql string, args []any) (ExecResult, error)
Tx(stmts []Stmt) error

// backend/thumbs — Thumbs
Generate(path string, size int) ([]byte, error)                // native image decode only
```

No sorting, filtering, selection, navigation, or conflict *decisions* in Go — `Move`/`Copy` take an explicit conflict policy computed in TS.

### Folder structure

Per the PRD, under `frontend/src/`: `app/{router,providers,layouts}`, `components/{explorer,sidebar,toolbar,dialogs,menus,common}`, `pages/`, `hooks/`, `services/{bridge,filesystem,search,history,clipboard,db,operations}`, `stores/`, `types/`, `utils/`, `constants/`, `features/{explorer,sidebar,search,preview,favorites,settings}`.

Go side: `backend/{filesystem,dialogs,watcher,shell,db,thumbs}`.

### Store design

| Store | Holds |
| --- | --- |
| `workspaceStore` | `tabs[]` → `panes[]` → `{ id, path, history[], historyIndex, viewMode, sort, filter, scrollTop }`, `activeTabId`, `activePaneId`, `splitMode`, pane sizes. The mockup's tab/panel model, made persistent. |
| `selectionStore` | `Map<paneId, { anchor, lead, selected: Set<path> }>` |
| `clipboardStore` | `{ paths[], mode: 'copy' \| 'cut' }` — virtual, not the OS clipboard |
| `searchStore` | per-pane query, scope, filters, results, status |
| `settingsStore` | theme, show hidden, folders-first, confirm-delete, double-click behaviour |
| `uiStore` | preview panel open, dialog stack, context menu position/target |
| `historyStore` | undo stack for reversible operations |

`navigationStore` and `explorerStore` from the PRD collapse into `workspaceStore` — with panes, per-pane navigation *is* the explorer state, and splitting them causes cross-store sync bugs.

### Data model

```ts
interface FileItem {
  id: string          // absolute path — stable identity, replaces the mockup's numeric id
  path: string
  name: string
  extension: string
  size: number
  isDirectory: boolean
  createdAt: number   // unix ms
  modifiedAt: number
  permissions: string
  hidden: boolean
  symlink: boolean
  symlinkTarget?: string
  mimeType: string
  category: FileCategory  // derived in TS — folder|image|document|code|music|video|archive|data|default
}
```

`category`, icon and colour are computed in TS from `extension`/`mimeType`, reusing the mockup's `getFileCategory` mapping.

### SQLite schema (owned by TS, `services/db/migrations/`)

```sql
settings(key TEXT PRIMARY KEY, value TEXT)
favorites(id INTEGER PK, path TEXT UNIQUE, label TEXT, icon TEXT, sort_order INT)
recents(path TEXT PRIMARY KEY, visited_at INT)
folder_prefs(path TEXT PRIMARY KEY, view_mode TEXT, sort_key TEXT, sort_dir TEXT)
sessions(id INTEGER PK, payload JSON, updated_at INT)      -- tabs + splits restored on relaunch
tags(id INTEGER PK, name TEXT UNIQUE, color TEXT)
path_tags(path TEXT, tag_id INT, PRIMARY KEY(path, tag_id))
annotations(path TEXT PRIMARY KEY, note TEXT, updated_at INT)
thumbs(path TEXT, mtime INT, size INT, blob BLOB, PRIMARY KEY(path, size))
search_index USING fts5(path, name, ext, tokenize='unicode61')
index_meta(root TEXT PRIMARY KEY, indexed_at INT, status TEXT)
```

A tiny TS migration runner (`user_version` pragma + ordered `.sql` files) runs on startup.

---

## 2. Milestones

Each milestone ends with something runnable via `wails dev`.

### M0 — Foundation ✅ complete
Tailwind (build-time) + CSS-variable theme extracted from the mockup's `:root`; self-hosted IBM Plex Sans + Space Grotesk; Zustand, React Query, React Router, Lucide, Vitest + RTL, ESLint + Prettier, path aliases, `strict` TS with `noUncheckedIndexedAccess`; the ESLint rule banning `wailsjs/` imports outside the bridge; full folder skeleton; delete the template Greet demo.
Also: macOS window options — `TitleBarHiddenInset`, dark appearance, translucency — and the ~78px traffic-light inset the tab bar needs.

Delivered beyond the original scope, because the seam is only real if something exercises it: the full `Bridge` contract (`services/bridge/types.ts`), both implementations (`impl/wails.ts` throwing milestone-labelled errors, `impl/mock.ts` as a working in-memory filesystem seeded from the mockup's dataset), the shared utilities the mockup had inline (`utils/path.ts`, `utils/fileCategory.ts`, `utils/format.ts`), typed `FsError` handling, and 27 passing tests.

Verification: `npm run typecheck`, `npm run lint`, `npm test`, `wails build` all pass; the packaged `.app` launches and stays running.

### M1 — Go bridge v1 + vertical slice ✅ complete
`backend/filesystem` read APIs, `StandardPaths`, `ListVolumes`; typed bridge adapter with error mapping (permission denied / not found / disk unavailable / broken symlink → typed `FsError`); the in-memory mock bridge; Go unit tests over `t.TempDir()`.
**Done when:** one pane lists the real home directory in Details view. ✅

Notes from the build:

- **Error transport.** Wails v2 delivers a Go error to JS as its `Error()` string, which would leave the frontend matching on English prose. `backend/filesystem/errors.go` encodes a JSON payload behind an `fs-error:` sentinel; `impl/decode.ts` parses it back to a typed `FsError`. `backend/shell` mirrors the encoding so both decode through one path.
- **Hidden files.** Go returns hidden entries *flagged, not filtered* — "show hidden files" is a user setting, so the filter lives in the bridge adapter. Keeps the PRD's "no filtering in Go" rule intact.
- **Broken entries.** A dangling symlink returns a `broken: true` item instead of failing the whole `ReadDirectory`; one bad link must not make a folder unlistable.
- **Deferred to M3 on purpose:** `ExplorerPane` holds its path in local `useState`. History, tabs and splits arrive with `workspaceStore`; building half of it now would only be undone.
- **Known cosmetic issue:** an exception from Wails' own `wails/ipc.js` appears when the dev server is opened in a plain browser. It does not appear to affect the packaged app, which runs clean. Recheck when wiring the watcher in M7.

### M2 + M3 — Shell chrome, navigation, tabs, splits ✅ complete
Built together: the tab bar and split controls are inert without `workspaceStore`, so shipping a decorative M2 first would have meant rewriting it immediately.

Delivered: tab bar, toolbar, sidebar, status bar, breadcrumbs, preview panel; `workspaceStore` (tabs → panes → history) plus `selectionStore` and `uiStore`; per-pane back/forward/up; tab open/close/switch; 1/2/3/4-way splits; draggable and keyboard-operable dividers.

Notes from the build:

- **Scope call — the three icon views shipped here, not in M4.** They are pure layout, which makes them chrome; leaving them out would have meant a view switcher with three dead options. M4 keeps virtualization, multi-selection, marquee drag and sort-by-column-header.
- **`useSplitResize` stores fractions, not pixels.** The mockup wrote pixel widths straight onto DOM nodes, so a window resize stranded the panes at stale widths. Fractions applied as `flexGrow` redistribute on their own, and the drag listens on `window` so it keeps tracking when the pointer outruns the 4px divider.
- **Bug found by looking at the running app:** the status bar read "1 selected" after navigating away, while the preview showed its empty state — selection outlived the directory it belonged to. Panes now clear selection on path change, with a regression test.
- **Two more fixes from real-app inspection:** `ListVolumes` was marking every `/Volumes` entry removable (wrong for internal APFS volumes) and ignoring the `nobrowse` flag that keeps system volumes out of Finder; both now read from `statfs`. The view menu was left-aligned and overflowed the window edge.
- **Toolbar carries only working controls.** New Folder (M6), Search (M8) and Settings arrive with their milestones — a toolbar of dead buttons is worse than a short one.
- **Known browser-automation quirk (not an app bug):** the first click after a page load is swallowed by the dev server tab until it takes focus. Only affects driving the app in a browser.

### M4 — Views, sorting, selection ✅ complete
Virtualization via `@tanstack/react-virtual` in all four views; sortable column headers (name/size/type/modified, asc/desc, folders-first); full selection model — click, Cmd-click, Shift-range, Cmd+A, marquee drag, Escape; arrow/Home/End/type-ahead keyboard navigation; memoized rows and tiles.

(The four view *layouts* shipped early, in M2/M3 — see above.)

Notes from the build:

- **Marquee selection uses geometry, not DOM rects.** With virtualization, dragging past the bottom of the viewport must select rows that were never rendered; asking the DOM would silently miss them. `getItemRect(index)` computes position arithmetically instead.
- **Selection logic lives in one place.** `useSelection` maps modifier keys to actions and `useListKeyboard` handles navigation, both shared by the list and the grids, so the two cannot drift. The range/step/type-ahead maths sits in `utils/selection.ts` as pure functions with direct unit tests.
- **Grids compute their own column count.** The mockup used CSS `auto-fill minmax()` and let the browser decide; virtualization needs the number up front, so a `ResizeObserver` measures the pane (not the window — a split divider changes pane width without the window changing).
- **jsdom needed stubbing for virtualization** (`src/test/setup.ts`): jsdom reports every element as 0×0 and has no `ResizeObserver`, so the virtualizer would render zero rows and every view test would fail for reasons unrelated to the app.
- **`aria-live` for selection moved to the status bar** — it had been duplicated in an off-screen region, so the count was announced twice.
- **Verified in the running app:** 26 rows mounted for a 50-item directory, the window moving correctly on scroll (`translateY(510→1666)` at `scrollTop` 800), and `End` scrolling to and selecting the last item.

### M5 — SQLite
`backend/db` with **`modernc.org/sqlite`** (pure Go, no cgo). Migration runner, repositories, then wire up: favorites, recents, per-folder view prefs, settings, and session restore of tabs + splits.
⚠️ First task: verify FTS5 is available in the modernc build. Fallback is `mattn/go-sqlite3` with the `sqlite_fts5` tag (adds cgo), or a LIKE-based index.

### M6 — File operations
Create folder/file, rename (inline edit), duplicate, copy/cut/paste, move, trash, permanent delete; conflict detection and resolution computed in TS (`keep both` / `replace` / `skip`); optimistic updates with rollback on failure; undo stack; progress reporting for long operations; toast-based error surfacing.

### M7 — File watching
`fsnotify` in Go with per-path debounce, emitting `fs:change`; TS subscriber invalidates the matching React Query keys; watch lifecycle tied to visible pane paths (watch on mount, unwatch on last consumer).

### M8 — Search
Current-directory filter (debounced, instant); recursive search via a streaming Go walk with cancellation; FTS5-backed instant search for indexed roots; filename/extension/size/date filters; hidden-files toggle; results rendered in the pane with a "searching in…" header.

### M9 — Drag & drop
Internal drag between panes and onto sidebar folders (copy vs move via modifier), with drop-target highlighting; external file drop from Finder into the app via Wails' `DragAndDrop` option.
⚠️ Dragging *out* to Finder is not supported by the webview — mitigate with "Reveal in Finder" + copy-path.

### M10 — Preview & thumbnails
Preview panel: image, text/code (with size cap), PDF, metadata, tags. Background thumbnail generation in Go, cached in SQLite by `path + mtime`, requested lazily from an IntersectionObserver in grid views.

### M11 — Menus & shortcuts
Context menus for file / folder / background with native-feeling styling and keyboard traversal; native app menu (`menu.NewMenu`) mirroring the actions; a central shortcut registry (Cmd+C/V/X/A/N/F, Cmd+Shift+N, Delete, Enter, Space for preview, Cmd+1..4 for view modes, Cmd+T/W for tabs, Cmd+[ / ]) with a `useKeyboard` hook that respects focus context.

### M12 — Polish, testing, packaging
Animations and reduced-motion support; light theme; empty/loading/error states; perf pass on a 10k-file directory; Vitest coverage of services, stores and hooks against the mock bridge; Playwright e2e in the browser against the mock bridge; `wails build` + code-signing/notarization notes.

---

## 3. Risks

| Risk | Mitigation |
| --- | --- |
| **macOS TCC prompts** — Desktop/Documents/Downloads trigger consent; some paths need Full Disk Access | Detect `EPERM`, show an actionable "Open Privacy & Security settings" panel rather than a raw error |
| **Wails v3 migration** | Bridge layer isolates it; revisit only when v3 hits stable |
| **No drag-out to Finder** | Document it; offer Reveal in Finder / copy path |
| **FTS5 in modernc.org/sqlite** | Verified first thing in M5, with two fallbacks |
| **Large directories** (100k entries) | Virtualization + chunked `ReadDirectory` streamed over events + a "still loading" indicator |
| **Watcher storms** on busy folders | Debounce and coalesce in Go before emitting |
| **Thumbnail CPU cost** | Bounded worker pool in Go, IntersectionObserver-driven requests, persistent cache |
| **Notarization** for distribution | Deferred to M12; not blocking for local development |

---

## 4. Immediate next steps (M0)

1. Install frontend deps: `tailwindcss @tanstack/react-query @tanstack/react-virtual zustand react-router-dom lucide-react` + dev: `vitest @testing-library/react @playwright/test eslint prettier`.
2. Self-host the two fonts; delete the CDN links the mockup relied on.
3. Port the mockup's `:root` block into `styles/theme.css` as the dark theme, with light-theme values stubbed.
4. Create the folder skeleton and the `services/bridge` seam + ESLint rule.
5. Configure `main.go` window options for macOS chrome; strip the Greet demo.
