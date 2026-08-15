package appmenu

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/menu"
)

// The frontend's MenuCommandId union is the vocabulary; this package is one
// speaker of it. A native item naming a command TypeScript does not implement
// would be a menu row that silently does nothing, and nothing else in either
// build would catch it — Go cannot import a TypeScript type, and the frontend
// cannot see this file.
func TestCommandIDsExistInFrontend(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "..", "frontend", "src", "constants", "menus.ts"))
	if err != nil {
		t.Fatalf("reading the frontend menu definition: %v", err)
	}

	// Matches the union members: `  | 'file.newFolder'`.
	pattern := regexp.MustCompile(`\|\s*'([a-zA-Z]+\.[a-zA-Z]+)'`)
	known := map[string]bool{}
	for _, match := range pattern.FindAllStringSubmatch(string(source), -1) {
		known[match[1]] = true
	}

	if len(known) == 0 {
		t.Fatal("found no command ids in menus.ts — the union's shape must have changed, " +
			"and this test would pass vacuously")
	}

	for _, id := range CommandIDs() {
		if !known[id] {
			t.Errorf("native menu emits %q, which is not a MenuCommandId in the frontend", id)
		}
	}
}

func TestCommandIDsAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, id := range CommandIDs() {
		if seen[id] {
			t.Errorf("duplicate command id %q — two rows would dispatch the same command", id)
		}
		seen[id] = true
	}
}

// Every leaf must carry a callback: a menu row that emits nothing looks enabled
// and does nothing, which is worse than being absent.
func TestEveryItemDispatches(t *testing.T) {
	root := New(context.Background())

	var leaves int
	var walk func(items []*menu.MenuItem)
	walk = func(items []*menu.MenuItem) {
		for _, item := range items {
			switch {
			case item.SubMenu != nil:
				walk(item.SubMenu.Items)
			case item.IsSeparator(), item.Role != 0:
				// Separators and Wails roles are rendered by macOS.
			default:
				leaves++
				if item.Click == nil {
					t.Errorf("menu item %q has no click handler", item.Label)
				}
			}
		}
	}
	walk(root.Items)

	if leaves != len(CommandIDs()) {
		t.Errorf("built %d clickable items, expected %d", leaves, len(CommandIDs()))
	}
}
