// Package appmenu builds the native macOS menu bar (PLAN.md M11).
//
// It carries labels and command ids and nothing else. Picking an item emits
// "menu:command" with the id; the frontend decides what that means and whether
// it can run right now. That split is deliberate:
//
//   - Enablement is selection state, and selection lives in TypeScript. Pushing
//     a rebuilt menu across the bridge on every selection change would be
//     several updates a second while a marquee is being dragged, to grey out
//     items nobody is looking at.
//
//   - The ids here are exactly the ones in frontend/src/constants/menus.ts.
//     TestCommandIDsExistInFrontend reads that file and fails if this package
//     ever names a command the frontend does not implement, which is the only
//     way the two halves can drift.
//
// No accelerators. macOS gives the key window's responder chain first refusal on
// a key equivalent, and the webview claims the ones this app uses — so a menu
// accelerator would be shadowed by the frontend's own registry in the packaged
// app and would fire on its own everywhere else. One owner is better than a
// coin toss: constants/shortcuts.ts owns every binding, and the in-window menu
// prints them.
package appmenu

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// CommandEvent is the Wails event a menu pick is delivered on. Must match
// `menuCommandEvent` in frontend/src/services/bridge/impl/decode.ts.
const CommandEvent = "menu:command"

// item is one row. An empty ID marks a separator; a non-empty Items marks a
// nested submenu, whose own ID is empty because there is nothing to dispatch.
type item struct {
	ID    string
	Label string
	Items []item
}

func separator() item { return item{} }

// submenu nests a group of rows. The only one so far is Split Layout: nine
// arrangements inline, after five view modes, would make View by far the
// longest menu in the app (PLAN.md §M17 decision 8).
func submenu(label string, items ...item) item {
	return item{Label: label, Items: items}
}

type section struct {
	Label string
	Items []item
}

// sections mirrors APP_MENUS in frontend/src/constants/menus.ts, minus Edit.
//
// The four split-layout labels originate in frontend/src/constants/splitModes.ts,
// which is the single source on that side; this is the one copy Go has to keep,
// because it cannot import a TypeScript constant. Only the ids are pinned by
// TestCommandIDsExistInFrontend, so a label change has to be made here by hand.
//
// The macOS App, Edit and Window menus come from Wails' own roles and are added
// in New; only the app's own menus are declared here.
//
// Edit is the role menu rather than one of ours, and that is not a style
// preference — it is what makes text editing work. WKWebView does not install
// ⌘C/⌘V for a focused input on its own; the standard Edit menu's key equivalents
// are what a rename field is relying on. Declaring our own Edit menu in its place
// left the inline rename editor unable to copy or paste, which is exactly what
// happened when this package first shipped without it. The app's own Edit
// commands — copy *files*, paste *files*, Find — stay reachable from the
// in-window menu bar, the context menus and the shortcut registry, all of which
// keep working because the webview sees those keystrokes first.
var sections = []section{
	{
		Label: "File",
		Items: []item{
			{ID: "file.open", Label: "Open"},
			{ID: "file.openInNewTab", Label: "Open in New Tab"},
			separator(),
			{ID: "file.newFolder", Label: "New Folder"},
			{ID: "file.newFile", Label: "New File"},
			separator(),
			{ID: "file.newTab", Label: "New Tab"},
			{ID: "file.closeTab", Label: "Close Tab"},
			separator(),
			{ID: "file.rename", Label: "Rename"},
			{ID: "file.duplicate", Label: "Duplicate"},
			separator(),
			{ID: "file.moveToTrash", Label: "Move to Trash"},
			{ID: "file.delete", Label: "Delete Immediately…"},
			separator(),
			{ID: "file.calculateHashes", Label: "Calculate Hashes…"},
			separator(),
			{ID: "file.revealInFinder", Label: "Reveal in Finder"},
			{ID: "file.copyPath", Label: "Copy Path"},
			separator(),
			{ID: "file.addToFavorites", Label: "Add to Favorites"},
			{ID: "file.removeFromFavorites", Label: "Remove from Favorites"},
		},
	},
	{
		Label: "View",
		Items: []item{
			{ID: "view.details", Label: "as Details"},
			{ID: "view.largeIcons", Label: "as Large Icons"},
			{ID: "view.mediumIcons", Label: "as Medium Icons"},
			{ID: "view.smallIcons", Label: "as Small Icons"},
			{ID: "view.photos", Label: "as Photos"},
			separator(),
			submenu("Split Layout",
				item{ID: "view.splitSingle", Label: "Single Pane"},
				item{ID: "view.splitTwo", Label: "2 Columns"},
				item{ID: "view.splitRows", Label: "2 Rows"},
				item{ID: "view.splitThree", Label: "3 Columns"},
				item{ID: "view.splitTop", Label: "Split Top"},
				item{ID: "view.splitBottom", Label: "Split Bottom"},
				item{ID: "view.splitLeft", Label: "Split Left"},
				item{ID: "view.splitRight", Label: "Split Right"},
				item{ID: "view.splitFour", Label: "2 × 2 Grid"},
			),
			separator(),
			{ID: "view.toggleHidden", Label: "Show Hidden Files"},
			{ID: "view.toggleSidebar", Label: "Show Sidebar"},
			{ID: "view.togglePreview", Label: "Show Preview"},
			separator(),
			{ID: "view.refresh", Label: "Refresh"},
		},
	},
	{
		Label: "Go",
		Items: []item{
			{ID: "go.back", Label: "Back"},
			{ID: "go.forward", Label: "Forward"},
			{ID: "go.up", Label: "Enclosing Folder"},
			separator(),
			{ID: "go.home", Label: "Home"},
			{ID: "go.documents", Label: "Documents"},
			{ID: "go.downloads", Label: "Downloads"},
			{ID: "go.applications", Label: "Applications"},
		},
	},
}

