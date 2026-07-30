package db

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func open(t *testing.T) *DB {
	t.Helper()
	database := NewAt(filepath.Join(t.TempDir(), "test.db"))
	if err := Open(database); err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = Close(database) })
	return database
}

func decodeError(t *testing.T, err error) map[string]string {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
	message := err.Error()
	if !strings.HasPrefix(message, "fs-error:") {
		t.Fatalf("error is not encoded for the bridge: %q", message)
	}
	var payload map[string]string
	if err := json.Unmarshal([]byte(strings.TrimPrefix(message, "fs-error:")), &payload); err != nil {
		t.Fatalf("payload is not valid JSON: %v", err)
	}
	return payload
}

// The reason M5 was flagged as a risk in PLAN.md: FTS5 is a compile-time option
// and its absence would force a cgo driver. This pins it.
func TestFTS5IsAvailable(t *testing.T) {
	database := open(t)

	if _, err := database.Exec(
		`create virtual table search_index using fts5(path, name, ext, tokenize='unicode61')`, nil,
	); err != nil {
		t.Fatalf("FTS5 unavailable — M8 would need a different driver: %v", err)
	}

	if _, err := database.Exec(
		`insert into search_index(path, name, ext) values (?, ?, ?)`,
		[]any{"/Users/dev/Annual Report.pdf", "Annual Report.pdf", "pdf"},
	); err != nil {
		t.Fatal(err)
	}

	rows, err := database.Query(`select path from search_index where search_index match ?`, []any{"report"})
	if err != nil {
		t.Fatalf("FTS5 match failed: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 match, got %d", len(rows))
	}

	// Prefix search is what an incremental search box needs.
	prefixed, err := database.Query(`select path from search_index where search_index match ?`, []any{"annu*"})
	if err != nil {
		t.Fatalf("FTS5 prefix match failed: %v", err)
	}
	if len(prefixed) != 1 {
		t.Fatalf("expected 1 prefix match, got %d", len(prefixed))
	}
}

func TestExecAndQuery(t *testing.T) {
	database := open(t)

	if _, err := database.Exec(`create table t (id integer primary key, name text, size integer)`, nil); err != nil {
		t.Fatal(err)
	}

	result, err := database.Exec(`insert into t (name, size) values (?, ?)`, []any{"notes.txt", 120})
	if err != nil {
		t.Fatal(err)
	}
	if result.RowsAffected != 1 {
		t.Errorf("rowsAffected = %d, want 1", result.RowsAffected)
	}
	if result.LastInsertID != 1 {
		t.Errorf("lastInsertId = %d, want 1", result.LastInsertID)
	}

	rows, err := database.Query(`select id, name, size from t`, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0]["name"] != "notes.txt" {
		t.Errorf("name = %v (%T), want a string", rows[0]["name"], rows[0]["name"])
	}
}

// Every JS number crosses the bridge as a float64. Binding one to an INTEGER
// column as a REAL breaks equality lookups, so integral floats are converted.
func TestFloatArgsBindAsIntegers(t *testing.T) {
	database := open(t)

	if _, err := database.Exec(`create table t (id integer primary key, n integer)`, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`insert into t (id, n) values (?, ?)`, []any{float64(7), float64(42)}); err != nil {
		t.Fatal(err)
	}

	rows, err := database.Query(`select n from t where id = ?`, []any{float64(7)})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("integral float did not match an INTEGER key: got %d rows", len(rows))
	}

	value, ok := rows[0]["n"].(int64)
	if !ok {
		t.Fatalf("n = %v (%T), want int64", rows[0]["n"], rows[0]["n"])
	}
	if value != 42 {
		t.Errorf("n = %d, want 42", value)
	}
}

