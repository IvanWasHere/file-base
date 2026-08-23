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

- **Keep:** the full chrome (tab bar → toolbar → sidebar / panes / preview → status bar), the palette, the five view modes — Details, Large / Medium / Small Icons, and **Photos** (§M13) — split-pane letters (A/B/C/D), resizable handles, file-type colour categories.
- **Correct:** the mockup's four-pane layout is four columns; it becomes two rows of two, which is what its own icon has always drawn (§M16).
- **Replace:** `parentId` integer tree → real absolute **paths** as identity. `db.files.where('parentId')` → `ReadDirectory(path)`. Dexie → SQLite for app state only. `m.redraw()` → React reactivity. Font Awesome → Lucide. CDN Tailwind → build-time Tailwind.
- **Add (not in the mockup):** multi-selection, file operations, watcher, search, context menus, keyboard shortcuts, drag & drop, virtualization, error handling, file hashing (§M14), quick file creation from templates (§M15), browsing and creating archives (§M18).

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

// backend/hashing — Hasher  → streams "hash:result" / "hash:progress" / "hash:done"
Hash(req HashRequest) (string, error)                          // returns a job id
Cancel(id string) error
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
- **Amended after M15: only a *file* reveals the preview.** M3's rule was "a selection appearing reveals the preview", which meant every click while browsing — and browsing is mostly clicking through folders — took width away from the listing to show a panel that had nothing to add about a folder the listing already describes. M13 flagged the same rule as worth revisiting when Photos auto-selecting a photo opened the panel as a side effect. Selecting a folder now leaves the panel as it was; adding a file to that selection still reveals it, which is why the transition guard tracks whether a *file* is selected rather than whether anything is. An explicit open outlasts a folder click, symmetrically to the explicit close that already outlasted a file one, so the panel keeps showing folder details once the user has asked for it. Verified in the running app with real mouse events: clicking a folder leaves it shut, clicking a file opens it on that file, and clicking the folder again leaves the now-open panel alone.

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

### M8 — Search ✅ complete
`backend/search` (streaming walk, criteria, cancellation); `services/search/{criteria,searchIndex}`; `searchStore` and `useSearch`; the search bar, filter row, results strip and index control.

Three modes behind one search box, chosen by what is possible rather than by anything the user configures: the current folder is a pure predicate over the listing already in the query cache; an indexed root is one FTS5 query plus a batch stat; anything else is a streaming walk. Only the last can be slow, so only it is debounced and only it reports progress.

Notes from the build:

- **Criteria are applied in Go, and that is the deliberate exception to "no filtering in the backend".** A search is the user's explicit question passed down whole, and it can only be answered while walking — the alternative is streaming half a million paths to TypeScript so it can discard all but nine. TypeScript still owns what is asked and how the answer is shown.
- **Streaming is the point.** Results flush every 64 matches *or* 100ms, whichever comes first: a hit in a deep tree can be seconds from the next, so time matters as much as count. Cancellation is real — a superseded query stops its walk rather than leaving five competing for the disk.
- **`ReadFileInfos` was added to the filesystem package.** The index stores paths, not metadata, so a hit list has to be stat'd; 200 bridge round trips per keystroke is what the batch call avoids.
- **The FTS5 table is created lazily, not in migration 002.** FTS5 is a compile-time option: the Go driver has it, the sql.js build behind the mock does not. A migration creating it would fail outright and take the whole app down in tests and browser dev for the sake of an optional accelerator. The migration carries only `index_meta`; everything in `searchIndex.ts` degrades to "unavailable" and the caller walks.
- **The index is an accelerator, never a source of truth.** Every hit is re-stat'd through the bridge, so an entry deleted since the index was built drops out instead of appearing as a phantom row. Verified against real files.
- **Query terms are quoted.** Someone typing `report OR draft` is naming a file, not writing a query language; unquoted, FTS5 would read the operators.
- **Indexing is opt-in per folder.** Walking a home directory is minutes of disk work nobody asked for, and doing it silently is the behaviour people resent in desktop search. The offer sits beside the control that starts a recursive search — where the cost is about to be paid.
- **Bug found by reading real output: a size filter returned folders.** The rule had been "size bounds apply to files only" — reasonable in isolation, but it meant asking for 10–100 MB handed back every directory in the tree. A size filter now *excludes* directories rather than exempting them, in both the Go and TS implementations.
- **Bug found by an acceptance test: results could arrive before the caller subscribed.** `useSearch` awaited `find()` for the id and subscribed afterwards; the result stream and the call response are independent messages, so the first batch could be dropped. It now subscribes first and buffers until the id is known. The mock exposed it because its delivery is a microtask, but the race is real against Wails IPC.
- **One acceptance test was passing vacuously**, asserting a row that was in the folder listing anyway. Rewritten to search for something that only exists two levels down, so finding it proves the walk descended.
- **The hidden-files filter needed the listing to contain hidden files.** In folder scope the filter runs over what was already read, so the pane now reads with hidden entries whenever the search asks for them — otherwise the toggle silently did nothing.
- **Note for M11/M12:** the index goes stale on its own. Keeping it live from watcher events is the obvious next step; the record carries `indexed_at` and the UI shows the age so the staleness is at least visible.

Verified in the running app against real files: the folder filter narrowing instantly, a recursive walk finding a file two levels down, every filter (kind, extension, size, date, hidden) against the Go walk, and the same query answered from the FTS5 index — including a file deleted on disk dropping out of indexed results.

### M9 — Drag & drop ✅ complete
`dragStore`, `useFileDrag` (drag sources and drop zones), `utils/volume` (the copy-versus-move rule), `useExternalDrop`, and `runtime.OnFileDrop` bridged from `main.go`. Drop targets: folder rows and tiles, a pane's own listing, and every sidebar place.

Notes from the build:

- **The payload lives in a store, not in `DataTransfer`.** The browser makes drag data unreadable during `dragover` — `getData` returns "" until the drop — and every decision a drag makes while moving (legal target? copy or move? which row lights up?) needs the payload. `DataTransfer` carries a plain-text copy of the paths for anything outside the app that might read it.
- **Drop handling is on the container, not the row.** A virtualized list recreates its rows constantly; thirty of them with their own handlers and their own volume-list subscription would be wasteful. One set of handlers on the scroll element hit-tests with `closest('[data-drop-path]')`, and rows only declare what they are.
- **Copy versus move follows Finder, which meant knowing about volumes.** Same volume moves, different volumes copies, Option forces a copy. `utils/volume` answers it from the mount points the sidebar already reads, so it stays a pure string operation — with the subtlety that the *longest* matching mount wins, since "/" is a prefix of everything.
- **Cmd-to-force-move is deliberately absent.** It would silently turn a cross-volume drag into a copy-then-delete, and there is no progress UI for the long operation that would follow.
- **Dragging an unselected row drags only that row**, as Finder does, rather than the selection it was not part of.
- **A drop refused at the target never lights up**, so a drag that cannot work never looks like it would: a folder into itself or its own subtree, and a move back into the folder it came from. A *copy* back into the same folder is allowed — that is Duplicate, and it starts at keep-both.
- **External drops never reach the DOM.** The native layer sits above the webview, so there is no dragover, no drop event and no element under the pointer — only window coordinates. The target is recovered by hit-testing those against the same `data-drop-path` attributes, which is exactly why both paths agree about what a folder is. A drop that lands on chrome says so rather than guessing a destination.
- **External drops always copy.** Moving a file out of wherever the user keeps it, because they dragged it into another window, is not something to infer.
- **Dragging *out* to Finder remains impossible** (PLAN.md §3). Copy Path was added beside Reveal in Finder as the documented way across.
- **jsdom has no `DragEvent`**, so the acceptance tests build the events by hand — and `altKey` has to be defined onto them explicitly, or every Option-drag silently reads as a plain one and the test asserts the wrong thing.

Verified in the running app against real files: a move onto a folder, a folder into itself refused with `dropEffect: none`, an Option-drag copying while keeping the original, and a Finder drop round-tripped through the real Wails event system — hit-testing real row geometry, copying into the folder under the pointer, and reporting a drop that landed on chrome.

### M10 — Preview & thumbnails ✅ complete
`ReadTextFile` / `ReadFileBase64` in `backend/filesystem`; `backend/thumbs`; `services/thumbs/thumbCache` and `useThumbnail`; `PreviewContent` with image, text and PDF renderers.

Notes from the build:

- **Both readers are capped, but they fail differently on purpose.** Text truncates — a partial log is still readable, and the panel reports the truncation by comparing against the size the listing already carries. Images and PDFs are refused past their cap, because half an image is a broken image rather than a preview. That refusal is its own error code (`too-large`): the file is fine, the operation simply will not handle it.
- **Thumbnails cross the bridge as `data:` URLs, not bytes.** Wails marshals a Go `[]byte` to a JSON array of numbers — a 10KB thumbnail becomes ~40KB of text — and the caller would otherwise have to guess whether it received PNG or JPEG. This forced **migration 003**: migration 001 had speculatively created the cache table with a BLOB column, which STRICT mode will not accept a string into. The table had never held a row, so it is dropped and rebuilt as text.
- **The encoder picks a format by transparency.** JPEG for photographs, a third of the size; PNG when there is alpha to keep, because a JPEG fills it with black. Verified against a real half-transparent PNG.
- **Images smaller than the target are not scaled up.** Enlarging a 24×24 icon to 256×256 produces a blurry square worse than the icon the UI would otherwise draw.
- **Decoding is bounded by a semaphore, not by however many goroutines Wails hands over.** Scrolling a folder of photographs asks for hundreds at once (PLAN.md §3).
- **Freshness is keyed on the source mtime rather than invalidated by the watcher.** An edited image invalidates its own thumbnail the next time anyone looks at it — no sweep, no subscription, no way for the two to drift. In-memory de-duplication sits above it so an IntersectionObserver firing for forty tiles starts one render, not forty.
- **Bug found by the lint rule, and it was real:** the thumbnail hook reset its state in an effect, which left one frame where a recycled virtualized tile showed the *previous* file's image. Now derived from the item's identity, so there is no window at all.
- **Bug found by a test: `image/jpg` is not a mime type.** The URL was built as `image/${extension}`. Browsers sniff a data URL and render it anyway, so the mistake was invisible — until something stops sniffing, and SVG already did, rendering as nothing without `image/svg+xml`. Now a map.
- **Bug found in the running app: an extension is a claim, not a fact.** A text file named `.png` reads back perfectly well, so the preview rendered an empty `<img>`. Only the decoder knows better, and by then the element exists — so the image's own `onError` now falls back to the icon. The thumbnail path already handled this, because there the render itself fails.
- **Tags are not implemented.** M10's line mentions them, but migration 001 already called tagging "schema now, UI later" and the PRD lists it as a Future Feature. The schema is there; putting a tag editor in the preview belongs with a milestone that is about tagging.

Verified in the running app against real files: text preview with its truncation notice, an oversized image refused by code, a full-resolution image inline, and thumbnails rendering at 128×64 from an 800×400 source (JPEG), 128×128 with transparency intact (PNG), a 24×24 icon left unscaled, and a text file named `.png` falling back to its icon in both the grid and the panel.

### M11 — Menus & shortcuts ✅ complete
`backend/appmenu` and the native menu bar; `constants/contextMenus.ts` and `components/menus/{ContextMenu,ContextMenuHost,MenuPanel}`; `constants/shortcuts.ts` and `hooks/{useKeyboard,useContextMenu,useNativeMenu}`. The registry is also where M13's Left/Right/Home/End stepping is reconciled with `useListKeyboard`'s existing arrow navigation.

Notes from the build:

- **A shortcut is a second *route* to a command, never a second implementation.** The registry maps accelerators to the `MenuCommandId`s `useMenuCommands` already implements, which is what keeps the in-window menu bar, the native menu, the context menus and the keyboard from drifting apart. It is also what let `useOperationKeys.ts` be deleted: M6 had shipped a parallel key handler for the operation keys, and keeping it would have meant every new binding being added in two places.
- **Edit is Wails' role menu rather than one of ours, and that is not a style preference — it is what makes text editing work.** WKWebView does not install Cmd+C/Cmd+V for a focused input on its own; the standard Edit menu's key equivalents are what the rename field is relying on. Declaring our own Edit menu in its place left the inline rename editor unable to copy or paste, which is exactly what happened when the package first shipped without it. The app's own Edit commands — copy *files*, paste *files*, Find — stay reachable from the in-window menu bar, the context menus and the registry, all of which keep working because the webview sees those keystrokes first.
- **The native menu carries no accelerators at all.** macOS gives the key window's responder chain first refusal on a key equivalent, and the webview claims the ones this app uses — so a menu accelerator would be shadowed by the frontend's registry in the packaged app and would fire on its own everywhere else. One owner is better than a coin toss: `constants/shortcuts.ts` owns every binding, and the in-window menu prints them.
- **Matching is on `KeyboardEvent.code`, not `.key`.** macOS rewrites `.key` when Option is held — Cmd+Alt+L arrives as `¬` — so a table written in characters would silently never match. Confirmed against a real Option keystroke in the running app.
- **Native menu items carry a command id and nothing else.** Enablement is selection state and selection lives in TypeScript; pushing a rebuilt menu across the bridge on every selection change would be several updates a second while a marquee is being dragged, to grey out items nobody is looking at. Picking an item emits `menu:command` and the frontend decides whether it can run.
- **The two halves are pinned by a Go test that reads the TypeScript.** `TestCommandIDsExistInFrontend` parses `constants/menus.ts` and fails if the Go package ever names a command the frontend does not implement — the only way the native menu and the app could drift apart unnoticed.
- **Enter renames now. That is a changed binding, not a new one.** M4 shipped Enter as "open" and M6 flagged the correction as belonging to this milestone, which owns the whole set: Enter renames, Cmd+O and Cmd+Down open, and a double-click still opens.
- **Right-clicking an unselected item selects it first, as Finder does; right-clicking *inside* an existing multi-selection leaves it alone**, so "Move to Trash" acts on all six files rather than the one under the cursor. That is what lets every context-menu command read the selection like any other route into `useMenuCommands`, with no menu-specific target threaded through.
- **Context-menu handling sits on the scroll container, not on rows** — the same reason as M9's drop handling: a virtualized list recreates its rows constantly, and hit-testing `data-file-path` with `closest` costs nothing per row.
- **A disabled command still swallows its key.** Cmd+V with an empty clipboard should do nothing, not fall through to the webview's own paste.
- **Cmd+5 is deliberately bound to nothing**, reserved for M13's Photos view so the view numbering does not shuffle when it lands. Verified inert.
- **Note for whoever verifies next.** With Screen Recording withheld from the shell, the running app is still fully drivable through the macOS accessibility API — `System Events` reads the whole React tree, and rows expose `AXShowMenu`. Two traps: AppleScript's `keystroke "1"` synthesizes a *numpad* key, so `code` arrives as `Numpad1` and every Cmd+digit binding looks dead until you switch to `key code 18`; and `AXShowMenu` raises the context menu at the pointer's real position rather than at the element it was called on, so it reports whichever row the mouse happens to be over.

