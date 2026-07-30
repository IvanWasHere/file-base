package main

import (
	"context"
	"embed"

	"file-base/backend/db"
	"file-base/backend/filesystem"
	"file-base/backend/shell"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	database := db.New()
	defer func() { _ = db.Close(database) }()

	err := wails.Run(&options.App{
		Title:     "Files",
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
				Title:   "Files",
				Message: "A fast, native-feeling file explorer.",
			},
		},

		OnStartup: func(ctx context.Context) {
			app.startup(ctx)
			// Opening eagerly surfaces a bad database file in the log at launch
			// rather than on the first query. Failure is not fatal: the explorer
			// still browses, it just loses favorites and session restore.
			if err := db.Open(database); err != nil {
				println("database unavailable:", err.Error())
			}
		},
		// Each package binds separately so the generated TypeScript bindings stay
		// namespaced (wailsjs/go/filesystem/FS, wailsjs/go/db/DB).
		// dialogs binds in M6, watcher in M7, thumbs in M10.
		Bind: []interface{}{
			app,
			filesystem.New(),
			shell.New(),
			database,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
