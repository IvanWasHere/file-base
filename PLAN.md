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
- **Replace:** `parentId` integer tree → real absolute **paths** as identity. `db.files.where('parentId')` → `ReadDirectory(path)`. Dexie → SQLite for app state only. `m.redraw()` → React reactivity. Font Awesome → Lucide. CDN Tailwind → build-time Tailwind.
- **Add (not in the mockup):** multi-selection, file operations, watcher, search, context menus, keyboard shortcuts, drag & drop, virtualization, error handling, file hashing (§M14), quick file creation from templates (§M15).

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

### M15 — Quick file creation

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
claims still creates an empty file of that type; and undo removes it.

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
| **Photos view on a large folder** — full-size decodes per step, thousands of filmstrip thumbs | 512px cached thumbnail as the stage image with the original swapped in behind it, horizontally virtualized filmstrip, ±1 prefetch (§M13) |
| **Hashing multi-gigabyte files** — a modal that appears frozen, work that outlives the window | Streamed with a fixed buffer, byte-level progress, real cancellation on close, bounded worker pool (§M14) |
| **A stale digest presented as fact** | Session-scoped cache only, keyed on path + size + mtime; nothing persisted across runs (§M14 decision 4) |
| **Writing content could overwrite a file** — M15 is the first feature that puts bytes on disk | No write API is added at all: `CreateFile` keeps `O_EXCL`, so it creates or fails and can never truncate an existing file (§M15 decision 3) |
| **A hand-maintained templates folder** — huge, binary or unreadable files | Read through `readTextFile`'s existing cap; a bad template is listed with its reason and never stops the dialog opening (§M15 decision 14) |
| **Notarization** for distribution | Deferred to M12; not blocking for local development |

---

## 4. Immediate next steps (M0)

1. Install frontend deps: `tailwindcss @tanstack/react-query @tanstack/react-virtual zustand react-router-dom lucide-react` + dev: `vitest @testing-library/react @playwright/test eslint prettier`.
2. Self-host the two fonts; delete the CDN links the mockup relied on.
3. Port the mockup's `:root` block into `styles/theme.css` as the dark theme, with light-theme values stubbed.
4. Create the folder skeleton and the `services/bridge` seam + ESLint rule.
5. Configure `main.go` window options for macOS chrome; strip the Greet demo.
