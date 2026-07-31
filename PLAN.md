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

### M5 — SQLite ✅ complete
`backend/db` with **`modernc.org/sqlite`** (pure Go, no cgo). Migration runner, repositories, and wiring for favorites, recents, per-folder view prefs, settings, and session restore of tabs + splits.

**✅ FTS5 risk cleared.** modernc.org/sqlite v1.55.0 ships SQLite 3.53.3 with FTS5 working under `CGO_ENABLED=0`, prefix queries included. No cgo, no fallback driver needed. Pinned by `TestFTS5IsAvailable` so a dependency bump cannot silently remove it.

Notes from the build:

- **Go exposes only `Query` / `Exec` / `Tx`.** Every table, migration and query is TypeScript. Connection lifecycle (`Open`/`Close`) is package-level *functions* rather than methods, because Wails binds every exported method — as methods they would have become frontend-callable API.
- **Integral floats are converted back to integers at the bridge.** Every JS number crosses as `float64`; binding one to an INTEGER column as a REAL silently breaks equality lookups and primary-key matches. Pinned by a test.
- **The FTS5 table is deliberately *not* in migration 001.** It belongs to M8's search index; creating schema for a feature that does not exist yet only invites drift.
- **Session state is stored as JSON, not normalised.** It is opaque state restored wholesale and never queried by field, so normalising would buy nothing and would couple the schema to the workspace store's shape. It is validated hard on read — a malformed snapshot returns null and the app opens a fresh tab rather than failing to start.
- **Restored ids advance the id counter** (`adoptIds`). Without it a relaunch starts counting from 1 again and the next new tab collides with a restored one.
- **Tests run against real SQL.** The mock bridge uses sql.js, so migrations and repositories are exercised by an actual engine rather than a fake that would accept invalid SQL. Caveat: stock sql.js has no FTS5, so M8's index is covered by Go tests instead — which is where it has to work anyway.
- **Vitest can no longer reach the Wails bindings by accident.** Running `vitest` without `VITE_BRIDGE=mock` used to fail deep inside generated code with an unhelpful error; the config now forces the mock whenever `VITEST` is set.
- **Verified against a real database:** WAL mode, all 9 tables, `user_version: 1`; pinning a folder, changing its view mode, then reloading restored the favorite, the recents list, the open preview panel, and — on returning to that folder — its Medium Icons view.
- **Dev-only artifact:** `wails dev` opens a native window *and* serves the browser dev server against one backend, so two frontends contend over the single session row. Production has one window.

### M6 — File operations ✅ complete
`backend/filesystem/operations.go` (create, rename, move, copy, trash, delete); the operations service and its three stores (clipboard, history, toast); inline rename in all four views; conflict and confirmation dialogs; toolbar New Folder; File/Edit menu commands; operation shortcuts.

Notes from the build:

- **An unrecognised conflict policy resolves to "ask", never "overwrite".** Go's `transfer` defaults its switch to reporting a conflict, so a typo in a policy string cannot destroy data. The mock had the opposite behaviour — its `if` chain fell through to a silent overwrite — which is exactly the kind of divergence that lets a test pass against behaviour the real backend refuses.
- **Names are validated before touching the disk.** `CreateFolder(parent, "../escape")` would otherwise write outside the folder the user is looking at. New `invalid-name` code, mirrored in the mock.
- **Case-only renames needed an explicit bypass.** APFS is case-insensitive, so `notes` → `Notes` stats its own destination as already existing; without `strings.EqualFold` that rename is impossible in the UI.
- **Copy recreates symlinks rather than following them.** A link pointing at its own ancestor would otherwise never terminate. There is a test with exactly that loop.
- **Trash goes to the volume's own trash, and needed a firmlink fix.** Since Catalina the boot disk is two volumes — a read-only `/` and the `/System/Volumes/Data` that home is firmlinked from — so a user's file *never* reports `/` as its mount point. Testing for `"/"` sent everything to `/System/Volumes/Data/.Trashes/<uid>` instead of `~/.Trash`. The volume is now identified by comparing mount points with the home directory. Deliberately not implemented via `osascript`/Finder: that needs an Automation consent prompt and fails when Finder is not running.
- **Two contract changes, both to make undo honest.** `Trash` returns `[]TrashedItem` (macOS keeps its Put Back mapping in metadata this package does not write), and `OpResult.Succeeded` carries `{source, target}` pairs rather than bare targets — keep-both renames on the way out, and a batch containing skips cannot be zipped back against its input.
- **Optimism only where the outcome is knowable.** Create, rename, trash and delete patch the query cache and roll back on failure. Copy and move invalidate instead: under keep-both the backend picks the final name, and a row that appears wrongly named and then corrects itself is worse than one that appears a moment later.
- **Only reversible work is recorded.** Permanent delete pushes no undo entry, and neither does anything that overwrote under `replace` — an undo that cannot restore what it destroyed would be a lie. Every inverse runs with the `fail` policy, so an undo is never itself destructive; if the original name was taken since, it reports instead.
- **Bug found while writing the acceptance test: `duplicate` did nothing.** It went through `transfer`, which starts at the `fail` policy, which hits the same-path short-circuit. Transfers now take an explicit starting policy, and duplicate (and a copy pasted into its own folder) begins at keep-both — there, the collision *is* the intent.
- **Bug found in the running app: keyboard focus was being dropped, twice.** Navigating swaps the listing for a loading state and an empty folder renders no grid, both of which unmount the focused element; closing the inline rename editor does the same. Focus fell to `document.body`, where arrow keys, type-ahead and every shortcut silently did nothing until the next click. This predates M6 — it only became visible once Cmd+V had something to do. `useReclaimFocus` covers the unmount case and only ever acts when nothing else holds focus; the views hand focus back explicitly after a rename.
- **Progress reporting is per-operation, not per-byte.** A toast appears if an operation outlives 600ms. Byte-level progress needs the backend to emit events, which arrives with the watcher's plumbing in M7.
- **The mock filesystem is now resettable** (`__resetMockFilesystem`, called from `test/setup.ts`). Without it a test that trashed a folder handed the next test a tree missing it.
- **Deferred deliberately:** `backend/dialogs` stays stubbed — the two dialogs M6 needs are in-window, because the conflict dialog lists names and offers three outcomes, which a native alert models poorly. Enter still opens rather than renames, unlike Finder; changing a binding shipped in M4 belongs with M11's shortcut registry, which will own the whole set. Cmd+Enter renames in the meantime.