Verified in the running app: the native menu bar installed with File / Edit / View / Go in macOS order and every item matching the Go table; File ▸ New Tab and View ▸ as Details / as Medium Icons driving the frontend through `menu:command`; Cmd+T / Cmd+W, Cmd+1..4 with Cmd+5 correctly inert, Cmd+Shift+H, Cmd+Alt+L and Cmd+Alt+S; the file context menu opening with exactly its declared item set; and the focus rules — rename editor, search box, focused control, open dialog — checked by hand.

### M13 — Photos view ✅ complete

A fifth view mode, `photos`, taken from the mockup's `.photo-viewer` (`frontend/ui-example/index.html` — styles at §"Photo Viewer Styles", behaviour in `renderFileView` / `renderPhotoViewer` / `scrollFilmstripToActive`). It postdates the rest of the mockup, which is why it appears here rather than in M2/M4 with the other view modes.

**Numbered after M12 but built before it.** M12's polish, perf and light-theme passes should cover this surface too; shipping the feature afterwards would mean polishing twice. Its one real dependency is M11's shortcut registry — see decision 8.

What the mockup specifies:

- **Main stage, 70% height** — the image centred and `object-fit: contain` on `--bg-deep`; 40px circular prev/next buttons inset 16px and vertically centred, *absent* at the ends of the list rather than disabled; the filename in a pill at bottom-centre, `pointer-events: none`.
- **Filmstrip, 30% height** — horizontally scrolling, 80px-wide thumbs with 4px gaps, the active one carrying an accent border and glow, each with its name overlaid along the bottom. Clicking a thumb makes it active; the strip then smooth-scrolls to centre it.
- **Its own empty state** — "No images in this folder", distinct from "This folder is empty", because the folder may be full of other things.

Decisions taken up front:

1. **Photos is a view mode, not a modal viewer.** The mockup puts it in `viewConfigs` beside Details and the three icon grids, and renders it inside the pane — so it inherits splits, tabs, the breadcrumb, the pane header and the preview panel for free. A full-window lightbox is a different feature and is not this one.
2. **The active photo *is* the pane selection.** The mockup moves `panel.selectedId` and `state.previewFile` together on every step. Mapping that onto `selectionStore` rather than a viewer-local index means the status bar, preview panel, file operations, drag sources and M11's context menus all keep working with no special case. The consequence is deliberate: Photos is single-select, so Cmd/Shift-click, marquee and Cmd+A have nothing to act on there.
3. **Photos is the only view that hides files, and the filter stays in TypeScript.** The mockup's `f.type === 'image'` becomes `previewKindFor(item) === 'image'` applied to whatever list the pane is showing — which includes search results, so a search narrows the strip. `backend/` keeps the no-filtering rule; M8's Go-side criteria remain the sole exception.
4. **The stage shows the 512px thumbnail first and the original second.** `ReadFileBase64` refuses anything over `IMAGE_CAP` (12MB), and a data URL for a 12MB photo is ~16MB of JSON per step. `backend/thumbs` already renders and caches up to `maxSize = 512`, so: paint the cached 512 immediately, swap in the full file once it decodes, and for a file past the cap let the 512 stand — a slightly soft photo beats a `too-large` error in a viewer whose entire job is showing photos. It also makes stepping feel instant instead of round-tripping the disk per keypress.
5. ~~**Filmstrip thumbs reuse `THUMB_SIZE` (128).** They are 80 CSS px, so a 2× display would prefer 160 — but the icon grids have already cached 128 for these same files, and a second size doubles the cache for one view's benefit. Take the 128.~~ **Revised during the build:** the premise was the 80px thumb, and the strip now draws uniform 16:9 cards that fill its height — around 250 CSS px wide, where 128 upscaled is visibly soft and worse again on a 2× display. Thumbs use `STAGE_SIZE` (512), which costs nothing extra: the stage already renders and caches 512 for the active photo and prefetches its neighbours, so the strip asks for rows the Photos view was going to create anyway. One size for the whole view rather than a second cache keyed to one surface.
6. **The filmstrip virtualizes horizontally.** The mockup mounts every thumb; 5,000 photos would mean 5,000 nodes and 5,000 thumbnail requests. `@tanstack/react-virtual` is already in use and takes `horizontal: true`. Centring then becomes `scrollToIndex(i, { align: 'center' })` rather than the mockup's `offsetLeft` arithmetic — which a virtualizer invalidates anyway, since the target thumb may not be mounted when the scroll is asked for.
7. **Prefetch one ahead and one behind.** Held arrow keys should not wait on a decode per press, and the two neighbours are the only ones a step can reach.
8. **Shortcuts register with M11's registry rather than locally.** Left/Right to step, Home/End to jump, Space to toggle the preview panel. Left/Right already mean something in `useListKeyboard`, so both sets have to be resolved in one place — building a second pane-scoped key handler here would recreate exactly the drift M11 exists to prevent.
9. **The persisted view mode must survive the new value in both directions.** `folder_views` (migration 001) stores the mode as text, so a database written by this build will be opened by one that has never heard of `photos`, and vice versa. Confirm the read path validates against the `ViewMode` union and falls back to `details` before shipping — the failure mode is a pane that renders nothing, which looks like a crash.
10. **The pane's sort still orders the strip; folders-first stops meaning anything.** The filter has already removed the folders it would have hoisted.
11. **Thumbs are drag sources; the viewer is a drop target for the pane's own directory** — the same zone the listing offers in M9. There is no drop-onto-photo, because there is no folder to drop into.
12. **The 70/30 split is fixed, with a floor.** A resizable filmstrip is a preference to persist per pane, which is more state than this earns. The percentage is the *preferred* height; the strip also carries a 150px minimum and its thumbs a 50px one, below which it is taking up space without showing a usable image. The stage takes whatever is left, so the strip stays against the bottom edge at every size.

Files: `features/photos/{PhotosView,PhotoStage,Filmstrip}.tsx`, `hooks/usePhotoNavigation.ts`, plus additions to `types/workspace.ts` (the `ViewMode` union), `constants/viewModes.ts` (the fifth `VIEW_OPTIONS` entry, Lucide `Images`) and `services/thumbs/thumbCache.ts` (a 512 request path alongside `THUMB_SIZE`). **No new Go bindings** — `Thumbnail(path, 512)` and `ReadFileBase64` both already exist.

**Done when:** switching a folder of photos to Photos view shows the first image with the filmstrip centred on it; arrow keys and the nav buttons step through it; the preview panel and status bar follow the active photo; a folder with no images shows its own empty state; and a 2,000-photo folder scrolls the strip without mounting 2,000 thumbs. ✅

Notes from the build:

- **All twelve decisions held.** Nothing above was reversed on contact with the code, which is worth recording because it is not the usual outcome — the decisions were taken against the mockup and the existing views rather than in the abstract.
- **Decision 9 was the real risk, and it was worse than written.** The view mode is validated on the way out of the database in *two* independent places — `folderPrefs.toPrefs` had a `VIEW_MODES` array, and `session.parsePane` had the union spelled out again as an `||` chain. Both had to learn `photos` or a pane restored into it would come back as Details with nothing said. They now share one `isViewMode` guard derived from `VIEW_OPTIONS`, so the picker and the validators cannot disagree: a sixth view mode is added in one place. Both paths have a regression test, and the round trip was confirmed against a real database by relaunching the app.
- **`Exclude<ViewMode, 'details'>` was a trap waiting for exactly this change.** `IconsView` typed its `SPECS` record and its `mode` prop that way, so adding `photos` to the union silently widened both — the grid would have accepted a mode it has no spec for and indexed `undefined`. Replaced with an explicit `IconViewMode`, which turns the next view mode into a compile error rather than a blank pane.
- **The stage is a `<figure>` with a `<figcaption>`, and the tests are why.** The preview panel renders the same photo — that is decision 2 working, not a duplicate — so "the image named `IMG_0001.jpg`" matched two elements and every stage assertion was ambiguous. The markup was also just wrong: one image with its name beneath it is a figure. Scoping queries to it fixed the tests and improved the semantics at once.
- **The 512 and the original are stacked, not swapped.** Rendering one `<img>` whose `src` changes leaves a frame where the element is empty while the new data URL decodes. The full image is absolutely positioned over the cached thumbnail instead, so the swap has nothing to flicker through.
- **The full read is skipped outright past `IMAGE_CAP`** rather than issued and allowed to fail — the backend would refuse it, and the 512 is the answer either way. Formats `backend/thumbs` cannot decode (webp, svg, bmp, ico) have no thumbnail to fall back to, so for those the full read is the only source and always runs.
- **M10's lesson carried over intact, and the running app proved it.** A text file named `decoy.png` is classified as an image by extension, produces no thumbnail, reads back fine, and fails only in the decoder — the stage's `onError` demotes it to "This image could not be shown" instead of an empty frame.
- **Left/Right stepping went into `useListKeyboard` as an `orientation` option**, per decision 8. A filmstrip is one row, so `horizontal` makes Left/Right step and declines Up/Down rather than pretending they mean something. Building a second pane-scoped key handler here would have recreated exactly the drift M11's registry exists to prevent, and Home/End came free.
- **Cmd+5 stopped being a reserved blank and became a binding**, with `as Photos` added to `constants/menus.ts` and `backend/appmenu`. `TestCommandIDsExistInFrontend` caught nothing this time, which is the point: it would have failed loudly had only one side been updated.
- **Auto-selecting the first photo opens the preview panel**, because M3's rule is "a selection appearing reveals the preview". It is consistent with the mockup, which moves `panel.selectedId` and `state.previewFile` together — but it is a real consequence of decision 2 rather than an intended feature, and worth revisiting in M12 if it grates.
- **Bug found by the layout pass, and it predates this milestone: the pane never claimed its slot.** `ExplorerPane`'s `<section>` was `flex min-w-0 flex-col` with nothing making it fill the column `PaneGroup` sizes for it, so on the main axis it was content-height. Details and the icon grids hid this by accident — a directory long enough to overflow shrinks back to the available height and looks exactly right. Photos has no intrinsic height at all, since the stage is absolutely-positioned images, so the pane collapsed to the filmstrip and stopped at 181px inside a 559px slot. Fixed with `flex-1 min-h-0` on the section, which is what every view wanted; measured in the running app before and after.
- **The stage fills, the strip floors.** Making the stage `flex-1` rather than `h-[70%]` is what puts the strip on the bottom edge and lets the 150px minimum win when 30% would be smaller — verified across pane heights of 600/400/300/200px, where the strip measured 180/150/150/150 and stayed flush to the bottom in all four.
- **The filmstrip draws uniform cards, and the card is a frame rather than a crop.** One height measured from the strip and one width derived from it at 16:9, so the row reads as a line of identical slots instead of a ragged edge. The photo inside is `object-contain` and centred, which is the point of a fixed card shape: cropping every portrait into a 16:9 letterbox would hide most of the picture the strip exists to preview. Measured across a 16:9, a square and a 3:12 source — cards identical at 243×137 (ratio 1.778) with equal gaps on both axes in every case, the square pillarboxed and the tall one a centred narrow strip.
- **Centring is on a wrapper, not `margin: auto` on the image.** The classic `inset-0; margin:auto` trick only centres a replaced element once it has a definite size, which is not true while a data URL is still decoding — and the stage swaps two images. Both layers are now the same absolutely-positioned flex overlay, so the swap cannot shift the image by a pixel. Measured against a 1200×300, a 300×1200 and a 60×60 source: equal gaps on both axes in every case, and the 60×60 rendered at 60×60 rather than being blown up, which is M10's no-upscaling rule still holding.
- **Second note for whoever verifies next: a hidden Chrome tab does not run `IntersectionObserver`.** Driving the browser dev server without the tab in front leaves every lazily-loaded thumbnail showing its fallback icon, which reads exactly like a broken thumbnail pipeline — the stage keeps working, because it fetches directly rather than waiting to be scrolled into view. Confirmed with `document.visibilityState`; taking a screenshot brings the tab forward and everything loads. Cost about twenty minutes of chasing a bug that was not there.
- **Note for whoever verifies next.** Plain arrow keys cannot be driven into the webview through `System Events` — only the document-level shortcut registry sees synthetic keystrokes, so list navigation and photo stepping have to be exercised by clicking, or in tests. Sidebar and toolbar buttons *do* respond to AX `click`, which is the reliable way to move around the running app; listing rows do not.

Verified in the running app against real files: a folder of six images plus a text file and a subfolder opening on the first photo with the other two filtered out; the nav buttons stepping through all seven images with Previous absent on the first and Next absent on the last; the preview panel and the status bar's "1 selected" both following the active photo; a text file named `.png` degrading to its error state rather than a broken frame; "No images in this folder" in a folder full of documents; switching Photos → Details → Photos keeping the active photo; and a relaunch restoring the pane into Photos view. Layout measured in the running app: the pane filling its 559px slot, the strip at 30% above its floor and pinned to 150px below it, always flush to the bottom, thumbs never under 50px, and the stage image centred on both axes at three different aspect ratios.

### M14 — File hashes ✅ complete

A `#` button in the toolbar opens a modal that calculates hashes for the selected
files. Algorithms down the left side, one row per file on the right, digest
shown as soon as each file finishes.

**Algorithms: CRC32, MD5, SHA-1, SHA-224, SHA-256, SHA-384, SHA-512.** Every one
is in the Go standard library (`hash/crc32`, `crypto/md5`, `crypto/sha1`,
`crypto/sha256`, `crypto/sha512`) — no new dependency, in a feature where a
third-party implementation would be the last place to want one.

> **On "SHA128".** The request listed it; it does not exist. SHA-2 has no
> 128-bit member. The 128-bit digest people mean here is MD5, already on the
> list, and the algorithm that usually sits beside it in a checksum panel is
> SHA-1 (160-bit) — which is what the slot is filled with. If the intent was
> something else, this is the line to change.

**Numbered after M13, built before M12**, for the same reason M13 is: M12's
polish, light-theme and empty-state passes should cover this surface once rather
than twice. Its dependency is M11's shortcut and menu registry.

Decisions taken up front:

1. **Hashing streams in Go and never crosses the bridge as bytes.** `io.Copy`
   from the file into the hash writer with a fixed buffer, so a 20GB disk image
   costs a constant amount of memory. The bridge carries hex strings — the one
   thing M10 already learned the hard way is that a Go `[]byte` marshals to a
   JSON array of numbers.
2. **The job API mirrors M8's search: `hash(request) → id`, `cancel(id)`,
   `subscribe({onResult, onProgress, onDone})`.** A checksum over a selection is
   the same shape of problem as a walk — unbounded duration, results that should
   appear as they land, and a user who closes the window meaning *stop*. A
   single blocking call would freeze the modal on the first large file and
   would give closing it no way to reclaim the disk. Closing the modal cancels;
   so does changing algorithm mid-run.
3. **One algorithm at a time, cached per `(path, size, mtime, algorithm)`.**
   Computing all seven in one pass over the file is tempting — the read is
   shared — but SHA-512 and CRC32 are not remotely the same CPU cost, and it
   would mean paying for six columns nobody asked to see. Switching algorithms
   re-reads the file; the OS page cache absorbs that for anything that fits, and
   the cache means a given (file, algorithm) is computed at most once per
   session.