func TestNonIntegralFloatsSurvive(t *testing.T) {
	database := open(t)

	if _, err := database.Exec(`create table t (ratio real)`, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`insert into t (ratio) values (?)`, []any{2.5}); err != nil {
		t.Fatal(err)
	}

	rows, err := database.Query(`select ratio from t`, nil)
	if err != nil {
		t.Fatal(err)
	}
	if rows[0]["ratio"] != 2.5 {
		t.Errorf("ratio = %v, want 2.5", rows[0]["ratio"])
	}
}

func TestTransactionCommits(t *testing.T) {
	database := open(t)

	if _, err := database.Exec(`create table t (name text)`, nil); err != nil {
		t.Fatal(err)
	}

	err := database.Tx([]Statement{
		{SQL: `insert into t (name) values (?)`, Args: []any{"a"}},
		{SQL: `insert into t (name) values (?)`, Args: []any{"b"}},
	})
	if err != nil {
		t.Fatalf("Tx: %v", err)
	}

	rows, _ := database.Query(`select name from t order by name`, nil)
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}
}

func TestTransactionRollsBackEntirely(t *testing.T) {
	database := open(t)

	if _, err := database.Exec(`create table t (name text unique)`, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`insert into t (name) values ('taken')`, nil); err != nil {
		t.Fatal(err)
	}

	err := database.Tx([]Statement{
		{SQL: `insert into t (name) values (?)`, Args: []any{"fresh"}},
		{SQL: `insert into t (name) values (?)`, Args: []any{"taken"}}, // violates unique
	})
	if err == nil {
		t.Fatal("expected the transaction to fail")
	}

	// The first statement must not survive a failed transaction.
	rows, _ := database.Query(`select name from t where name = 'fresh'`, nil)
	if len(rows) != 0 {
		t.Error("partial write survived a rolled-back transaction")
	}

	payload := decodeError(t, err)
	if payload["code"] != "exec-failed" {
		t.Errorf("code = %q, want exec-failed", payload["code"])
	}
	// The failing statement is named, so a migration bug is diagnosable.
	if !strings.Contains(payload["message"], "insert into t") {
		t.Errorf("message does not identify the statement: %q", payload["message"])
	}
}

func TestQueryErrorsAreEncoded(t *testing.T) {
	database := open(t)

	_, err := database.Query(`select * from does_not_exist`, nil)
	if payload := decodeError(t, err); payload["code"] != "query-failed" {
		t.Errorf("code = %q, want query-failed", payload["code"])
	}
}

func TestNullsRoundTrip(t *testing.T) {
	database := open(t)

	if _, err := database.Exec(`create table t (a text, b integer)`, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`insert into t (a, b) values (?, ?)`, []any{nil, nil}); err != nil {
		t.Fatal(err)
	}

	rows, err := database.Query(`select a, b from t`, nil)
	if err != nil {
		t.Fatal(err)
	}
	if rows[0]["a"] != nil || rows[0]["b"] != nil {
		t.Errorf("nulls did not round-trip: %+v", rows[0])
	}
}

func TestEmptyResultIsEmptySliceNotNull(t *testing.T) {
	database := open(t)

	if _, err := database.Exec(`create table t (a text)`, nil); err != nil {
		t.Fatal(err)
	}

	rows, err := database.Query(`select a from t`, nil)
	if err != nil {
		t.Fatal(err)
	}
	// A nil slice marshals to JSON `null`, which would make the frontend
	// defend against null on every query. Always an array.
	if rows == nil {
		t.Fatal("empty result marshalled as null rather than []")
	}
	if len(rows) != 0 {
		t.Fatalf("expected 0 rows, got %d", len(rows))
	}
}

func TestPathIsUnderApplicationSupport(t *testing.T) {
	path, err := New().Path()
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(path) {
		t.Errorf("path = %q, want absolute", path)
	}
	if filepath.Base(path) != "app.db" {
		t.Errorf("path = %q, want it to end in app.db", path)
	}
	if !strings.Contains(path, appFolderName) {
		t.Errorf("path = %q, want it under %s", path, appFolderName)
	}
}
