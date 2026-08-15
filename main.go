package main

import (
	"context"
	"embed"

	"file-base/backend/appmenu"
	"file-base/backend/archive"
	"file-base/backend/db"
	"file-base/backend/filesystem"
	"file-base/backend/hashing"
	"file-base/backend/search"
	"file-base/backend/shell"
	"file-base/backend/thumbs"
	"file-base/backend/watcher"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	database := db.New()
	defer func() { _ = db.Close(database) }()

	watch := watcher.New()
	defer func() { _ = watcher.Stop(watch) }()

	finder := search.New()
	defer search.Stop(finder)

	hasher := hashing.New()
	defer hashing.Stop(hasher)

	archives := archive.New()
	// Reclaims every browse mount. Without it a quit leaves gigabytes of
	// extracted archives in the temp directory (PLAN.md §M18 decision 8).
	defer archive.Stop(archives)

	err := wails.Run(&options.App{
		Title:     "File Base",
		Width:     1280,
		Height:    820,
		MinWidth:  760,
		MinHeight: 480,

		AssetServer: &assetserver.Options{
			Assets: assets,
		},

		// Matches --bg-deep in frontend/src/styles/theme.css, so the window does
		// not flash a different colour before the webview paints.
		BackgroundColour: &options.RGBA{R: 0x0e, G: 0x0e, B: 0x12, A: 1},

		// Accepting files dragged in from Finder (M9). Dragging *out* to Finder
		// is not supported by the webview — see PLAN.md §3.
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: false,
		},

		Mac: &mac.Options{
			// Hidden-inset title bar: the tab bar occupies the title area, so it
			// needs ~78px of left padding to clear the traffic lights.
			TitleBar:             mac.TitleBarHiddenInset(),
			Appearance:           mac.NSAppearanceNameDarkAqua,
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
			About: &mac.AboutInfo{
				Title:   "File Base",
				Message: "A fast, native-feeling file explorer.",
			},
		},

		OnStartup: func(ctx context.Context) {
			app.startup(ctx)
			// Installed here rather than through the `Menu` option because every
			// item emits an event, and emitting needs the runtime context that
			// only exists once the app has started.
			runtime.MenuSetApplicationMenu(ctx, appmenu.New(ctx))
			// Opening eagerly surfaces a bad database file in the log at launch
			// rather than on the first query. Failure is not fatal: the explorer
			// still browses, it just loses favorites and session restore.
			if err := db.Open(database); err != nil {
				println("database unavailable:", err.Error())
			}
			// The watcher needs the runtime context to emit events. Failing to
			// start costs live updates, not the application: Refresh and every
			// operation still re-read the disk.
			if err := watcher.Start(watch, ctx); err != nil {
				println("watcher unavailable:", err.Error())
			}
			// Search only needs the context to stream results back; there is
			// nothing to fail.
			search.Start(finder, ctx)
			// Same for hashing: digests, progress and completion are all events.
			hashing.Start(hasher, ctx)
			archive.Start(archives, ctx)
			// A crash cannot clean up after itself, so mounts left by a previous
			// run are swept here — scoped by prefix inside the app's own temp
			// root, so it can only remove what this package created.
			if swept := archive.Sweep(); swept > 0 {
				println("reclaimed", swept, "archive mounts left by a previous run")
			}

			// Files dragged in from Finder. The coordinates matter: the drop
			// happens in the native layer, above the webview, so the frontend
			// cannot tell which pane was under the pointer without them
			// (PLAN.md M9).
			runtime.OnFileDrop(ctx, func(x, y int, paths []string) {
				runtime.EventsEmit(ctx, "files:dropped", map[string]any{
					"x": x, "y": y, "paths": paths,
				})
			})
		},
		// Each package binds separately so the generated TypeScript bindings stay
		// namespaced (wailsjs/go/filesystem/FS, wailsjs/go/db/DB).
		// dialogs binds with its first consumer.
		Bind: []interface{}{
			app,
			filesystem.New(),
			shell.New(),
			database,
			watch,
			finder,
			hasher,
			archives,
			thumbs.New(),
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