4. **The digest cache is in memory and dies with the process.** `backend/thumbs`
   persists keyed on mtime, and copying that here would be wrong: mtime is a
   claim the filesystem makes and `touch -t` can set it to anything, so a
   persisted digest could keep asserting a hash for bytes that no longer exist.
   Recomputing costs seconds; a stale checksum is a wrong answer to the only
   question the feature exists to answer.
5. **Progress is measured in bytes, not files.** The common case is one large
   file, where a count-based bar reads 0/1 for four minutes and then finishes.
   The row shows a determinate bar from bytes read against the size the listing
   already carries. Emissions coalesce at 100ms or 64MB, whichever comes first —
   the same reasoning as the watcher's batching.
6. **Concurrency is bounded by a small worker pool (4), one file per worker.**
   Hashing is CPU- and IO-bound at once; handing 200 selected files to 200
   goroutines thrashes the disk and finishes no sooner. Follows `backend/thumbs`'
   semaphore.
7. **A failed file fails its own row.** Permission denied on one file in a
   selection of forty must not kill the batch — the same rule that keeps one
   dangling symlink from making a directory unlistable (§M1). The row carries
   the typed `FsError`.
8. **Directories are excluded, not errored.** A recursive folder digest is a
   different feature with its own unanswered question (what tree encoding?).
   Folders in the selection are dropped from the row list with a line saying how
   many were skipped, so nothing silently disappears.
9. **Comparison is the point, so two affordances, both cheap.** Identical
   digests within the run are grouped and badged ("2 files match") — that answers
   "are these the same file?" without the user reading 64 hex characters twice.
   And a *verify* field: paste an expected hash and the matching row highlights.
   The paste is trimmed, compared case-insensitively, and tolerates the
   `<hash>  *filename` form that `shasum` and every download page emit, because
   that is what is actually on the clipboard.
10. **Copy out in `shasum` format.** Per-row copy for the bare digest, plus a
    "Copy all" that produces `<hash>  <name>` lines that paste straight into
    `shasum -c`. Dragging out to Finder remains impossible (§3), so the
    clipboard is the way across — the same conclusion M9 reached with Copy Path.
11. **CRC32 is labelled as an integrity check, not a hash, and sits in its own
    group.** MD5 and SHA-1 are marked as unsuitable for security while staying
    on the list, because published checksums still use them. A checksum tool that
    lets someone verify a download with CRC32 believing it proves authenticity is
    worse than one that omits it.
12. **The modal gets its own `uiStore` field, not the dialog stack.**
    `dialog` is a one-shot question with a promise waiting on the answer
    (`pendingResolve`); this is a long-lived view with internal state that
    resolves nothing. Routing it through `askConfirm`'s machinery would mean a
    dialog that settles a promise nobody awaited. `hashJob: { paths } | null`
    alongside `dialog`, rendered above it.
13. **The chosen algorithm persists via the existing `settings` table.** The
    user who verifies SHA-256 downloads verifies SHA-256 downloads. Default is
    SHA-256.
14. **The row list virtualizes.** Selecting 5,000 files and hitting `#` is a
    thing people will do; `@tanstack/react-virtual` is already in use.
15. **The mock bridge returns synthetic digests, derived from content, of the
    right length per algorithm — and says so.** Web Crypto has no MD5, no
    SHA-224 and no CRC32, so a faithful mock would mean shipping a second hash
    implementation in TypeScript: a second thing to get wrong, and a standing
    invitation for something to use it for real. Deriving them from the file's
    bytes keeps equal content producing equal digests, which is what the
    match-grouping and verify-field tests need. Digest *correctness* is a Go
    concern, pinned there by published test vectors for every algorithm —
    including the empty input, which is exactly where a wrong implementation
    looks right.

Entry points: the toolbar `#` (Lucide `Hash`), disabled when the selection holds
no files; `file.calculateHashes` in the File menu, the native app menu and the
file/folder context menus; and `Cmd+Alt+H` in M11's registry (`Cmd+Shift+H` is
Go → Home).

Files: `backend/hashing/{hashing.go,hashing_test.go}`; `services/hashing/hashService.ts`
(job subscription + digest cache); `hooks/useHashes.ts`; `features/hashing/{HashModal,AlgorithmList,HashRow,VerifyField}.tsx`;
`constants/hashAlgorithms.ts`. Additions to `services/bridge/types.ts` (`HashApi`)
with both implementations, `stores/uiStore.ts` (`hashJob`), `constants/menus.ts`,
`constants/contextMenus.ts`, `constants/shortcuts.ts`, `backend/appmenu/appmenu.go`,
`components/toolbar/Toolbar.tsx` and `main.go` (bind the struct).

Also touched, none of it foreseen: `types/hashing.ts` (the wire model — it is a
domain of its own, and `types/file.ts` is the *filesystem* data model);
`backend/filesystem/errors.go` (exporting `Wrap`, see the notes below);
`services/filesystem/queries.ts` (`fileInfosQuery`, so the selection stat goes
through React Query like every other filesystem read); `db/repositories/settings.ts`
and `db/persistence.ts` (`hashAlgorithm`, validated on the way out);
`hooks/useKeyboard.ts` (the modal joins `dialog` and `contextMenu` in owning the
keyboard).

**Done when:** selecting several files and clicking `#` opens the modal with a
row per file, each digest appearing as its file finishes rather than all at the
end; the sidebar switches algorithm and recomputes; two identical files are
badged as matching; pasting a published checksum highlights its row; a
multi-gigabyte file shows a moving byte progress bar and stops when the modal is
closed; an unreadable file shows its error on its own row while the rest
complete; and the Go test vectors pass for all seven algorithms. ✅

Notes from the build:

- **All fifteen decisions held**, as M13's did. Two grew a consequence worth
  recording rather than changing: decision 3's cache turned out to need the
  *size and mtime* in its key as well as the path, or a file edited while the
  modal is open answers with the digest of what it used to be; and decision 8's
  "folders are dropped" needed a second line for items that were *gone* by the
  time the modal asked, which is a different disappearance with the same
  symptom.
- **The published vectors were computed by `shasum`, `md5(1)` and zlib, not by
  Go.** A table of expected digests generated with the implementation under test
  is a test that cannot fail. The million-byte input earns its place separately:
  it is the only case that crosses the 256KB read buffer, several times, so a
  streaming bug that drops or double-counts a buffer shows up there and nowhere
  else.
- **`classify()` was exported rather than copied.** `backend/hashing` opens
  files directly, and a permission denial there has to reach the UI as
  `permission-denied` rather than as prose. `backend/search` and `backend/thumbs`
  each carry their own small error encoder because their failures are their own
  judgement; a real errno is not, so `filesystem.Wrap` is now exported and this
  package uses it. A third copy of `classify` is how three packages start
  disagreeing about what EACCES means.
- **A second drift test, on the same principle as M11's.**
  `TestAlgorithmsMatchFrontend` reads `constants/hashAlgorithms.ts` and fails if
  either side names an algorithm the other does not have — an algorithm offered
  in the sidebar that Go cannot compute would be a row failing for a reason
  nobody can act on. It has to be scoped to the `HashAlgorithm` union: run over
  the whole file it also matches `AlgorithmGroup`'s members and reports "secure"
  as a missing algorithm. It caught the half-wired state twice during the build,
  as did M11's when `file.calculateHashes` reached the native menu first.
- **The state is derived during render, not assigned from an effect.** The first
  shape of `useHashes` reset four pieces of state inside an effect and tripped
  `react-hooks/set-state-in-effect` — which was right: that is the pattern M10's
  thumbnail bug came from, a frame showing the *previous* answer under the new
  label. It is now one `Run` object rebuilt when its key changes, and the
  selection stat moved to React Query, where a filesystem read belongs anyway.
- **The digest is read in tests by matching an element whose *whole* text is
  hex.** Scanning the row's text instead finds "df" — the last two characters of
  `Resume.pdf` — glued to the front of the digest, and five assertions failed
  identically for a reason that had nothing to do with hashing.
- **Row height is one decision per algorithm, not a measurement per row.** Every
  row in a run shows the same algorithm's digest, so the height follows from the
  digest length: past ~88 hex characters it wraps to a second line, which is
  SHA-384 and SHA-512. `measureElement` would be the general answer and is the
  wrong one here — jsdom reports every element as the full viewport height, so
  it would render exactly one row in every test.
- **Cancelling before the id exists had to work.** `startHashJob` returns its
  cancel function synchronously, and the modal can be closed before the promise
  carrying the job id has resolved — at which point the job exists in Go and
  nothing has been told to stop it. The cancel is deferred into the `then`
  instead. Same family as M8's subscribe-before-you-ask race, which is also
  handled here: the mock delivers its first result on a microtask, before the id
  is known, deliberately.
- **The mock says so in the console rather than in the digest.** Decision 15's
  "and says so" cannot be the digest string itself — the UI has to receive
  something of the right shape or none of it is exercised — so the mock logs
  once per session that its digests are synthetic. What it does preserve is the
  property the UI is written against: a mock file is its size plus its content,
  a copy keeps both, so duplicating a file really does badge the two as matching.
- **Verified in the running app against real files**, with the fixtures' digests
  computed independently by `shasum`, `md5(1)` and zlib beforehand: the empty
  file, `"abc"`, and a million `a`s all matched the published vectors under
  SHA-224, SHA-256, SHA-512, MD5 and CRC32 — including CRC32 of the empty file
  rendering as `00000000` with its leading zeros intact, and a 2.5GB and a 16GB
  file matching `shasum` exactly. Two files with identical content were badged
  "2 files match"; a `chmod 000` file showed "macOS blocked access to this
  location" on its own row while every other row completed; a folder in the
  selection produced "1 folder skipped". **Copy All was pasted straight into
  `shasum -a 256 -c`, which reported OK for every line.** The 16GB file's bar
  climbed 268MB → 10.9GB against a 16.00GB total over about four seconds, and
  closing the modal mid-read took the process from ~100% CPU to 0.1% within a
  second and left it there. The chosen algorithm survived a quit and relaunch
  through the `settings` table.
- **Note for whoever verifies next.** M13's warning about synthetic keystrokes
  is worse than it reads: they reach the document-level shortcut registry, and
  *nothing else*. A text input cannot be typed into through the accessibility
  API at all — focusing it and sending keystrokes leaves it empty, and setting
  `AXValue` does not fire React's `onChange` — so the verify field is the one
  surface here that could only be exercised in tests. What does work, and worked
  well: `Cmd+A` and `Cmd+Alt+H` through the registry, `key code 18` for Cmd+1,
  AX `click` on every button and radio, and reading the whole modal out of the
  AX tree. JXA (`osascript -l JavaScript`) is markedly better than AppleScript
  for this — `entire contents` on a webview subtree throws `-1700` partway
  through, while a hand-written recursive walk in JXA is reliable. Two things
  cost time: `drive.js` matched radio labels exactly, so `SHA-1` and `MD5` —
  whose labels carry their security note — silently matched nothing; and a full
  AX walk takes several seconds, which is long enough that a click and a
  subsequent read must happen in the *same* `osascript` process to observe
  anything mid-run.

### M15 — Quick file creation ✅ complete

Create a file of any type immediately, either empty or from a template —
predefined ones that ship with the app, and custom ones the user writes
themselves.

**Numbered after M14, built before M12**, for the third time and the same
reason: M12's polish, light-theme and empty-state passes should cover this
surface once rather than twice. Its dependencies are M6's creation path and
M11's menu registry.

**What M6 already built, and what this is not.** `file.newFile` (Cmd+N) creates
`untitled file`, selects it, and opens the inline rename editor — Finder's
behaviour, and already instant. That path is not being replaced or slowed down.
What is missing is everything about the file's *type*: it has no extension, no
content, and no way to get either without renaming it and opening an editor.

Decisions taken up front:

1. **Cmd+N keeps doing exactly what it does now.** A feature about speed must
   not put a dialog in front of the fastest thing in the app. `file.newFile`
   stays a one-keystroke empty file; this is a second command
   (`file.newFromTemplate`, `Cmd+Alt+N` — `Cmd+Shift+N` is New Folder), and a
   second *route*, never a second implementation of creation.
2. **The name field is the feature; the template list is an assist.** Typing
   `notes.md` and pressing Enter is the whole interaction — the extension picks
   the Markdown template on its own. Picking from the list works the other way,
   filling in the extension and leaving the stem alone. Neither is a mode, and
   neither is required: `foo.xyz` with no matching template creates an empty
   `.xyz`, which is what "any type" has to mean.
3. **Writing content is a new capability, and it is deliberately not a write
   API.** Nothing in the bridge can put bytes into a file today, and the obvious
   `WriteFile(path, content)` is the wrong thing to add: it can truncate
   anything, forever, for every future caller. Instead `CreateFile` grows the
   content — `CreateFile(parent, name, content, executable)` — and keeps M6's
   `O_EXCL`, so it creates or it fails, and can never write over a file that is
   already there. There is still no way to overwrite a file from this app.
4. **One creation path, not two.** Rather than adding `CreateFileWithContent`
   beside the existing method, the existing one is widened and M6's call site
   passes `""`. Two near-identical methods would be two places deciding
   `O_EXCL` and file mode, which is how they start disagreeing.
5. **The executable bit is a parameter, not a follow-up `chmod`.** A shell
   script template that produces a non-executable file is the single most
   annoying way this feature can fail. Passing it to the same call means the
   file is never briefly wrong, and a failed second call cannot leave a
   half-made file behind.
6. **Content crosses the bridge as a string; templates are text by
   definition.** M10's lesson — a Go `[]byte` marshals to a JSON array of
   numbers — and the honest consequence: a *binary* template is a file to copy,
   which is Duplicate, not this. UTF-8, no BOM, LF endings: a BOM breaks a
   shebang, and CRLF is not something to introduce on macOS.
7. **A template earns its place only if the empty file would be wrong.** This is
   the whole rule for the built-in set. "Plain Text" as a template is pointless
   — Cmd+N already makes that file — whereas HTML without its skeleton, a
   shell script without its shebang, or JSON that is not even `{}` are useless
   as starting points. That filter gives roughly: HTML, CSS, JSON, YAML,
   Markdown, JavaScript, TypeScript, React component, Python, shell script,
   `.gitignore`, Dockerfile, SQL. Anything else is reachable by typing its
   extension.
8. **Built-ins are code; custom templates are files on disk.** Built-ins live in
   `constants/fileTemplates.ts` — versioned with the app, no migration when one
   is added. Custom ones live in a real folder,
   `~/Library/Application Support/MacFileExplorer/Templates`, and this is a file
   explorer: someone who wants a custom template should write a file, not fill
   in a form. It costs no migration, no template-editor UI, and no export
   format; the templates are portable, syncable, and editable in whatever the
   user already uses. A template's name is its filename, its content is its
   bytes, its default extension is its own extension, and its executable bit is
   its own — if your template file is executable, so is the file made from it.