// CommandIDs lists every id the native menu can emit, in menu order. Exported
// for the drift test.
//
// Descends into nested submenus: a command one level down is still a command,
// and a walk that stopped at the top would report the nine split layouts as
// unreachable — which is exactly what the drift test is for.
func CommandIDs() []string {
	ids := make([]string, 0, 56)
	var collect func(items []item)
	collect = func(items []item) {
		for _, entry := range items {
			if len(entry.Items) > 0 {
				collect(entry.Items)
				continue
			}
			if entry.ID != "" {
				ids = append(ids, entry.ID)
			}
		}
	}
	for _, section := range sections {
		collect(section.Items)
	}
	return ids
}

// New builds the application menu.
//
// The context is captured by the click handlers rather than passed to them,
// because Wails hands a menu callback only the item that was clicked. It is
// therefore the startup context, which outlives every menu pick.
func New(ctx context.Context) *menu.Menu {
	emit := func(id string) menu.Callback {
		return func(*menu.CallbackData) {
			runtime.EventsEmit(ctx, CommandEvent, id)
		}
	}

	// AppMenu keeps About/Services/Hide/Quit; EditMenu carries the standard text
	// editing commands the webview needs; WindowMenu keeps Minimize and Zoom.
	// All three are Wails roles rendered by macOS, so they behave natively.
	root := menu.NewMenuFromItems(menu.AppMenu())

	// Recursive since §M17, for the one nested submenu the View menu now has.
	var build func(items []item) *menu.Menu
	build = func(items []item) *menu.Menu {
		built := menu.NewMenu()
		for _, entry := range items {
			switch {
			case len(entry.Items) > 0:
				built.Append(menu.SubMenu(entry.Label, build(entry.Items)))
			case entry.ID == "":
				built.AddSeparator()
			default:
				built.AddText(entry.Label, nil, emit(entry.ID))
			}
		}
		return built
	}

	for _, section := range sections {
		root.Append(menu.SubMenu(section.Label, build(section.Items)))

		// Edit belongs between File and View, where macOS apps put it. Appending
		// it up front would have read App, Edit, File, View.
		if section.Label == "File" {
			root.Append(menu.EditMenu())
		}
	}

	root.Append(menu.WindowMenu())
	return root
}