Verified in the running app: New Folder → inline rename → Cmd+D duplicate (`alpha copy.txt`) → Backspace to trash → Cmd+Z restore; a colliding rename raising the error toast with both files intact; and the conflict dialog resolving keep-both to `alpha copy 2.txt`.

### M7 — File watching ✅ complete
`backend/watcher` on `fsnotify`, coalescing per directory and emitting `fs:change`; a reference-counted watch registry and the invalidating subscriber in `services/filesystem/watch.ts`; the watch hangs off `useDirectory`, so every consumer is counted automatically.

Notes from the build:

- **Coalescing is per directory, not per event, and that reshaped the contract.** `FileSystemEvent` was `{type, path, dir}`; it is now `{dir, kinds[], paths[], gone}`. The frontend invalidates by directory, so a batch is the honest unit — 500 files created in a watched folder produced **3** invalidations in the running app, and 200 writes coalesce to 1 in the Go tests.
- **Debounce alone would starve.** A pure quiet-window never fires for a directory being written continuously, so a batch also flushes at `maxWait` (750ms). That is why a sustained burst yields a few batches rather than one.
- **The path list is capped at 64.** It is diagnostic — invalidation keys off `dir` — and an unbounded list would let a 100k-file extraction build a 100k-element payload for nothing.
- **`gone` is separate from "something changed".** fsnotify reports removal of the watched directory itself; the pane showing it needs to enter its error state, not refetch an empty listing.
- **kqueue costs a file descriptor per entry in a watched directory.** That is fsnotify's macOS backend, so watching `/usr/lib` would exhaust the process and start failing unrelated syscalls. The soft descriptor limit is raised toward the hard one at startup, and directories over 4096 entries are declined outright — they simply have no live updates, and Refresh still works. Watch failures are logged, never surfaced: watching is an optimisation, and a folder the backend won't watch must still be browsable.
- **Reference counting lives in TS, not Go.** One pane already reads its directory three times (listing, preview, status bar) and two split panes on one folder make six; the backend takes idempotent `Watch`/`Unwatch` primitives and knows nothing about panes. The release guard matters — React invokes cleanups twice under StrictMode, and a double decrement would drop a watch another pane still needs.
- **M6's manual invalidation stays.** The watcher only covers directories currently on screen, and a watch can be declined; a copy into an unwatched destination would otherwise never refresh. The cost is a second read of an on-screen directory after an operation the app performed itself.
- **`Start`/`Stop` are package-level functions**, following `backend/db`: Wails binds every exported method, and lifecycle control has no business being callable from JavaScript.
- **Bug found by the acceptance test: the mock reported a missing directory as empty.** Real Go returns `not-found`; the mock's `readDirectory` returned `[]`. A deleted folder therefore looked merely empty, which hid the entire error path from tests and from browser dev. The mock now mirrors the backend, including `not-a-directory` for a file.
- **Bug found in the running app: stale counts beside an error.** Deleting a watched folder left the pane header and status bar reading "803 items" next to "This item no longer exists" — React Query keeps the last successful data alongside the error. `useDirectory` now reports no items when the read failed, which is what the pane already renders.

Verified in the running app with changes made entirely from the shell: files and folders appearing and disappearing with no user action, 500 creations coalescing to 3 invalidations, and the watched directory being deleted putting the pane into its error state.

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