9. **No new Go package, and one new standard path.** Reading that folder is
   `ReadDirectory` plus `ReadTextFile`, both of which exist; the executable bit
   is already in `FileItem.permissions`. Only the *location* is new, and paths
   are resolved natively rather than string-built in TS (§1), so `StandardPaths`
   gains `templates`. The folder is created empty on first open of the dialog —
   not seeded, because a folder of files the user did not write is clutter, and
   the built-ins already cover the common cases. The dialog always ends with
   "Reveal Templates Folder", so there is a way in even when it is empty.
10. **Four placeholders, no expression language.** `{{name}}` (the new file's
    own stem), `{{date}}`, `{{time}}`, `{{year}}` — substituted by a map lookup,
    with no conditionals, no loops and nothing user-defined. A LICENSE without
    `{{year}}` is half-useful; a template language is a slope with no natural
    stopping point, and anything needing logic is a script rather than a
    template. **An unrecognised `{{token}}` is left exactly as it is**, which is
    not politeness: Handlebars, Jinja and Go templates all use those braces, so
    a template *for* one of those files would otherwise be destroyed by the
    thing meant to produce it.
11. **A name that already exists is reported, not silently renamed.** M6 can
    auto-number `untitled file 2` because nobody chose that name; here the user
    typed it, and quietly creating `notes copy.md` answers a question they did
    not ask. The field says so as they type, and `O_EXCL` is the backstop for
    the race between the two.
12. **The dialog gets its own `uiStore` field, as M14's modal did.** `dialog` is
    a one-shot question whose `DialogResult` is `boolean | ConflictPolicy |
    null`; this one resolves a `{name, template}` pair. Widening that union so
    every existing dialog's result type is looser, for one caller's benefit, is
    the wrong trade — `newFile: { parent, paneId } | null` beside `hashJob`.
13. **The last template used is remembered, in `settings`.** One value, the same
    machinery M14's algorithm uses. Someone making ten `.tsx` files a day should
    pay for the choice once, and it is the difference between "instant" and
    "instant after I find it in the list again".
14. **A user template is a file, so it can be anything.** Over 1MB it is listed
    but refused with the reason, using `readTextFile`'s existing cap; not valid
    UTF-8, likewise. A broken template must never stop the dialog opening — the
    rule that keeps one dangling symlink from making a directory unlistable
    (§M1), applied to a folder the user maintains by hand.
15. **Creation is undoable, once, whatever the content.** The same `create`
    entry M6 pushes, and the same optimistic patch and invalidation — a new file
    appearing is a change the watcher would report anyway, and M6's manual
    invalidation already covers the case where it does not.

Entry points: `file.newFromTemplate` in the File menu, the native app menu and
the background context menu (where "what can be created here" already lives);
`Cmd+Alt+N` in M11's registry. The toolbar keeps its single New Folder button —
a second creation button beside it would need explaining, and the menu and the
shortcut are where this belongs.

