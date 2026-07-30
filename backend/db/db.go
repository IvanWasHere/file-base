// Package db is the SQLite driver bridge.
//
// It owns the driver, the connection and the file location — and nothing else.
// There is no schema here, no migrations and no queries: TypeScript owns all of
// those (PLAN.md §0). The entire API is Query / Exec / Tx, so adding a table or
// changing a query never requires touching Go.
package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	// Pure-Go SQLite: no cgo, so the build stays a plain `go build`.
	// Verified to include FTS5 (SQLite 3.53.3) — see db_test.go.
	_ "modernc.org/sqlite"
)

const appFolderName = "MacFileExplorer"

type DB struct {
	mu   sync.Mutex
	conn *sql.DB
	path string
}

func New() *DB {
	return &DB{}
}

// NewAt points the database at an explicit file — used by tests. Not a method,
// so it never becomes part of the generated frontend bindings.
func NewAt(path string) *DB {
	return &DB{path: path}
}

// Open resolves the location and connects. Safe to call repeatedly.
//
// A package-level function rather than a method: Wails binds every exported
// method of a bound struct, and connection lifecycle is not something the
// frontend should be able to drive.
func Open(d *DB) error {
	_, err := d.connection()
	return err
}

// Close releases the connection; called on shutdown.
func Close(d *DB) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.conn == nil {
		return nil
	}
	err := d.conn.Close()
	d.conn = nil
	return err
}

// Statement is one step of a transaction.
type Statement struct {
	SQL  string `json:"sql"`
	Args []any  `json:"args"`
}

type ExecResult struct {
	RowsAffected int64 `json:"rowsAffected"`
	LastInsertID int64 `json:"lastInsertId"`
}

// Path reports the database file location, for diagnostics in the UI.
func (d *DB) Path() (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.path != "" {
		return d.path, nil
	}
	return defaultPath()
}

// connection opens lazily so a failure surfaces on the call that needed the
// database rather than crashing startup.
func (d *DB) connection() (*sql.DB, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.conn != nil {
		return d.conn, nil
	}

	path := d.path
	if path == "" {
		resolved, err := defaultPath()
		if err != nil {
			return nil, dbError("unknown", err.Error())
		}
		path = resolved
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, dbError("permission-denied", err.Error())
	}

	// WAL keeps reads from blocking on writes, which matters once the M8
	// search indexer is writing while the UI is querying. busy_timeout stops a
	// concurrent write from failing outright.
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)"

	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, dbError("unknown", err.Error())
	}
	if err := conn.Ping(); err != nil {
		_ = conn.Close()
		return nil, dbError("unknown", err.Error())
	}

	d.conn = conn
	d.path = path
	return conn, nil
}

func defaultPath() (string, error) {
	// ~/Library/Application Support on macOS.
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, appFolderName, "app.db"), nil
}

// Query runs a SELECT and returns rows as column-keyed maps.
func (d *DB) Query(query string, args []any) ([]map[string]any, error) {
	conn, err := d.connection()
	if err != nil {
		return nil, err
	}

	rows, err := conn.Query(query, normalizeArgs(args)...)
	if err != nil {
		return nil, dbError("query-failed", err.Error())
	}
	defer func() { _ = rows.Close() }()

	columns, err := rows.Columns()
	if err != nil {
		return nil, dbError("query-failed", err.Error())
	}

	results := make([]map[string]any, 0)
	for rows.Next() {
		cells := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range cells {
			pointers[i] = &cells[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, dbError("query-failed", err.Error())
		}

		row := make(map[string]any, len(columns))
		for i, column := range columns {
			row[column] = normalizeValue(cells[i])
		}
		results = append(results, row)
	}

	if err := rows.Err(); err != nil {
		return nil, dbError("query-failed", err.Error())
	}
	return results, nil
}

func (d *DB) Exec(query string, args []any) (ExecResult, error) {
	conn, err := d.connection()
	if err != nil {
		return ExecResult{}, err
	}

	result, err := conn.Exec(query, normalizeArgs(args)...)
	if err != nil {
		return ExecResult{}, dbError("exec-failed", err.Error())
	}

	// Neither value is available for every statement (a CREATE TABLE has
	// neither); zero is the honest answer rather than an error.
	affected, _ := result.RowsAffected()
	lastID, _ := result.LastInsertId()
	return ExecResult{RowsAffected: affected, LastInsertID: lastID}, nil
}

// Tx runs statements in one transaction, rolling back entirely on any failure.
func (d *DB) Tx(statements []Statement) error {
	conn, err := d.connection()
	if err != nil {
		return err
	}

	tx, err := conn.Begin()
	if err != nil {
		return dbError("exec-failed", err.Error())
	}

	for _, statement := range statements {
		if _, err := tx.Exec(statement.SQL, normalizeArgs(statement.Args)...); err != nil {
			_ = tx.Rollback()
			return dbError("exec-failed", fmt.Sprintf("%s (in: %s)", err.Error(), statement.SQL))
		}
	}

	if err := tx.Commit(); err != nil {
		_ = tx.Rollback()
		return dbError("exec-failed", err.Error())
	}
	return nil
}

// normalizeArgs adapts values that crossed the JSON bridge.
//
// Every JavaScript number arrives as float64, so an integer would bind as a
// REAL and break integer comparisons and INTEGER PRIMARY KEY lookups. Integral
// floats are converted back.
func normalizeArgs(args []any) []any {
	if args == nil {
		return nil
	}
	out := make([]any, len(args))
	for i, arg := range args {
		if number, ok := arg.(float64); ok && number == float64(int64(number)) {
			out[i] = int64(number)
			continue
		}
		out[i] = arg
	}
	return out
}

// normalizeValue makes scanned values safe to marshal back to the frontend.
func normalizeValue(value any) any {
	// TEXT can arrive as []byte; JSON would encode that as base64 and the
	// frontend would receive a garbled string.
	if raw, ok := value.([]byte); ok {
		return string(raw)
	}
	return value
}

// Errors use the same envelope as backend/filesystem so the frontend bridge
// decodes both through one path.
func dbError(code, message string) error {
	encoded, err := json.Marshal(map[string]string{"code": code, "path": "", "message": message})
	if err != nil {
		return errors.New(message)
	}
	return errors.New("fs-error:" + string(encoded))
}
