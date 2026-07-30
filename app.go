package main

import (
	"context"
)

// App is the application lifecycle holder. It deliberately exposes no domain
// methods: native capability comes from the packages under backend/
// (filesystem, watcher, shell, dialogs, db, thumbs), each bound separately so
// the generated TypeScript bindings stay namespaced.
//
// Per the PRD, Go is a bridge only — no sorting, filtering, selection,
// navigation or application state lives here.
type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

// startup stores the context the Wails runtime needs for events and dialogs.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}