Files: `constants/fileTemplates.ts`; `services/templates/templateService.ts`
(loading the folder, substitution); `features/newFile/{NewFileDialog,TemplateList}.tsx`.
Additions to `backend/filesystem/{filesystem.go,operations.go}` (`StandardPaths.templates`,
`CreateFile`'s content and executable arguments) and its tests,
`services/bridge/types.ts` with both implementations, `services/filesystem/queries.ts`
(a templates query), `hooks/useFileOperations.ts` (`createFromTemplate`),
`stores/uiStore.ts` (`newFile`), `db/repositories/settings.ts` (`lastTemplate`),
`constants/{menus,contextMenus,shortcuts}.ts`, `backend/appmenu/appmenu.go` and
`app/layouts/ExplorerLayout.tsx`.

**Done when:** Cmd+Alt+N opens the dialog on the pane's folder; typing
`notes.md` and pressing Enter creates a Markdown file with the template's
content and leaves it selected with its name editable; picking HTML from the
list fills in the extension, keeps the stem, and produces a file that opens as a
real skeleton; a shell script template produces a file that runs without
`chmod`; `{{name}}` and `{{year}}` are substituted while `{{unknown}}` survives
untouched; a file dropped into the Templates folder appears in the list on the
next open, with its own extension and executable bit; a name that already exists
is refused in the field rather than renamed; typing an extension no template
claims still creates an empty file of that type; and undo removes it. ✅

Notes from the build:

- **All fifteen decisions held**, and decision 3 is the one worth restating:
  after M15 there is still no way to overwrite a file from this app. `CreateFile`
  grew content and a mode and kept its `O_EXCL`, so the only thing that puts
  bytes on disk creates or fails. A Go test writes a file, asks the app to
  create over it, and checks both that the call is refused and that the original
  bytes are untouched.
- **Decision 7 cut the built-in list roughly in half, and that was the rule
  working.** The plan sketched thirteen templates "roughly"; applying its own
  test — a template earns its place only if the empty file would be wrong —
  leaves eight. An empty `.css`, `.ts`, `.sql` or `.yml` is a perfectly good
  place to start, so a template for one could only hold filler the user deletes
  first, which is worse than no template. What survives is where the empty file
  is invalid (JSON), inert (a shell script with no shebang and no executable
  bit), or missing boilerplate nobody wants to retype. Everything else is still
  one keystroke away by typing its extension, which is decision 2's whole point.
- **Templates needed a `filename`, not just an extension.** `Dockerfile` and
  `.gitignore` are files with names, not types — the plan's "picking a template
  fills in the extension" does not describe either. A template may name a whole
  file instead, and matching tries the full name before the extension, so typing
  `Dockerfile` finds it rather than being read as an extensionless stem.
- **A bug the tests did not catch and running the app did.** With a template
  already selected — picked from the list, or restored from last time — typing
  an extension it does not claim wrote that template's content into the new file
  anyway: `readings.opml` came out as 104 bytes of Markdown boilerplate. The
  original rule was "typing picks a template but never unpicks one", which
  protects against a mid-word deletion dropping a deliberate choice; the fix is
  that a template survives only a name that does not *contradict* it. An
  extensionless name contradicts nothing, so picking Markdown and typing
  `LICENSE` still uses it. Both halves now have a regression test.
- **`ReadTextFile` does not fail on binary, so the check had to be for the
  damage.** It replaces invalid UTF-8 with U+FFFD rather than erroring, which is
  right for a preview and means a PNG dropped into the templates folder arrives
  as a string full of replacement characters. Detection is those characters plus
  a NUL byte, which survives the replacement because it is valid UTF-8. A real
  text file containing U+FFFD is a false positive, and worth it: the cost is one
  template refused with a reason on screen, against pasting a binary into a
  source file.
- **Verified in the running app against real files.** The Templates folder was
  created empty on first open, exactly as decision 9 says. Cmd+Alt+N opened the
  dialog on the pane's folder with the eight built-ins listed, the shell script
  marked executable and Dockerfile and Git Ignore showing whole filenames.
  Typing `release notes.md` selected Markdown on its own and Enter produced a
  file containing `# release notes` — `{{name}}` as the stem, not the filename.
  **A shell script created from the template came out `-rwxr-xr-x` and ran, with
  no `chmod`.** Two files dropped into the real Templates folder appeared under
  "Yours" on the next open, `task.sh` carrying its own executable bit; the
  Markdown one produced `# MIT` and `Copyright (c) 2026` while leaving
  `{{user.name}}` and `{{#if admin}}yes{{/if}}` **exactly as written**, which is
  decision 10's whole reason for existing. Retyping an existing name reported it
  in the field and disabled Create.
- **Note for whoever verifies next: a webview text field *can* be typed into
  after all, if it has focus.** M14 recorded that synthetic keystrokes reach
  nothing but the document-level shortcut registry, and its verify field could
  not be driven. The difference is that this dialog focuses its name field on
  mount, and with focus already there `keystroke` lands normally — as does
  `Cmd+A` to replace what is in it. So the M14 limitation is narrower than it
  looked: the problem was never typing, it was that AX cannot *move* focus into
  a webview input. Anything auto-focused is drivable.

### M16 — Split layout: a dropdown, and a real 2 × 2 grid ✅ complete

Four changes to what M2+M3 shipped: the toolbar's segmented split control becomes
a dropdown; four panes become two rows of two rather than four columns; and
"Two Panes" / "Three Panes" are renamed to **2 Columns** / **3 Columns**, which
is what they actually are.

**The icon was already right.** Four panes has been drawn with Lucide's
`Grid2x2` since M2 — the control has been promising a 2 × 2 grid and the layout
has been handing back four columns. Four 320px-wide slivers in a 1280px window
is not a layout anyone uses twice; two rows of two is.

**Numbered after M15, built before M12**, for the same reason the last three
were. It has no dependency on M14 or M15 and can be built before either.

Decisions taken up front:

1. **The grid is a cross, not an H.** One full-height vertical divider and one
   full-width horizontal divider, meeting in the middle — dragging the vertical
   one moves the column split in *both* rows together. The alternative, a
   divider per row moving independently, is more flexible and is not what
   "cross" means: the two rows stop lining up, and the layout reads as two
   unrelated splits stacked. It is also twice the state for a freedom nobody
   asked for.
2. **`paneSizes` becomes `layout: { columns: number[]; rows: number[] }`.** The
   current model is a flat list of fractions along one axis, one per pane, and a
   grid cannot be said in it. Every mode is expressible in the new one — 1 is
   `{columns:[1], rows:[1]}`, 3 Columns is `{columns:[⅓,⅓,⅓], rows:[1]}`, the
   grid is `{columns:[½,½], rows:[½,½]}` — and panes fill it in reading order,
   so `paneIds[row * columns.length + column]`. Bolting a `rowSizes` field
   beside `paneSizes` would leave a field whose name promises one entry per pane
   and no longer delivers it, which is also what its persistence validation
   checks.
3. **Shape is a constant; only the fractions are state.** `SPLIT_GRIDS: Record<SplitMode,
   {columns: number, rows: number}>` — `1: 1×1, 2: 2×1, 3: 3×1, 4: 2×2`. The
   store never invents a shape, the layout never guesses one, and a future 6-up
   (3 × 2) is one row in that table rather than a new branch everywhere.
   `splitMode` stays as the *named* thing the user picked, which is what the menu
   checkmarks and the status bar are keyed on; `layout` is only how big each part
   currently is.
4. **`useSplitResize` gains an axis instead of a twin.** The maths is identical
   on both — a delta over the container's extent, redistributed between two
   neighbours, floored at `MIN_FRACTION` — and only the coordinate (`clientX` vs
   `clientY`) and the dimension (width vs height) differ. One hook taking
   `axis: 'x' | 'y'`, instantiated twice, rather than a `useSplitResizeVertical`
   that starts identical and drifts.
5. **Arrow keys follow the divider they are on.** Left/Right nudge a vertical
   divider, Up/Down a horizontal one. The dividers are already focusable with
   `role="separator"`; a horizontal one that answered to Left/Right would be
   the sort of detail that makes keyboard support feel like an afterthought.
6. **Four spellings of four modes collapse into one.** The labels live in
   `Toolbar.tsx`, in `constants/menus.ts`, in `backend/appmenu/appmenu.go` and —
   differently — in `StatusBar.tsx`, which says "Split" and "4-Way" while the
   menu says "Two Panes" and "Four Panes". That is not a naming decision anyone
   took; it is two places that were written months apart. A
   `constants/splitModes.ts`, mirroring the `constants/viewModes.ts` that
   already exists for view modes, becomes the single source for label and icon,
   and the status bar loses its private vocabulary. Go keeps its own copy
   because it must, pinned by `TestCommandIDsExistInFrontend` as it already is.
7. **The names say the shape: Single Pane, 2 Columns, 3 Columns, 2 × 2 Grid.**
   Renaming two of them and leaving "Four Panes" would make the odd one out the
   only one that does not describe what you get. "1 Column" for the single view
   is the consistency too far — it is not a column, it is the whole pane.
8. **The command ids do not change.** `view.splitFour` keeps its name even
   though it no longer means four columns. Ids are internal, they are pinned
   across the Go/TS boundary by a drift test, and renaming them touches three
   files to change a string nobody sees. Stated here so the next reader knows it
   was a decision rather than something missed.
9. **The dropdown is `ViewMenu`'s pattern, not a new one.** Closes on outside
   pointerdown and Escape, unbinds when shut, `role="menu"` with
   `menuitemradio` children — the same component shape, sitting beside it in the
   toolbar. It replaces the segmented group outright rather than joining it,
   which also gives back about 136px of a toolbar that has been getting crowded.
10. **Switching mode still resets the sizes to even.** That is today's behaviour
    and it stays: remembering that the user had dragged the 3-column split to
    20/20/60 and trying to honour it when they come back from the grid means
    storing a layout per mode, and restoring a lopsided split someone set up for
    a different arrangement is not obviously a kindness.
11. **A session written by this build must survive an older one, and the
    reverse.** M13's decision 9, one step harder, because the *shape* changes
    rather than a value: `parseTab` reads old `paneSizes` and lifts it —
    `columns = paneSizes, rows = [1]` for modes 1–3, and for an old four-column
    tab it falls back to an even 2 × 2, because four fractions along one axis do
    not mean anything in a grid. In the other direction an older build finds no
    `paneSizes`, and its existing "sizes must match the pane count or use even
    ones" fallback already handles that — a downgrade loses a dragged split, not
    the session. Both directions get a regression test, and the round trip is
    confirmed against a real database before shipping.
12. **The grid halves the height every pane gets, and M13 already measured what
    that costs.** With `MinHeight: 480` a 2 × 2 leaves each pane around 200px —
    the smallest size the Photos view was verified at, where the filmstrip sits
    on its 150px floor and stays flush to the bottom. `MIN_FRACTION` (0.12) now
    applies on both axes, and the per-view floors M13 established do the rest.
    Nothing new to build; it does need re-checking in the running app, since
    every view was verified in a single row of panes.
13. **M9's drop hit-testing needs re-verifying, not rewriting.** External Finder
    drops are routed by hit-testing window coordinates against `data-drop-path`,
    which is geometry and does not care how the panes are arranged. But it was
    only ever verified against one row of them, and a pane in the bottom row is
    the first case where a drop's Y coordinate has to pick between two panes.

Files: `constants/splitModes.ts` (labels, icons, `SPLIT_GRIDS`);
`components/toolbar/SplitMenu.tsx`. Changes to `types/workspace.ts`
(`Tab.layout` replacing `Tab.paneSizes`), `stores/workspaceStore.ts`
(`setLayout` replacing `setPaneSizes`, and `setSplitMode` building from
`SPLIT_GRIDS`), `features/explorer/PaneGroup.tsx` (rows of columns, two divider
kinds), `hooks/useSplitResize.ts` (the axis option),
`components/toolbar/Toolbar.tsx` (the segmented group goes),
`components/common/StatusBar.tsx` (read the shared label),
`constants/menus.ts` and `backend/appmenu/appmenu.go` (labels only), and
`services/db/repositories/session.ts` (the lift, and its fallbacks).

**Done when:** the toolbar shows one Split Layout dropdown in place of the four
buttons, listing Single Pane / 2 Columns / 3 Columns / 2 × 2 Grid with the mode
in use checked; picking the grid lays four panes out as two rows of two, letters
A B above C D; the vertical divider runs the full height and moves both rows'
columns together while the horizontal one moves both rows; both are draggable
and nudgeable by the arrow keys that match their orientation; the status bar and
all three menus print the same four names; a session saved in the grid comes back
in the grid with its dragged proportions, and a session saved by the previous
build still opens; and a Finder drop onto a bottom-row pane lands in that pane's
folder. ✅ (all but the last — see the note below)

Notes from the build:

- **All thirteen decisions held**, and decision 2 was the one that mattered:
  replacing `paneSizes` with `layout` was not a rename but the change everything
  else fell out of. Once the geometry was two axes of fractions, the grid was
  `grid-template-columns` / `-rows`, the resize hook was the same maths twice,
  and the dividers were two elements rather than three.
- **CSS Grid, not nested flex rows** — a choice the plan left open. Panes fill a
  grid in reading order for free, and the fractions go straight into
  `grid-template-*` rather than being threaded through `flexGrow`/`flexBasis` at
  two levels. One trap: a bare `Nfr` track lets a long filename push a column
  wider than its share, so every track is `minmax(0, Nfr)`.
- **The dividers are positioned over the grid rather than sitting in it**, and
  that is what actually delivers decision 1. A column divider rendered inside
  each row would be two elements that happen to line up — two tab stops and two
  things a screen reader announces, for one split. As overlays there is one
  full-height line, and the drag maths gets more accurate as a side effect: the
  container's width is no longer the panes' width plus the dividers'.
- **Three labels for two dividers.** With more than two columns a bare "Resize
  columns" is ambiguous, so 3 Columns names them "Resize column 1" and "Resize
  column 2", while 2 Columns and the grid — which have exactly one — keep the
  plain name.
- **The status bar's split name is now the same as everywhere else**, which
  broke four tests asserting on the old private vocabulary ("Single", "4-Way").
  Worth recording because it is the milestone working: those assertions had
  encoded a drift nobody ever decided on.
- **One test failed for exactly the right reason.** `getByText(/2 × 2 Grid/)`
  matched twice — once in the dropdown, once in the status bar — which is the
  single-source change landing. Scoped to `/2 × 2 Grid \/ Details/`.
- **`parseTab` grew a rule it did not have: the mode and the pane count must
  agree.** A stored mode is kept only when it holds exactly the panes that
  survived, and the pane list is trimmed to fit. Before, a four-pane tab that
  lost a pane restored as `splitMode: 4` with three panes — a merely odd
  four-column layout then, a grid with an empty cell now. A latent bug that only
  became visible because the geometry got stricter.
- **Verified in the running app**, measured through the accessibility API: the
  grid renders four equal quadrants (390 × 316 each) with **one column divider
  631px tall spanning both rows** and one row divider 780px wide spanning both
  columns — two dividers, not three, orientations correct. Dragging the row
  divider down 100px moved both rows together (316/316 → 416/216) and left the
  columns alone. Dragging the column divider **while grabbing it in the bottom
  row** moved the split in *both* rows (390/390 → 240/540), which is the cross
  doing what decision 1 asked for. 3 Columns and 2 Columns still lay out in a
  single row with no row divider at all. The dropdown lists exactly Single Pane
  / 2 Columns / 3 Columns / 2 × 2 Grid, and the native View menu and the status
  bar print the same four names.
- **Both directions of the persistence change were checked against a real
  database.** A dragged grid (0.308/0.692 columns, 0.658/0.342 rows) survived a
  quit and relaunch to the pixel. A hand-written *pre-M16* session — `paneSizes`
  and no `layout` — was written straight into SQLite: the two-column tab's 70/30
  came back as 546px and 234px of 780, and the four-column tab came back as an
  even 2 × 2, exactly as decision 11 requires.
- **Decision 13 is the one thing not verified end to end.** The hit-test was
  read rather than exercised: `document.elementFromPoint(x, y)` then
  `closest('[data-drop-path]')`, a genuine 2D test with no single-row
  assumption, and the four panes measured as four distinct rectangles with
  distinct Y ranges — the geometric precondition. But an actual Finder drag onto
  a bottom-row pane was **not** performed: Finder's file area does not expose
  its items to this accessibility session, so the drag could not be aimed. Worth
  doing by hand.
- **Note for whoever verifies next: a mouse drag *can* be synthesised, and it is
  the only way to exercise a divider in the packaged app.** Synthetic keystrokes
  still reach nothing but the document-level shortcut registry — a divider
  reports `focused=true` and then ignores the arrow key, exactly as M14's verify
  field ignored typing. A tiny Swift helper posting `CGEvent`s (`mouseMoved`,
  `leftMouseDown`, several `leftMouseDragged` steps, `leftMouseUp`) drives the
  resize perfectly, and stepping the drag matters: one jump does not produce the
  `mousemove` stream the handler listens for. Second trap, which cost the first
  round of verification: `open` on an already-running app only activates it, so
  the measurements were taken against a 46-minute-old build and faithfully
  reported the *old* segmented control. `pkill` first, or read the process start
  time.

### M17 — Asymmetric split layouts ✅ complete

Five more arrangements beside M16's four:

| Name | Shape | Panes |
| --- | --- | --- |
| **2 Rows** | one column, two rows | 2 |
| **Split Top** | two rows; the top divided into two columns | 3 |
| **Split Bottom** | two rows; the bottom divided into two columns | 3 |
| **Split Left** | two columns; the left divided into two rows | 3 |
| **Split Right** | two columns; the right divided into two rows | 3 |

**The good news first: M16's state model survives untouched.** Every one of the
five is still describable as `layout: { columns, rows }` — a set of column
fractions and a set of row fractions. Split Top is a 2 × 2 track grid where the
bottom pane spans both columns; Split Left is a 2 × 2 where the right pane spans
both rows. Nothing new has to be stored. What changes is the *shape* constant,
which stops being "how many columns by how many rows" and becomes "which cells
each pane occupies".

**Three M16 invariants do not survive, and it is worth being blunt about them.**

1. **`SplitMode = 1 | 2 | 3 | 4` is finished.** The numbers were pane counts
   wearing a mode's clothes, which worked only while every mode held a different
   number of panes. Four of these five hold three panes.
2. **"One mode per pane count" is dead**, along with `splitModeForPaneCount` and
   the test asserting the counts are unique. It was load-bearing in exactly one
   place — restoring a tab whose mode and panes disagree — which now needs a
   declared default per count instead of a search.
3. **"One full-length divider" is dead.** M16 decision 1 got a cross because
   every divider crossed the whole container. In Split Top the vertical divider
   exists only in the top row; in Split Left the horizontal one exists only in
   the left column. A divider becomes a *segment*.

**Numbered after M16, built before M12**, for the fourth time and the same
reason. It depends on M16 and on nothing else.

Decisions taken up front:

1. **A mode declares its cells; the track counts are derived.** `SPLIT_GRIDS`'
   `{columns, rows}` becomes `cells: { column, row, columnSpan?, rowSpan? }[]`,
   in reading order, and the number of tracks is the maximum extent of those
   cells. Declaring both would be two facts that can disagree; deriving means a
   new layout is one list. CSS Grid places them natively — `grid-column: 1 /
   span 2` — so nothing has to be measured or positioned by hand.
2. **A test proves every mode tiles its grid exactly.** No cell overlapping
   another, no track position left uncovered, and `cells.length` equal to the
   pane count. A malformed cell list is otherwise a pane rendered on top of
   another or a hole in the layout, and neither fails loudly. This is the guard
   that makes decision 1 safe to derive from.
3. **`SplitMode` becomes named string ids** — `'single'`, `'columns-2'`,
   `'columns-3'`, `'grid-2x2'`, `'rows-2'`, `'split-top'`, `'split-bottom'`,
   `'split-left'`, `'split-right'`. The ids say the layout rather than counting
   the panes, which is what lets four of them hold three panes without
   colliding.
4. **Dividers are derived from the cells, not declared.** For each boundary
   between adjacent tracks, a segment exists over exactly the stretch where the
   panes on either side differ; adjacent segments merge into one. Split Top's
   column boundary therefore covers the top row and stops, and M16's cross falls
   out of the same rule rather than being a special case — in a 2 × 2 the panes
   differ across the whole boundary, so the segment is the full line. A
   per-mode divider table would be a fourth thing to keep in step with the
   cells.
5. **Drag semantics do not change, and that is the payoff of keeping
   `{columns, rows}`.** A column divider always edits `columns`, a row divider
   always edits `rows`, however short the segment is. In Split Top, dragging the
   top row's divider changes `columns[0]` and the bottom pane — which spans both
   columns — simply does not care. `MIN_FRACTION` still applies per axis.
6. **The icons are drawn from the cells, not chosen from a set.** Nine layouts,
   four of them differing only in which quadrant is subdivided, is past what a
   glyph library can say clearly — and M16 exists *because* an icon promised a
   2 × 2 while the layout delivered four columns. A tiny SVG generated from the
   same `cells` the layout is built from cannot lie about the arrangement, and
   the four asymmetric ones become distinguishable at a glance rather than by
   reading. Lucide keeps every other icon in the app; the split control stops
   using it.
7. **The dropdown shows pictograms and no words at all.** Once the picture is
   generated from the layout itself (decision 6) it is a better description than
   any name — nine accurate diagrams are scanned in one glance, where nine text
   rows have to be read, and "Split Left" versus "Split Right" is exactly the
   pair a word does worst at. This is the toolbar speaking the toolbar's
   language.

   **Names still exist, because four other places are text and cannot show a
   picture:** the in-window and native View menus, the status bar's "layout /
   view" pair, the tooltip on hover, and the accessible name a screen reader
   reads out — a control whose only content is a drawing is unusable without
   one. So the names stay in `constants/splitModes.ts` exactly as before and
   simply stop being *rendered* on the control. **Revised during the build:**
   the toolbar button was to keep its label and does not — see decision 13.
   Naming them is therefore a much smaller decision than it was: Split Top /
   Split Bottom / Split Left / Split Right, after which part is subdivided,
   because nothing short says "two columns of which the left is split into two
   rows" and nobody has to recognise these at a glance any more.
8. **The View menu gets a "Split Layout" submenu.** Nine radio items inline,
   after five view modes, would make View the longest menu in the app by a wide
   margin. This is the first nested submenu in `backend/appmenu`, whose `item`
   struct is currently flat — a real change there, not just another row.
9. **Still no keyboard shortcuts for splits**, as since M2. Nine modes is nine
   bindings nobody would remember, and the four that existed were never bound
   either.
10. **A stored mode changes type, for the third time this field has moved.**
    M16 turned `paneSizes` into `layout`; this turns a numeric `splitMode` into
    a string. Reading maps the legacy numbers — `1 → 'single'`, `2 →
    'columns-2'`, `3 → 'columns-3'`, `4 → 'grid-2x2'` — and anything
    unrecognised falls back by pane count. Downgrading is worth stating plainly
    because it is worse than M16's: an M16 build reading `'split-top'` rejects
    it, falls back to three panes by count, finds `columns` has two entries
    where its grid wants three, and lands on an even 3 Columns. The panes and
    their paths survive; the arrangement does not. That is acceptable and it
    should be written down rather than discovered.
11. **One canonical mode per pane count, declared rather than searched.**
    `1 → single`, `2 → columns-2`, `3 → columns-3`, `4 → grid-2x2` — used when a
    restored tab's mode and pane count disagree, and when a legacy number is
    unreadable. Four modes hold three panes and only one of them can be the
    answer, so the choice is made once, in the open, instead of falling out of
    whichever `find` happens to hit first.
12. **Adding a pane still opens it at the active pane's location**, and
    removing still drops from the end. Unchanged from M2, but worth restating
    because the pane count no longer follows from the mode's name: going from
    Split Top to 2 Rows drops the third pane, and going the other way adds one.
13. **The dropdown becomes a 3 × 3 grid of tiles, not a list.** With the words
    gone (decision 7) a vertical list of nine icons would be a 324px column of
    mostly empty space. Laid out as a grid it is roughly 150px square, every
    option is visible without scanning downward, and the shapes sit next to each
    other where the differences between them are easiest to see — which is the
    arrangement Windows' snap layouts and every multiview picker converged on
    for the same reason.

    ~~**The toolbar button that opens it is unchanged**, keeping the
    icon-plus-label it has had since M16.~~ **Revised after seeing it run:** the
    button drops its label too, and both widths are pinned. "2 Columns", "Split
    Bottom" and "2 × 2 Grid" are three different widths, so a button that prints
    the current layout resizes itself every time the layout changes and shunts
    the breadcrumb beside it along — which is the sort of thing that only shows
    up once nine layouts exist to cycle through. With an icon and a chevron it is
    the same size whatever is selected, and the name moves to the tooltip, which
    it needs anyway now that nothing on the face of the control says it.

    **Selection on a tile is colour, with no border.** An outline is a second
    signal saying what the accent colour already says, and around a 44px
    pictogram it crowds the drawing it is meant to highlight.

Files: changes to `constants/splitModes.ts` (cells, derived tracks, derived
divider segments, the string ids, the canonical-mode table),
`components/toolbar/SplitLayoutIcon.tsx` (the generated pictogram),
`features/explorer/PaneGroup.tsx` (cell placement and segment dividers),
`components/toolbar/SplitMenu.tsx` (nine entries, generated icons),
`types/workspace.ts` (`SplitMode`), `stores/workspaceStore.ts`,
`services/db/repositories/session.ts` (the legacy number mapping),
`constants/menus.ts` and `backend/appmenu/appmenu.go` (five new command ids and
the first nested submenu), and `hooks/useMenuCommands.ts`.

**Done when:** the dropdown is a 3 × 3 grid of nine pictograms with no text in
it, each drawn from its own cell list, and the button that opens it shows a
pictogram and a chevron and no text either, at the same width whatever is
selected; a selected tile is marked by colour alone, with no outline; both View
menus and the status bar are untouched and still read as they do today; hovering
a tile or the button names it, and a screen reader announces that name; Split
Top shows two panes above one full-width pane and
Split Bottom the reverse; Split Left shows two stacked panes beside one
full-height pane and Split Right the reverse; the divider between the two top
panes in Split Top stops at the row boundary rather than crossing into the
bottom pane, and dragging it leaves the bottom pane's width alone; the row
divider in Split Left covers only the left column; every layout tiles its grid
with no gap or overlap; the View menu carries a Split Layout submenu naming the
same nine layouts the status bar names; a session saved in Split Right comes
back in Split Right with its dragged proportions; and a session written by an
M16 build still opens with its four layouts intact. ✅

Notes from the build:

- **All thirteen decisions held.** Decision 1 — declare cells, derive everything
  else — is what made the rest small: the track counts, the pane count, the
  dividers and the pictograms all fall out of one list per layout, so the five
  new arrangements are five entries and no new branches.
- **The state model needed no change at all**, which was the bet the plan opened
  with. `layout: { columns, rows }` describes every one of the nine; Split Top is
  a 2 × 2 of *tracks* whose bottom pane spans both columns. Nothing new is
  stored and the drag semantics are untouched.
- **`dividersOf` is the piece worth reading.** It walks each boundary asking
  whether the panes either side of it differ, and merges touching steps. M16's
  full-height cross and Split Top's stub come out of the same six lines — the
  cross is simply the case where they differ the whole way down. The alternative,
  a divider table per layout, would have been a second description of the same
  arrangement.
- **CSS Grid does the spanning for free**, but the spans have to be *explicit*.
  Leaving them to auto-placement puts the panes after a spanning cell in the
  wrong track, so every pane declares `grid-column: N / span M` from its own cell.
- **The tiling test earns its place.** An overlap draws one pane on top of
  another and a gap leaves a hole, and neither throws — so a malformed cell list
  would ship. It is the guard that makes deriving from `cells` safe rather than
  merely clever.
- **`splitMode` changing from number to string touched more than expected.** Not
  the production code, which was three files, but nine test files that had been
  writing `splitMode: 2` since M2. Worth noting for the next time an enum
  changes shape: the blast radius is in the fixtures.
- **The native menu grew its first nested submenu**, which meant `item` gaining
  an `Items` field, `CommandIDs` descending, and `New` becoming recursive. A new
  Go test pins it, because `CommandIDs` walks the *declaration* — a `build` that
  quietly flattened or dropped the submenu would leave nine layouts unreachable
  natively while every existing test kept passing.
- **Verified in the running app**, measured through the accessibility API. The
  picker is a real 3 × 3 of nine 45 × 45 tiles at three x-positions and three
  y-positions, with no text: the names exist only as accessible names, which is
  also what made them findable. In a 1060 × 632 pane area: **Split Top** put two
  530 × 316 panes over one **1060**-wide pane, with the column divider **316px
  tall** — stopping at the row boundary, against the 631px it spans in a 2 × 2 —
  and the row divider 1060 wide. **Split Bottom** was its mirror, its column
  divider *starting* at the row boundary. **Split Left** gave a 530 × **631**
  pane on the right and a row divider only **530** wide; **Split Right** the
  mirror, its row divider starting at x=861. **2 Rows** was two full-width panes
  and a single horizontal divider. Dragging Split Top's stub divider 120px moved
  A 530→650 and B 530→410 while the spanning pane stayed exactly 1060 wide,
  which is decision 5 in one measurement.
- **Persistence verified in both directions.** A dragged Split Top (0.295/0.705)
  survived a quit and relaunch to the pixel. A hand-written M16-era tab — numeric
  `splitMode: 4` with a two-axis layout — restored as the 2 × 2 grid keeping
  0.7/0.3 and 0.4/0.6 exactly (546/234 and 253/379), and a pre-M16 tab — numeric
  `2` with the flat `paneSizes: [0.8, 0.2]` — restored as 2 Columns at 848/212.
  Two shape changes, three formats, one read path.
- **Note for whoever verifies next, and this one cost real time: a surviving app
  instance will overwrite the session you just wrote.** `pkill` without checking,
  or a `Cmd+Q` that has not finished, leaves a process alive that saves its own
  state on the way out — so a round-trip test reads a database the zombie
  rewrote and the layout looks like it failed to restore. Twice this looked like
  a persistence bug; both times a unit test with the exact stored payload passed
  immediately, which is the quickest way to tell a real bug from this one.
  `pgrep` after killing, every time. This is M16's "`open` only activates a
  running app" trap with sharper teeth.

### M18 — Enhanced archiver ✅ complete

Browse archives as ordinary folders, extract more than twenty types, and create
them with a chosen format, optional volume splitting and an optional password.

**Numbered after M17, built before M12**, for the fifth time and the same
reason. It is the largest milestone since M8 and the only one that adds a
dependency the app does not already have.

**The constraint that shapes everything: extracting is broad, creating is
narrow.** Go's standard library covers `zip`, `tar`, `gzip`, `flate` and
`bzip2` — and `compress/bzip2` reads only. Everything else is a third-party
decoder, and for two of the formats people ask for most there is no encoder at
any price: **RAR compression is proprietary and cannot legally be implemented**,
and no maintained pure-Go library writes 7z. So this milestone extracts rar and
7z and does not create them. That is not a scoping choice made to save effort;
it is the state of the world, and the UI has to say so rather than offer a
format that fails at the end of a long job.

Decisions taken up front:

1. **Pure Go, no bundled binaries, no shelling out.** Bundling p7zip would buy
   7z creation, rar extraction and volume support in one dependency — and it
   would end the property `backend/db` calls out in its first comment: no cgo,
   so the build stays a plain `go build`. It would also add a GPL binary to
   sign and notarize (§3), and M10 already refused the same trade for
   thumbnails, where shelling out to `qlmanage` would have swapped a bounded
   cost for an unbounded process-spawning one. **This is the decision to
   overturn if 7z creation matters more than the single-binary build**; nothing
   else here depends on it.
2. **Format is detected from content, not from the extension.** M10 learned this
   the hard way twice — a text file named `.png`, and `image/jpg` not being a
   mime type. An archive named `.zip` that is really a rar must open, and a
   `.log` that is really a gzip stream should offer to. The extension is a hint
   that orders the sniffers, never the answer.
3. **Browsing extracts to a temp folder and navigates there.** The alternative —
   a virtual path scheme like `photos.zip!/holiday` — is more elegant and much
   more invasive: the watcher, thumbnails, preview, search, hashing, drag and
   drop, favorites and session restore all take paths, and every one of them
   would need to learn the scheme or fail. Extracting to a real folder means
   every completed milestone keeps working unchanged, because it *is* a real
   folder. The cost is honest and should be stated: opening a 4GB archive to
   look at one file inside it extracts 4GB first. If that bites, virtual paths
   are the thing to revisit.
4. **A mount is reference-counted, exactly as M7's watches are.** Each browsed
   archive gets one temp folder — a "mount" — with a count of how many panes are
   currently inside it. "The user leaves" means that count reaching zero, which
   covers navigating away, closing the tab and closing the pane without needing
   three rules. Two panes browsing the same archive share one extraction, and
   the release guard matters for the same reason it did in M7: React invokes
   cleanups twice under StrictMode, and a double decrement would delete a folder
   another pane is still showing.
5. **A mount is removed after a grace period, not immediately.** Back, forward
   and a mistaken double-click all drop the count to zero for a moment, and
   re-extracting a large archive because someone pressed Back would be the
   feature at its worst. Sixty seconds, and the mount is reclaimed instantly if
   the user returns.
6. **Mounts are read-only, and that is a data-loss decision rather than a
   stylistic one.** The sharpest way this feature can hurt someone is: open an
   archive, open a file from it in an editor, work for an hour, navigate away,
   and have the folder deleted underneath. Extracting with the write bits off
   makes that impossible instead of unlikely. It also tells the truth — a browse
   mount is a view of an archive, not a place to work. Changing something means
   Uncompress, which is permanent, or dragging it out, which copies.
7. **The mount path is random *and* legible.** `os.MkdirTemp` gives uniqueness
   and no collisions; a breadcrumb reading `/var/folders/xy/T/arc-8f3k2` gives
   nothing. The random component is a directory, and the archive's own name is
   the leaf inside it, so the breadcrumb reads `… / Photos.zip / holiday` and
   the path is still unique.
8. **Orphans are swept at startup, and everything is removed at quit.** A crash
   or a force-quit leaves mounts behind, and a temp folder that is never
   reclaimed is a disk leak measured in gigabytes. The sweep is by prefix inside
   the app's own temp root, so it can never touch anything it did not create.
9. **A pane restored inside a mount comes back at the archive instead.** The
   session outlives the temp folder by definition. Restoring a pane into a path
   that no longer exists would put it straight into M7's "this item no longer
   exists" state on every launch, which reads as the app being broken. This is
   the M13/M16/M17 persistence lesson a fourth time: what is persisted is
   untrusted, and the read path decides.
10. **Uncompress is a different command from browsing, and it keeps its output.**
    Right-click → Uncompress extracts beside the archive and nothing is
    reclaimed — that is the whole distinction the user asked for. It extracts
    into a folder named after the archive, *unless* the archive has exactly one
    top-level entry, in which case that entry goes in directly. Otherwise a
    two-hundred-file archive scatters two hundred files into Downloads, which is
    the "tarbomb" every modern tool learned to defend against.
11. **Entry paths are validated against escaping the destination, always.** An
    archive entry named `../../../.ssh/authorized_keys` is a known attack — "zip
    slip" — and it is the one place this feature can do harm outside the folder
    it was pointed at. Every entry is resolved and refused if it lands outside;
    absolute paths are refused; symlink entries pointing outside are refused.
    This applies to browse mounts and Uncompress alike, and it is tested with a
    hand-built malicious archive rather than assumed.
12. **Browse mounts are capped; Uncompress is not.** A 1MB archive can expand to
    terabytes, and browsing is something the user does by double-clicking rather
    than by deciding. A mount stops at a total size and an entry count and says
    why, offering Uncompress — which is an explicit decision, and so uncapped
    beyond the disk saying no.
13. **Extraction and compression are jobs, shaped like M8's search and M14's
    hashing:** `id`, streamed progress, real cancellation. A multi-gigabyte
    archive must not freeze the window, and closing the progress must actually
    stop the work rather than let it run on. Progress is bytes, not entries, for
    M14 decision 5's reason: an archive that is one enormous file would sit at
    0/1 otherwise.
14. **Creating offers formats, not a matrix.** zip, tar, and tar with each
    compressor the encoders cover — gzip, bzip2, xz, zstd, lz4, brotli — plus a
    level. What is *not* offered is any combination that cannot be produced:
    7z and rar are absent from the create list entirely rather than present and
    failing. The dialog says why, once, rather than leaving someone to discover
    it.
15. **Splitting is byte-splitting into `.001`, `.002`…, and the plan says so
    plainly.** Real multi-volume zip is a container feature `archive/zip` cannot
    write. Splitting the finished stream into parts is what 7-Zip does for its
    own format and what people mean by "split after 100MB" — with the honest
    consequence that a part is not independently openable and all of them are
    needed. Extraction reassembles automatically when handed a `.001`.
16. **A password means AES-256 in a zip, and nothing else.** WinZip AES is the
    one place in this format set where encryption is a real, interoperable
    answer. Offering a password on a `tar.gz` would mean inventing an envelope,
    and a file nobody else can open is worse than no encryption. Legacy
    ZipCrypto is not offered at all: it is broken well enough to be decorative,
    and offering it beside AES invites picking it for compatibility.
17. **The dialog says that an encrypted zip still shows its filenames.** WinZip
    AES encrypts entry contents, not the central directory, so anyone with the
    file can read the list of what is in it. People are routinely surprised by
    this, and a checksum tool that lets someone believe CRC32 proves
    authenticity was the same mistake M14 decision 11 refused to make.
18. **Extracting something encrypted asks through the existing dialog stack.**
    Unlike M14's modal and M15's, this *is* a one-shot question with a promise
    waiting on the answer, which is exactly what `askConfirm` and `DialogRequest`
    already are. It needs a password variant, not a new `uiStore` field. A wrong
    password is reported and asked again rather than failing the job.
19. **Double-clicking a single-stream file browses it too.** A `.gz` holds one
    file, so its mount is a folder with one thing in it. That is what every
    archive tool does, and it means `report.csv.gz` opens to `report.csv`
    without a special case.
20. **Nested archives work for free, and that is the payoff of decision 3.** An
    archive inside a mount is a real file in a real folder, so double-clicking it
    mounts it in turn. Search, thumbnails, preview and hashing inside a mount
    work for the same reason — none of them can tell.

**Formats.** Extract: zip (stored/deflate/zstd/bzip2, ZipCrypto and AES), 7z
(including AES), rar and rar5, tar, gz, bz2, xz, lzma, lz4, zstd, brotli,
snappy, Unix `compress`, every `tar.*` combination of those, and the zip-derived
types by content — jar, war, apk, ipa, cbz, epub — plus cbr as rar. That is
comfortably past twenty recognised types over about ten engines. Create: zip
(deflate/store, optional AES-256, optional splitting), tar, and tar with gzip,
bzip2, xz, zstd, lz4 or brotli.

**Dependencies to add**, all pure Go, and each one is a decision to confirm at
build time rather than to trust from this document: `klauspost/compress` (zstd,
flate, a faster gzip), `ulikunitz/xz` (xz, lzma), `pierrec/lz4`,
`dsnet/compress` (bzip2 *writing*, which the standard library does not do),
`bodgit/sevenzip` (7z reading), `nwaples/rardecode` (rar; **confirm RAR5 before
promising it**), and an AES-zip implementation. `mholt/archives` unifies most of
these behind one interface and is worth evaluating first — one dependency that
is already doing this composition beats seven that we compose ourselves.

Files: `backend/archive/{archive.go,detect.go,extract.go,create.go,mount.go}`
and their tests; `services/archives/{archiveService,mountRegistry}.ts`;
`hooks/useArchive.ts`; `features/archives/{CompressDialog,ExtractProgress,PasswordPrompt}.tsx`;
`constants/archiveFormats.ts`. Additions to `services/bridge/types.ts`
(`ArchiveApi`) with both implementations, `stores/uiStore.ts` (the password
dialog variant), `constants/{menus,contextMenus,shortcuts}.ts`,
`backend/appmenu/appmenu.go`, `hooks/useMenuCommands.ts`,
`services/db/repositories/session.ts` (decision 9) and `main.go`.

**Done when:** double-clicking a zip opens it like a folder, with the breadcrumb
naming the archive; the files inside preview, thumbnail, search and hash exactly
as ordinary ones do because they are; navigating away removes the extraction
after its grace period, and returning within it is instant; a mount cannot be
written to; right-click → Uncompress puts the contents beside the archive and
leaves them there; a rar and a 7z both browse and extract; an archive with a
`../` entry is refused with the reason; an encrypted zip asks for its password
and asks again when it is wrong; compressing a folder to `tar.zst` and to an
AES-256 zip both round-trip through `7z`/`unzip` on the command line; splitting
at 10MB produces `.001`, `.002`… that this app reassembles; and 7z and rar are
absent from the create list with the reason shown rather than failing late. ✅
(all but a real RAR file and four UI paths — see the notes)

Notes from the build:

- **All twenty decisions held.** Decision 3 paid for itself immediately: because a
  mount is a real folder, preview, thumbnails, search, hashing and drag-out work
  inside an archive with no code at all — none of them can tell.
- **Seven pure-Go dependencies, and one is only there for writing.** The standard
  library reads bzip2 and cannot write it, which is the whole reason
  `dsnet/compress` is in `go.mod`. Reading stays on the stdlib, which is faster
  and needs nothing.
- **Detection was verified against thirteen real archives before anything was
  built on it**, made with `zip`, `tar`, `gzip`, `bzip2`, `xz`, `zstd`, `lz4`,
  `brotli` and `py7zr`. It separates `notes.txt.gz` — one file — from
  `photos.tar.gz` — a folder — by decompressing the first block and looking for
  the tar magic, which is the distinction that decides what a mount looks like. A
  7z named `.zip` opens as a 7z.
- **Everything created was opened by the real tools**, which is the test that
  matters: `unzip -t`, `tar tzf`, and `xz`/`bzip2`/`lz4`/`brotli`/`zstd` piped
  into `tar` all accept what this writes, and split parts `cat`'d back together
  open as a normal `tar.gz`.
- **AES-256 zips were verified with `pyzipper`, not with `unzip`** — and that
  turned up a correction to decision 16. macOS's Info-ZIP `unzip` and Archive
  Utility do **not** support WinZip AES, so "opens everywhere" is too strong: it
  opens in 7-Zip, Keka, WinRAR, The Unarchiver and anything using a modern zip
  library, and not in the two tools that ship with macOS. Worth saying in the UI
  if this ever bites. The same check confirmed decision 17 is factually right:
  the file names are readable with no password at all.
- **Six real bugs, all of them found by tests or by running the app.** In the
  order they were caught:

  1. **`safeJoin` sanitised instead of refusing.** Anchoring at `/` and cleaning
     turns `../escape` into `root/escape` — inside the destination, and so
     "safe" — but it silently rewrites an entry that had no business existing.
     Now any `..` element refuses the whole archive, which is what decision 11
     said and not what the first implementation did.
  2. **A failed compress deleted a pre-existing file.** `O_EXCL` correctly
     refused to overwrite, and the cleanup then removed the file it had just
     protected. Cleanup now removes only the parts the job actually created.
     This is the one that could have cost someone real data.
  3. **The split path reported a filename that never exists.** The base name is
     never written when splitting, and a `defer` assigning to a local cannot
     change an unnamed return value, so `Done.Path` pointed at nothing.
  4. **`sevenzip.ReadError` is returned as a pointer.** Matching the value type
     compiles, never matches, and reported every wrong 7z password as a raw
     lzma2 decoder error. A 7z fails at *read* time rather than at open, so the
     library's own `Encrypted` hint is the only honest discriminator.
  5. **The mount registry double-counted.** Registering an extraction took a
     reference *and* the pane's effect took one, so leaving could never reach
     zero and every mount survived until quit. Registering now holds nothing and
     starts the reclaim clock, which also cleans up an extraction the user never
     reached.
  6. **Found by running the app: `tree.tar.gz` uncompressed into a folder called
     `tree.tar`.** `utils/path.stem` strips one extension, which is right for
     `notes.txt` and wrong for every `tar.*`. The frontend now has the same
     compound-suffix list the backend does.

- **Verified in the running app against real archives.** A zip made by
  `/usr/bin/zip` and a `tar.gz` made by `/usr/bin/tar` both opened on
  double-click and listed their contents like folders, with the breadcrumb
  reading `… / file-base-mount-4175574054 / tree.tar.gz` — random directory,
  archive name as the leaf, exactly decision 7. The extracted tree was
  `dr-xr-xr-x` and `-r--r--r--`, and **the OS refused both an edit and a new file
  inside it**, which is decision 6 being true rather than intended. The native
  File menu carries Compress… and Uncompress.
- **What was not verified in the packaged app, and should be by hand.** Four
  things, all covered by tests but not driven end-to-end in the built binary: the
  password prompt appearing (the backend's refusal of a real `zip -P` archive
  *was* checked directly — no password, wrong password and right password all
  behave), the compress dialog, an Uncompress run from the context menu, and the
  60-second reclaim. Driving them needs double-clicks and menu hits aimed at
  listing rows, and row coordinates shift after every navigation, so several
  attempts landed on the wrong row. Green tests are the midpoint of a milestone,
  not the end — these four are the part of the ritual M18 still owes.
- **RAR was the honest gap, and is now closed.** Nobody can create a rar — the
  compressor is proprietary — so there is no fixture that can live in the repo,
  and M18 shipped with `nwaples/rardecode/v2`'s RAR5 claim untested.

  **Verified since, against a real 100 MB rar found on the machine**, which is
  what that note asked for: `Detect` reports `rar` from the content, and the
  extraction produced 30 files and **100,266,078 bytes with none empty** — the
  byte count matters, because a decoder emitting the right tree of empty files
  passes every check that only looks at names. `TestRealRarExtracts` in
  `backend/archive/realrar_manual_test.go` is that check, kept rather than
  thrown away: it skips unless `FILEBASE_RAR_FIXTURE` names an archive, so
  `go test ./...` is unaffected and anyone with a rar can re-run it in one
  command. **Creation is still impossible and always will be** — that half of
  the gap is the state of the world, not a to-do.
- **Note for whoever verifies next: a synthetic double-click needs a shared
  `CGEventSource`.** Posting two down/up pairs with `mouseEventClickState` 1 then
  2 is not enough on its own — with `nil` sources WebKit sees two unrelated
  single clicks and nothing opens, which looks exactly like a broken feature. One
  `CGEventSource(stateID: .hidSystemState)` for all four events fixes it. And row
  coordinates must be re-read immediately before every click, in the same
  process: an AX walk takes seconds, and anything that navigates in between
  invalidates them.

### M19 — Rearrangeable, resizable detail columns ✅ complete

Name, Size, Type and Modified become a layout the user owns: drag a header to
reorder, drag the rule between two headers to resize, and have both survive a
relaunch.

**Numbered after M18, built before M12**, for the sixth time and the same
reason. It is a small milestone with one genuinely load-bearing constraint: the
header row and every body row are two separate grids that must agree, and today
they agree because they share one hard-coded constant.

Where it stands now, in `components/explorer/DetailsView.tsx`:

```ts
const COLUMNS = 'grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]'
const HEADERS = [{ key: 'name', … }, { key: 'size', … }, { key: 'type', … }, { key: 'modified', … }]
```

The header maps `HEADERS`; `Row` renders four cells in fixed JSX order. Both use
`COLUMNS`. Nothing else in the app draws a column — search results render through
the same pane, so this is the only surface to change.

Decisions taken up front:

1. **The columns become data**, in `constants/columns.ts`, the shape
   `splitModes`, `hashAlgorithms`, `themes` and `archiveFormats` all already
   have: id, label, the `SortKey` it sorts by, a default weight, a minimum
   weight, and alignment. The *cells* stay in `DetailsView` as a
   `Record<ColumnId, (item: FileItem) => ReactNode>` — a registry that imports
   React to hold renderers would stop being data — and a test asserts the map
   covers the registry, because a column with no renderer draws a blank strip
   rather than failing.
2. **Widths are fractions, not pixels**, exactly as §M16 stores pane sizes.
   A pane in a 2 × 2 grid is a quarter of the window wide; stored pixels would
   overflow it, and a window resize would leave every column stranded at a stale
   width — which is the bug §M16 decision 4 already fixed once for panes. The
   grid template is `minmax(0, Nfr)` per column, which is the shape it has today
   with the numbers coming from state instead of a string constant.
3. **Resizing reuses `useSplitResize`, parameterised rather than copied.** It
   already turns a drag into fractions redistributed between two neighbours with
   a floor, keeps listening on `window` so the pointer can outrun the handle, and
   ships a keyboard `nudge`. It needs one new option — `minFraction`, because
   0.12 is a sane floor for a pane and a fat one for Size — and gains a second
   caller, which is the argument §M16 decision 4 made for not writing
   `useSplitResizeVertical`.
4. **No horizontal scrolling: the columns always tile the pane exactly.** The
   alternative is pixel widths that can exceed the pane, which means a
   horizontally scrolling body and a header that must scroll with it — and the
   header is deliberately *outside* the scroll container so it cannot scroll away
   vertically. Fractions plus a floor make overflow impossible, so the two grids
   can stay siblings.
5. **Reordering is pointer-driven, not HTML5 drag and drop.** The app runs a
   global HTML5 drag pipeline for files — `useFileDrag`, `dragStore`, and
   `OnFileDrop` for Finder — and a `dragstart` on a header would enter it: every
   folder row would light up as a drop target for a column. Pointer events keep
   the two apart, and give decision 6 the threshold it needs.
6. **A header press stays a sort until the pointer moves 4px.** The header is
   already the sort button, and a click that wandered two pixels must still sort.
   Past the threshold the press becomes a reorder and the mouseup no longer
   sorts.
7. **Name moves like the rest.** Finder pins it; the request did not, and there
   is no technical reason to — the icon, the alias badge and the inline rename
   editor travel with the cell, not with the position.
8. **Cells render in layout order, not fixed order.** `Row` maps the same
   ordered array the header does, so the DOM order a screen reader announces is
   the order on screen. The cheaper trick — fixed DOM order with CSS
   `grid-column` placement — would leave the two disagreeing the moment anything
   is moved.
9. **`Row` keeps its memoisation.** It gains one prop: the ordered column array,
   held in the store as a stable reference and re-created only when the layout
   changes. The template string is computed once per render in the parent and
   applied to both grids. Scrolling must not become a re-render of every row —
   `Row` is hand-memoised precisely because the compiler skips this file.
10. **The layout is global, not per folder.** `viewMode` and `sort` are
    per-folder because they are about the *contents*; how wide Size is is about
    how the user reads a table, and finding Downloads laid out differently from
    Documents would read as a bug. One JSON row in `settings`, like
    `hashAlgorithm` — **no migration**, because `settings` is a key-value table.
11. **The stored layout is validated on the way out**, the M13 / M14 / M18
    lesson for the fourth time. A row written by a later build can name a fifth
    column, omit one this build has, or carry weights that no longer sum to 1.
    Reading it drops unknown ids, appends missing ones in registry order,
    renormalises the weights and lifts anything under its floor. The failure it
    prevents is not cosmetic: a layout with an empty column list renders a table
    with no columns at all.
12. **Keyboard and menu parity, or it is a mouse-only feature.** Right-click a
    header for Move Left / Move Right / Reset Columns, and Shift+←/→ on a focused
    header nudges its width through the same `nudge` the split dividers use.
    **Reset Columns earns its place on its own**: a column dragged to its floor
    is hard to grab again, and without a reset the only way back is deleting a
    database row.
13. **Non-goal, but enabled: hiding columns and adding new ones.** `FileItem`
    already carries `createdAt`, so Date Created is a registry entry away — and
    that is exactly why the registry is shaped this way. This milestone ships the
    four columns named, reorderable and resizable, and nothing else.

What it touches:

- `constants/columns.ts` — new. The registry, the default layout, `isColumnId`,
  and the two pure functions worth testing on their own: `normaliseLayout`
  (decision 11) and `moveColumn`.
- `stores/uiStore.ts` — `columnLayout: { order: ColumnId[]; weights: number[] }`
  plus `setColumnLayout` / `resetColumns`. Plain data, as everything there is.
- `services/db/repositories/settings.ts` + `persistence.ts` — one more key,
  hydrated and persisted through the subscription that already exists.
- `hooks/useSplitResize.ts` — the `minFraction` option.
- `components/explorer/DetailsView.tsx` — the template computed from state, a
  data-driven header with rules between the columns, cells mapped in layout
  order, and the pointer-drag reorder with its insertion indicator.
- `constants/contextMenus.ts` + `useMenuCommands` — the header context menu, so
  the three commands go through the one implementation every other command does.

Tests to write:

- **Pure, in `columns.test.ts`:** `moveColumn` for every from/to pair including
  the no-ops; `normaliseLayout` against a layout with an unknown id, a missing
  id, weights that sum to 0.6, and a weight below the floor; the invariant that
  the weights always sum to 1 after any resize.
- **Component, in `DetailsView.test.tsx`:** a 2px press sorts and does not
  reorder; a 40px drag reorders and does not sort; the header order and the cell
  order match after a move; a divider drag changes the template and leaves the
  sum at 1; the renderer map covers the registry.
- **Persistence:** a layout survives a simulated relaunch, and a hand-written bad
  row comes back as a sane default rather than an empty header.

Risks this adds to §3:

| Risk | Mitigation |
| --- | --- |
| **Header and body grids drifting** — two grids that must agree, and today they agree only because one constant is shared | One template computed per render and applied to both; a test asserts the header's column count and a row's cell count are equal (§M19 decision 4) |
| **A reorder drag entering the file drag pipeline** — every folder lighting up as a drop target for a column | Pointer events in the header, never `dragstart`, so the two systems never meet (§M19 decision 5) |
| **A column dragged to nothing**, then impossible to grab again | A per-column floor, plus Reset Columns in the header menu — otherwise the way back is a database edit (§M19 decisions 3, 12) |
| **A stored layout from a later build** — a fifth column, or weights that no longer sum to 1 | Validated on read: unknown ids dropped, missing appended, weights renormalised; an empty column list would render a table with no columns (§M19 decision 11) |

#### What was built, and what changed on contact

Three decisions were revised while building, all in the same direction — less
machinery:

- **Decision 12 lost its header context menu.** The plan wanted Move Left /
  Move Right / Reset Columns on a right-clicked header, routed through
  `useMenuCommands` like every other command. But that pipeline resolves labels
  and handlers from `APP_MENUS`, and Move Left has no meaning in an app menu:
  the column it acts on is the one under the pointer, and the menu bar has no
  pointer. Reordering and resizing are the focused header's own keyboard
  business — Alt+←/→ moves, Shift+←/→ resizes, exactly the seam
  `constants/shortcuts.ts` rule 1 already draws around `useListKeyboard`. Only
  **Reset Columns** became a command, because it is the one with no target, and
  it sits in View and in the native menu with the rest.
- **The drop index reads plain containment, not midpoints.** The first version
  moved a column once the pointer passed the midpoint of a neighbour, which also
  meant a press in the right half of a column's *own* span read as "move me one
  right": pressing Name and twitching 5px relocated it. Requiring the pointer to
  actually be over another column makes a small drag the no-op it looks like.
- **The resize rule is not `role="separator"`.** It was, briefly, and
  `getAllByRole('separator')` in the split-layout tests then counted **fourteen**
  dividers in a 2 × 2 split instead of two. The right fix was not to scope the
  query: the pane dividers are focusable splitters carrying `aria-valuenow`,
  while this is a mouse affordance for something the keyboard reaches through the
  header. It is `aria-hidden` now, and four unrelated tests going red is what
  said so.

One decision got *stronger* than planned: the cells are a
`Record<ColumnId, ReactNode>`, so adding a column to the registry fails to
compile until it can be drawn. The runtime "the renderer map covers the
registry" test the plan called for would have been strictly weaker, so it was
not written.

- **Verified in the running app, with a real pointer.** Not the packaged binary
  this time: `wails dev` serves the same frontend against the same Go backend at
  `localhost:34115`, which is a real browser and therefore a real drag — the
  macOS window's WebKit tree is not reachable from AX without enabling
  `AXManualAccessibility`, and a synthetic CGEvent drag would have been the M18
  double-click problem again. Against the user's own `/Volumes/Ddrive`:
  **Modified dragged onto Name** put Modified first and **took its dates with
  it**, while the sort arrow stayed on Name — decisions 6 and 8, visible in one
  screenshot. **Type dragged from last to first** while the sort stayed on Size.
  A **resize** grew Name to 636px with the header and the first row reporting
  the identical computed `grid-template-columns` — decision 4's invariant, read
  off the live DOM rather than asserted. The floor held exactly: dragging past it
  parked Modified at **0.08**, its `minWeight`, and the row persisted to SQLite
  as `{"order":["type","name","modified","size"], …}`. **Reset Columns** from
  the in-window menu put all four back; run from the *native* menu against the
  packaged build it did the same, and was correctly **greyed out** when the
  layout was already default.
- **A stale coordinate is what a drag bug looks like.** Two of the attempts
  above grabbed a header when they meant to grab a resize rule, because the
  handle had moved since the coordinates were read — the same lesson §M18 wrote
  down about row coordinates going stale between an AX walk and a click. Re-read
  the rects immediately before every drag; a reorder that "fired instead of a
  resize" is far more likely to be a 7px error than a broken threshold.

### M12 — Polish, testing, packaging
Animations and reduced-motion support; light theme; empty/loading/error states;
perf pass on a 10k-file directory; Vitest coverage of services, stores and hooks
against the mock bridge; Playwright e2e in the browser against the mock bridge;
`wails build` + code-signing/notarization notes.

**Started at last, after five deferrals.** Taken in slices rather than as one
pass, because the milestone is a list of unrelated jobs and nothing here depends
on anything else here.

#### Theme toggle ✅ done

A light theme has existed in CSS since M0 and no code could reach it: `theme.css`
said "the settings store writes that attribute" and no settings store was ever
written. `AppSettings.theme` was declared, defaulted and persisted, and nothing
read it.

Decisions taken:

1. **Three values, not a boolean.** `system`, `light`, `dark`. "Follow the OS"
   is a preference in its own right, and resolving it once at startup would
   freeze whichever appearance the user happened to launch in — a window that
   does not come with them at sunset.
2. **`system` is resolved in TypeScript, not in CSS.** `services/theme` maps the
   preference to `light` or `dark` and writes `data-theme`, which is the only
   place that attribute is ever set. This deletes the `prefers-color-scheme`
   block, and that block was **a live bug rather than a redundancy**: it was a
   hand-copied subset of the light palette that had already drifted, declaring no
   `--ft-*` file-type colour and no `--danger`/`--success`/`--info`. A system
   -light window therefore drew dark-theme icon colours on a light background.
   One palette, one declaration.
3. **The store holds the preference; the service owns the DOM.** `uiStore.theme`
   stays plain data, as every other field there is, and a subscription applies
   it. The menu needs the preference and not the resolved theme anyway — on
   `system` in a dark OS the checkmark belongs on Match System, not on Dark.
4. **A submenu in View, beside Split Layout**, in both the in-window menu bar and
   the native macOS one. Three checkable rows flattened into View would read as
   three independent switches rather than one choice. No accelerator: it is a
   three-way pick, not a toggle, and §M11's rule stands — a binding nobody would
   guess is clutter in a menu.
5. **The persisted value is validated on the way out**, as M13 and M14 both
   learned to do. An unrecognised theme from a later build would reach
   `data-theme` and match no palette at all — a window with no colours, which is
   worse than the wrong ones.
6. **The default stays `dark`, not `system`.** `BackgroundColour` in `main.go` is
   decided before the frontend exists, and it is dark.

- **Verified in the running app**, against the packaged build rather than the
  dev server: the native View → Theme submenu carries all three rows, and
  clicking each one drove the whole chain — native menu → `menu:command` →
  `useMenuCommands` → store → SQLite — with the `settings` row reading
  `"light"`, `"system"` and `"dark"` in turn.
- **Found while testing: a submenu row cannot be clicked with `userEvent`.**
  Moving the pointer from the parent row into its flyout is dispatched as a
  `mouseout` with a null `relatedTarget`, so React synthesises a mouseleave on
  the wrapper that owns the open state and the flyout closes before the click
  lands. A real pointer names the element being entered, and the flyout is a DOM
  descendant, so nothing leaves. The menu-bar test uses `fireEvent` for that one
  click and says why. Worth knowing before the next nested menu is tested — this
  was the first test ever to drive one, which is why §M17 never hit it.

**Still owed by this slice, and only checkable by eye:** whether the light
palette actually reads well. macOS window chrome is not themed with it — the
window is created `NSAppearanceNameDarkAqua` with `WindowIsTranslucent`, and
Wails v2 has no runtime appearance API — so scrollbars and the translucent
title-bar strip stay dark under a light window until something is done about it.
The launch flash has the same root: the preference lives in SQLite, which cannot
be read synchronously, so the first frame is dark whatever is stored. Go could
read that one row itself at startup and set `BackgroundColour` from it, which is
the cheapest fix if it grates.

#### Menu dismissal ✅ fixed

Reported as "clicking outside an open menu should close it", and it was half
true: the dismiss handler asked whether the press landed inside the menu bar's
**container**, which is the full width of the window plus the 50px strip the
traffic lights float in. A press on the file list closed the menu; a press on
the empty stretch to the right of *Go*, or on the title bar above it, counted as
inside and left the menu hanging open.

It now asks about the open panel and the titles instead —
`closest('[role="menu"], [data-menubar-item]')` — so the only two things that
keep a menu open are the menu itself, flyouts included, and the row of titles,
whose own click already toggles. Three cases are pinned by tests that **fail
against the old handler**: the empty menu bar, the drag strip, and the file list
(which already worked and must keep working).

The context menus never had this: they test containment against the panel, which
is what the menu bar now does too.

#### Release pipeline ✅ done

`.github/workflows/release.yml`: push a `v*` tag, get a **draft** release with a
universal zip attached. The M12 line item was "`wails build` +
code-signing/notarization notes"; the notes are
[docs/RELEASING.md](docs/RELEASING.md).

1. **The tag is the version.** It is stamped into `wails.json`'s
   `info.productVersion` before the build, which is what `CFBundleVersion` and
   `CFBundleShortVersionString` come from — so Get Info cannot disagree with the
   release the download came from. Setting it by hand is the mistake this
   prevents.
2. **The full suite runs before the build**, not after: typecheck, lint, ~640
   frontend tests, `go vet`, `go test ./backend/...`. A red build cannot become
   a release.
3. **Nothing is signed, and the machinery for it was removed rather than left
   dormant.** It was first written the other way — four steps gated on
   `if: env.MACOS_… != ''`, inert until six secrets appeared — which is the right
   shape when signing is coming. It is not: signing needs an Apple Developer
   membership this project does not have and does not plan to buy, so the steps
   were dead code pretending to be a feature. They are recorded in
   `docs/RELEASING.md` and recoverable from history instead.

   Two things learned there are worth keeping even though the code is gone.
   **`secrets` is not an allowed context in a step's `if`** — only `env` is, so
   a gate written `if: ${{ secrets.FOO != '' }}` silently never runs. And
   **signing is not an App Store thing**: *Developer ID Application* exists
   specifically to distribute outside it, and notarization is a malware scan
   that returns a ticket, not a review. "We are not going on the App Store" is
   not a reason to skip it; not having an account is.
4. **The release is a draft.** Nothing is public until it is read.
5. **Packaged with `ditto`, not `zip`.** A `.app` is a tree of symlinks and
   permission bits and `zip` flattens both; `--keepParent` keeps the bundle as
   the top-level entry so it unzips as an app rather than as loose `Contents/`.
6. **A `.dmg` is the headline download, with the `.zip` beside it.** A `.app` is
   a directory, so it cannot be a release asset on its own — something has to
   wrap it, and the disk image is the wrapper that carries the install gesture:
   it mounts to a window holding the app and an `/Applications` symlink to drag
   it onto. Built with plain `hdiutil` rather than `create-dmg`, which adds a
   dependency and a Finder-scripted window layout — the part that goes flaky
   headless. The trade is a plain window rather than a designed one. It is built
   **after** notarization so the app inside carries its stapled ticket, and
   signed itself when a certificate exists, because a signed app inside an
   unsigned image still warns on the image.

**What actually gates a download is not the format.** Two things do, and both
sit outside the workflow: a **private repository** has no public assets however
the release is configured, and a **draft** release is invisible to anyone
without write access. The draft step is deliberate — a tag builds it, a human
publishes it.

- **Verified locally rather than by burning a tag**: `wails build -platform
  darwin/universal -clean` succeeds in 27s and `lipo -archs` reports
  `x86_64 arm64`; the `ditto` round trip produces a 15MB zip that unzips back to
  a valid bundle. The jq stamp was run against a copy of `wails.json`.
- **The first run failed, and the reason is worth keeping.** `go vet ./...`
  covers the root package, which carries `//go:embed all:frontend/dist` — and
  `frontend/dist` is gitignored, so a fresh checkout has none:
  `pattern all:frontend/dist: no matching files found`. It passed every local
  check because a previous `wails build` had always left a `dist` behind, which
  is the shape of a whole class of CI failure: **the local tree is never the
  checkout**. The fix is one line of ordering — build the frontend before any Go
  command — and the verification was to `git clone` the repo to a temp directory
  and run the entire sequence there, which is the only way to see what the runner
  sees. That clone now goes lint → tests → frontend build → vet → go test → jq
  stamp → universal build, ending in a bundle reporting
  `CFBundleShortVersionString 0.1.0` and `x86_64 arm64`.
- **The unsigned state was measured, not assumed**: `codesign -dv` reports
  `flags=0x2(adhoc)` and `spctl -a -vv -t exec` reports **`rejected`**. That is
  exactly what a downloader hits — macOS phrases it as "damaged", which is a lie
  about a real problem — so it is written into the README and the release notes
  instead of being discovered by the first person who downloads it.

#### Remaining in M12

Animations and reduced-motion (a `prefers-reduced-motion` block exists in
`global.css`; nothing else has been audited), empty/loading/error states, the
10k-file perf pass, the coverage sweep, and Playwright — not started, and the
largest single piece left.

Notarization itself is no longer a code question but a money one: the pipeline
is written and skips itself until an Apple Developer membership and six secrets
exist (§3 has said "deferred to M12" since M0; it is now "deferred to a
subscription").

### M20 — Paste into the folder under the cursor ✅ complete

Paste stops meaning only "into the folder on screen". A **selected** folder is a
destination in its own right, so the clipboard can be dropped into a subfolder
without opening it and navigating back out.

The problem this had to solve first is that the details view has no background
to click. Rows span the full pane width, so once anything is highlighted there
is nowhere to press that means "never mind the row, I mean *this* folder" — the
icon grids get that for free from the gaps between tiles.

Decisions:

1. **The destination follows the selection, not the pointer.** Exactly one
   folder selected → that folder. A file, several items, or nothing → the folder
   on screen, which is how paste behaved through M6. Reading the pointer instead
   would make Cmd+V depend on where the mouse happened to be resting, and the
   keyboard route has no pointer at all.
2. **A 10px gutter down the left edge of the details list is the "background".**
   `DetailsView` draws it last inside the virtualizer's sizing box, so it paints
   over the rows' 12px left padding — never over an icon or a name — and spans
   the scrolled height rather than the viewport. It carries **no handlers**:
   being the event target is the entire job, because the container's existing
   mousedown and contextmenu then find no `[data-file-row]` under the pointer and
   already treat that as background. A press in it clears the selection; a
   right-click in it raises the background menu. Drag-and-drop inherits the same
   answer for free — `useDropZone` hit-tests `data-drop-path` the same way — so
   hovering the gutter targets the open folder, which is the consistent reading.
3. **Paste joins the folder context menu**, next to Cut and Copy. A right-click
   selects what it points at, so that row *is* "paste inside this folder". It is
   the discoverable route; the gutter is what makes the keyboard route
   controllable.
4. **A folder cannot receive itself.** `pasteTarget` falls back to the open
   folder when any clipboard path is an ancestor of the destination (`isAncestor`
   already existed for the same guard in drag-and-drop), so cut-a-folder-then-
   paste is a no-op rather than an error surfaced from Go.

- **Verified in the running app**, not only under Vitest: copy `Resume.pdf`,
  single-click `Work`, Cmd+V → the file lands in `Documents/Work` with the pane
  still showing Documents; click the gutter over that same row → the highlight
  drops and Cmd+V produces `Resume copy.pdf` beside the original; right-clicking
  the gutter over a row opens New Folder / Paste / Select All rather than the
  folder menu. Five tests cover the same paths in `fileOperations.test.tsx` and
  `menus.test.tsx`.

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
| **Photos view on a large folder** — full-size decodes per step, thousands of filmstrip thumbs | 512px cached thumbnail as the stage image with the original swapped in behind it, horizontally virtualized filmstrip, ±1 prefetch (§M13) |
| **Hashing multi-gigabyte files** — a modal that appears frozen, work that outlives the window | Streamed with a fixed buffer, byte-level progress, real cancellation on close, bounded worker pool (§M14) |
| **A stale digest presented as fact** | Session-scoped cache only, keyed on path + size + mtime; nothing persisted across runs (§M14 decision 4) |
| **Writing content could overwrite a file** — M15 is the first feature that puts bytes on disk | No write API is added at all: `CreateFile` keeps `O_EXCL`, so it creates or fails and can never truncate an existing file (§M15 decision 3) |
| **A hand-maintained templates folder** — huge, binary or unreadable files | Read through `readTextFile`'s existing cap; a bad template is listed with its reason and never stops the dialog opening (§M15 decision 14) |
| **A persisted layout changing shape**, not just value — M16 replaces `paneSizes` with a grid | Old sizes are lifted on read, a missing field already falls back to even, and both directions get a regression test (§M16 decision 11) |
| **`splitMode` changing type** — M17 turns the stored number into a string, the third move for one field | Legacy numbers are mapped on read; a downgrade loses the *arrangement* but keeps the panes and their paths, which is stated rather than discovered (§M17 decision 10) |
| **A malformed cell list** — a pane drawn over another, or a hole in the layout | Neither fails loudly, so a test proves every mode tiles its grid exactly: no overlap, no gap, one cell per pane (§M17 decision 2) |
| **Zip slip** — an archive entry named `../../.ssh/authorized_keys` writing outside the destination | Every entry resolved and refused if it lands outside; absolute paths and escaping symlinks refused; tested with a hand-built malicious archive (§M18 decision 11) |
| **Zip bombs** — 1MB expanding to terabytes, reached by a double-click rather than a decision | Browse mounts capped on total size and entry count and say why; Uncompress is the explicit decision and stays uncapped (§M18 decision 12) |
| **Deleting a mount with the user's work inside it** | Mounts are extracted read-only, so nothing can be edited in place to be lost; changing something means Uncompress or dragging out (§M18 decision 6) |
| **Temp folders leaking after a crash** | Swept by prefix inside the app's own temp root at startup, and removed at quit (§M18 decision 8) |
| **RAR and 7z cannot be created** — proprietary, and no pure-Go encoder | Absent from the create list with the reason shown, rather than offered and failing at the end of a long job (§M18 decision 14) |
| **Notarization** for distribution | Deferred to M12; not blocking for local development |

---

## 4. Immediate next steps (M0)

1. Install frontend deps: `tailwindcss @tanstack/react-query @tanstack/react-virtual zustand react-router-dom lucide-react` + dev: `vitest @testing-library/react @playwright/test eslint prettier`.
2. Self-host the two fonts; delete the CDN links the mockup relied on.
3. Port the mockup's `:root` block into `styles/theme.css` as the dark theme, with light-theme values stubbed.
4. Create the folder skeleton and the `services/bridge` seam + ESLint rule.
5. Configure `main.go` window options for macOS chrome; strip the Greet demo.
