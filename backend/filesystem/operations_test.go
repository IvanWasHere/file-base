package filesystem

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

func TestCreateFolder(t *testing.T) {
	fs := New()
	dir := t.TempDir()

	item, err := fs.CreateFolder(dir, "Reports")
	if err != nil {
		t.Fatal(err)
	}
	if !item.IsDirectory {
		t.Error("created folder is not reported as a directory")
	}
	if item.Name != "Reports" {
		t.Errorf("name = %q, want %q", item.Name, "Reports")
	}
	if info, statErr := os.Stat(filepath.Join(dir, "Reports")); statErr != nil || !info.IsDir() {
		t.Fatal("folder was not created on disk")
	}

	_, err = fs.CreateFolder(dir, "Reports")
	if payload := decodeError(t, err); payload.Code != codeAlreadyExists {
		t.Errorf("second create: code = %q, want %q", payload.Code, codeAlreadyExists)
	}
}

func TestCreateFile(t *testing.T) {
	fs := New()
	dir := t.TempDir()

	item, err := fs.CreateFile(dir, "notes.txt", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if item.IsDirectory || item.Size != 0 {
		t.Errorf("expected an empty file, got %+v", item)
	}
	if item.MimeType != "text/plain" {
		t.Errorf("mimeType = %q, want text/plain", item.MimeType)
	}

	_, err = fs.CreateFile(dir, "notes.txt", "", false)
	if payload := decodeError(t, err); payload.Code != codeAlreadyExists {
		t.Errorf("second create: code = %q, want %q", payload.Code, codeAlreadyExists)
	}
}

func TestCreateFileWritesContentVerbatim(t *testing.T) {
	fs := New()
	dir := t.TempDir()

	// Deliberately awkward: a shebang that a BOM would break, a trailing
	// newline, a tab, and a non-ASCII character that must survive as UTF-8.
	content := "#!/bin/sh\n\techo 'héllo'\n"
	item, err := fs.CreateFile(dir, "run.sh", content, false)
	if err != nil {
		t.Fatal(err)
	}

	written, err := os.ReadFile(filepath.Join(dir, "run.sh"))
	if err != nil {
		t.Fatal(err)
	}
	if string(written) != content {
		t.Errorf("wrote %q, want %q", written, content)
	}
	if item.Size != int64(len(content)) {
		t.Errorf("size = %d, want %d", item.Size, len(content))
	}
}

// A shell script that comes out non-executable is the most annoying way this
// feature can fail, and the mode has to be right the moment the file exists.
func TestCreateFileHonoursTheExecutableBit(t *testing.T) {
	fs := New()
	dir := t.TempDir()

	if _, err := fs.CreateFile(dir, "run.sh", "#!/bin/sh\n", true); err != nil {
		t.Fatal(err)
	}
	if _, err := fs.CreateFile(dir, "notes.md", "# Notes\n", false); err != nil {
		t.Fatal(err)
	}

	script, err := os.Stat(filepath.Join(dir, "run.sh"))
	if err != nil {
		t.Fatal(err)
	}
	if script.Mode().Perm()&0o111 == 0 {
		t.Errorf("script mode = %v, want the executable bits set", script.Mode().Perm())
	}

	plain, err := os.Stat(filepath.Join(dir, "notes.md"))
	if err != nil {
		t.Fatal(err)
	}
	if plain.Mode().Perm()&0o111 != 0 {
		t.Errorf("plain file mode = %v, want no executable bits", plain.Mode().Perm())
	}
}

// The whole reason this is a create rather than a write: it must be incapable
// of destroying a file that is already there, whatever it is asked to do.
func TestCreateFileNeverOverwrites(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	path := filepath.Join(dir, "precious.txt")

	if err := os.WriteFile(path, []byte("do not lose me"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := fs.CreateFile(dir, "precious.txt", "replacement content", false)
	if payload := decodeError(t, err); payload.Code != codeAlreadyExists {
		t.Errorf("code = %q, want %q", payload.Code, codeAlreadyExists)
	}

	survived, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(survived) != "do not lose me" {
		t.Errorf("the existing file was modified: %q", survived)
	}
}

// A name is a name, not a path: without validation the frontend could write
// anywhere on disk by passing "../".
func TestCreateRejectsInvalidNames(t *testing.T) {
	fs := New()
	dir := t.TempDir()

	for _, name := range []string{"", "   ", ".", "..", "../escape", "a/b", string(rune(0))} {
		if _, err := fs.CreateFolder(dir, name); err == nil {
			t.Errorf("CreateFolder(%q) was allowed", name)
		} else if payload := decodeError(t, err); payload.Code != codeInvalidName {
			t.Errorf("CreateFolder(%q): code = %q, want %q", name, payload.Code, codeInvalidName)
		}
	}

	if exists(filepath.Join(filepath.Dir(dir), "escape")) {
		t.Fatal("a traversal name created an entry outside the parent")
	}
}

func TestCreateInMissingParent(t *testing.T) {
	fs := New()
	_, err := fs.CreateFolder(filepath.Join(t.TempDir(), "nope"), "child")
	if payload := decodeError(t, err); payload.Code != codeNotFound {
		t.Errorf("code = %q, want %q", payload.Code, codeNotFound)
	}
}

func TestRename(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "draft.txt"), "hello")

	item, err := fs.Rename(filepath.Join(dir, "draft.txt"), "final.txt")
	if err != nil {
		t.Fatal(err)
	}
	if item.Name != "final.txt" || item.Path != filepath.Join(dir, "final.txt") {
		t.Errorf("renamed item = %+v", item)
	}
	if exists(filepath.Join(dir, "draft.txt")) {
		t.Error("the original name still exists")
	}
	if readFile(t, filepath.Join(dir, "final.txt")) != "hello" {
		t.Error("contents did not survive the rename")
	}
}

func TestRenameToExistingName(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "a.txt"), "a")
	writeFile(t, filepath.Join(dir, "b.txt"), "b")

	_, err := fs.Rename(filepath.Join(dir, "a.txt"), "b.txt")
	if payload := decodeError(t, err); payload.Code != codeAlreadyExists {
		t.Errorf("code = %q, want %q", payload.Code, codeAlreadyExists)
	}
	if readFile(t, filepath.Join(dir, "b.txt")) != "b" {
		t.Fatal("a rejected rename overwrote the destination")
	}
}

// APFS is case-insensitive by default, so the destination of a case-only rename
// stats as already existing. Rejecting it would make "notes" -> "Notes"
// impossible in the UI.
func TestRenameCaseOnly(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "notes.txt"), "hello")

	item, err := fs.Rename(filepath.Join(dir, "notes.txt"), "Notes.txt")
	if err != nil {
		t.Fatal(err)
	}
	if item.Name != "Notes.txt" {
		t.Errorf("name = %q, want %q", item.Name, "Notes.txt")
	}
}

func TestRenameToSameName(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "notes.txt"), "hello")

	if _, err := fs.Rename(filepath.Join(dir, "notes.txt"), "notes.txt"); err != nil {
		t.Fatalf("renaming to the current name should be a no-op: %v", err)
	}
	if readFile(t, filepath.Join(dir, "notes.txt")) != "hello" {
		t.Fatal("a no-op rename lost the contents")
	}
}

func TestMove(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	source, destination := filepath.Join(dir, "src"), filepath.Join(dir, "dst")
	if err := os.MkdirAll(filepath.Join(source, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(destination, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(source, "nested", "deep.txt"), "deep")
	writeFile(t, filepath.Join(source, "top.txt"), "top")

	result, err := fs.Move([]string{filepath.Join(source, "nested")}, destination, PolicyFail)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Succeeded) != 1 || result.Succeeded[0].Target != filepath.Join(destination, "nested") {
		t.Fatalf("result = %+v", result)
	}
	// The pairing is what undo replays; a target alone could not be put back.
	if result.Succeeded[0].Source != filepath.Join(source, "nested") {
		t.Errorf("source = %q, want %q", result.Succeeded[0].Source, filepath.Join(source, "nested"))
	}
	if exists(filepath.Join(source, "nested")) {
		t.Error("the source directory survived the move")
	}
	if readFile(t, filepath.Join(destination, "nested", "deep.txt")) != "deep" {
		t.Error("nested contents were not moved")
	}
}

func TestCopyPreservesTreeAndMetadata(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	source, destination := filepath.Join(dir, "src"), filepath.Join(dir, "dst")
	if err := os.MkdirAll(filepath.Join(source, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(destination, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(source, "nested", "deep.txt"), "deep")
	if err := os.Chmod(filepath.Join(source, "nested", "deep.txt"), 0o600); err != nil {
		t.Fatal(err)
	}
	modified := time.Now().Add(-72 * time.Hour).Truncate(time.Second)
	if err := os.Chtimes(filepath.Join(source, "nested", "deep.txt"), modified, modified); err != nil {
		t.Fatal(err)
	}

	result, err := fs.Copy([]string{source}, destination, PolicyFail)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Succeeded) != 1 {
		t.Fatalf("result = %+v", result)
	}
	if !exists(filepath.Join(source, "nested", "deep.txt")) {
		t.Error("copy removed the source")
	}

	copied := filepath.Join(destination, "src", "nested", "deep.txt")
	if readFile(t, copied) != "deep" {
		t.Error("copied contents differ")
	}
	info, err := os.Stat(copied)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("permissions = %v, want 0600", info.Mode().Perm())
	}
	if !info.ModTime().Truncate(time.Second).Equal(modified) {
		t.Errorf("modTime = %v, want %v", info.ModTime(), modified)
	}
}

// Following a symlink during a copy would inline the target's bytes, and a link
// pointing at its own ancestor would never terminate.
func TestCopyRecreatesSymlinks(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	source, destination := filepath.Join(dir, "src"), filepath.Join(dir, "dst")
	if err := os.Mkdir(source, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(destination, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(source, "real.txt"), "real")
	if err := os.Symlink(filepath.Join(source, "real.txt"), filepath.Join(source, "link.txt")); err != nil {
		t.Fatal(err)
	}
	// A link back to its own parent — an infinite loop for a following copy.
	if err := os.Symlink(source, filepath.Join(source, "loop")); err != nil {
		t.Fatal(err)
	}

	if _, err := fs.Copy([]string{source}, destination, PolicyFail); err != nil {
		t.Fatal(err)
	}

	info, err := os.Lstat(filepath.Join(destination, "src", "link.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Error("the symlink was copied as a regular file")
	}
}

func TestCopyConflictPolicies(t *testing.T) {
	cases := []struct {
		policy       string
		wantName     string
		wantContent  string
		wantConflict bool
	}{
		{PolicyReplace, "notes.txt", "new", false},
		{PolicyKeepBoth, "notes copy.txt", "new", false},
		{PolicySkip, "notes.txt", "old", false},
		{PolicyFail, "notes.txt", "old", true},
		// An unrecognised policy must behave like "ask", never like "replace".
		{"nonsense", "notes.txt", "old", true},
	}

	for _, testCase := range cases {
		t.Run(testCase.policy, func(t *testing.T) {
			fs := New()
			dir := t.TempDir()
			source, destination := filepath.Join(dir, "src"), filepath.Join(dir, "dst")
			if err := os.Mkdir(source, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(destination, 0o755); err != nil {
				t.Fatal(err)
			}
			writeFile(t, filepath.Join(source, "notes.txt"), "new")
			writeFile(t, filepath.Join(destination, "notes.txt"), "old")

			result, err := fs.Copy([]string{filepath.Join(source, "notes.txt")}, destination, testCase.policy)
			if err != nil {
				t.Fatal(err)
			}

			if testCase.wantConflict {
				if len(result.Conflicts) != 1 {
					t.Fatalf("expected a reported conflict, got %+v", result)
				}
			} else if len(result.Conflicts) != 0 {
				t.Fatalf("unexpected conflict: %+v", result)
			}

			if got := readFile(t, filepath.Join(destination, testCase.wantName)); got != testCase.wantContent {
				t.Errorf("%s = %q, want %q", testCase.wantName, got, testCase.wantContent)
			}
			if testCase.policy == PolicyKeepBoth &&
				readFile(t, filepath.Join(destination, "notes.txt")) != "old" {
				t.Error("keep-both overwrote the existing file")
			}
		})
	}
}

// Copying into the folder an item already lives in is Duplicate, and must not
// be short-circuited as a same-path no-op.
func TestCopyIntoSameDirectoryDuplicates(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "notes.txt"), "hello")

	result, err := fs.Copy([]string{filepath.Join(dir, "notes.txt")}, dir, PolicyKeepBoth)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Succeeded) != 1 || result.Succeeded[0].Target != filepath.Join(dir, "notes copy.txt") {
		t.Fatalf("result = %+v", result)
	}
	if readFile(t, filepath.Join(dir, "notes copy.txt")) != "hello" {
		t.Error("the duplicate has the wrong contents")
	}
	if readFile(t, filepath.Join(dir, "notes.txt")) != "hello" {
		t.Error("the original was disturbed")
	}
}

// Mirrors nextAvailableName in frontend/src/utils/path.ts. The two implement
// the same scheme and must not drift.
func TestAvailableNameMatchesFrontendScheme(t *testing.T) {
	dir := t.TempDir()

	writeFile(t, filepath.Join(dir, "Report.pdf"), "")
	first, err := availableName(dir, "Report.pdf")
	if err != nil || first != "Report copy.pdf" {
		t.Fatalf("first = %q (%v), want %q", first, err, "Report copy.pdf")
	}

	writeFile(t, filepath.Join(dir, "Report copy.pdf"), "")
	second, err := availableName(dir, "Report.pdf")
	if err != nil || second != "Report copy 2.pdf" {
		t.Fatalf("second = %q (%v), want %q", second, err, "Report copy 2.pdf")
	}

	// Duplicating a duplicate keeps one "copy", the way Finder does.
	third, err := availableName(dir, "Report copy.pdf")
	if err != nil || third != "Report copy 2.pdf" {
		t.Fatalf("third = %q (%v), want %q", third, err, "Report copy 2.pdf")
	}

	// A leading dot names a hidden file; it does not introduce an extension.
	writeFile(t, filepath.Join(dir, ".gitignore"), "")
	hidden, err := availableName(dir, ".gitignore")
	if err != nil || hidden != ".gitignore copy" {
		t.Fatalf("hidden = %q (%v), want %q", hidden, err, ".gitignore copy")
	}

	free, err := availableName(dir, "Untouched.pdf")
	if err != nil || free != "Untouched.pdf" {
		t.Fatalf("free = %q (%v), want it unchanged", free, err)
	}
}

func TestMoveFolderIntoItself(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	source := filepath.Join(dir, "src")
	if err := os.MkdirAll(filepath.Join(source, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}

	result, err := fs.Move([]string{source}, filepath.Join(source, "nested"), PolicyFail)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Failures) != 1 {
		t.Fatalf("expected a reported failure, got %+v", result)
	}
	if !exists(filepath.Join(source, "nested")) {
		t.Error("the rejected move damaged the tree")
	}
}

// One bad source must not abandon the rest of the batch.
func TestTransferReportsPerItemFailures(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	destination := filepath.Join(dir, "dst")
	if err := os.Mkdir(destination, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "real.txt"), "real")

	result, err := fs.Move(
		[]string{filepath.Join(dir, "ghost.txt"), filepath.Join(dir, "real.txt")},
		destination,
		PolicyFail,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Failures) != 1 || len(result.Succeeded) != 1 {
		t.Fatalf("result = %+v", result)
	}
	if !exists(filepath.Join(destination, "real.txt")) {
		t.Error("the healthy source was not moved")
	}
}

func TestTransferRejectsNonDirectoryDestination(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "notes.txt"), "hello")
	writeFile(t, filepath.Join(dir, "target.txt"), "target")

	_, err := fs.Copy([]string{filepath.Join(dir, "notes.txt")}, filepath.Join(dir, "target.txt"), PolicyFail)
	if payload := decodeError(t, err); payload.Code != codeNotADirectory {
		t.Errorf("code = %q, want %q", payload.Code, codeNotADirectory)
	}
}

func TestDelete(t *testing.T) {
	fs := New()
	dir := t.TempDir()
	nested := filepath.Join(dir, "tree", "nested")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(nested, "deep.txt"), "deep")
	writeFile(t, filepath.Join(dir, "loose.txt"), "loose")

	if err := fs.Delete([]string{filepath.Join(dir, "tree"), filepath.Join(dir, "loose.txt")}); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(dir, "tree")) || exists(filepath.Join(dir, "loose.txt")) {
		t.Fatal("delete left entries behind")
	}
}

// A recursive delete aimed at "/" or the home folder is not something a
// confirmation dialog can undo, so it is refused outright.
func TestDeleteRefusesCriticalPaths(t *testing.T) {
	fs := New()

	if err := fs.Delete([]string{"/"}); err == nil {
		t.Fatal("deleting / was allowed")
	} else if payload := decodeError(t, err); payload.Code != codeInvalidName {
		t.Errorf("code = %q, want %q", payload.Code, codeInvalidName)
	}

	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home directory")
	}
	if err := fs.Delete([]string{home}); err == nil {
		t.Fatal("deleting the home folder was allowed")
	}
	if _, err := fs.Trash([]string{home}); err == nil {
		t.Fatal("trashing the home folder was allowed")
	}
}

func TestTrashMovesToTheHomeTrash(t *testing.T) {
	fs := New()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home directory")
	}
	trash := filepath.Join(home, ".Trash")
	if _, err := os.Stat(trash); err != nil {
		t.Skip("no ~/.Trash on this machine")
	}

	// t.TempDir() is under /var/folders, on the boot volume, so the item lands
	// in ~/.Trash. Named distinctly to avoid colliding with anything real.
	dir := t.TempDir()
	name := "file-base-trash-test.txt"
	writeFile(t, filepath.Join(dir, name), "bye")

	trashed, err := fs.Trash([]string{filepath.Join(dir, name)})
	if err != nil {
		t.Fatal(err)
	}
	// Cleanup follows the returned path rather than globbing the directory:
	// enumerating ~/.Trash needs Full Disk Access, and a Glob that is denied
	// returns no matches and no error, silently leaving the file behind.
	t.Cleanup(func() {
		for _, item := range trashed {
			_ = os.RemoveAll(item.TrashPath)
		}
	})

	if exists(filepath.Join(dir, name)) {
		t.Error("the source survived being trashed")
	}

	// The returned mapping is what makes undo possible; without it the frontend
	// would know an item was trashed but not where to fetch it back from.
	if len(trashed) != 1 {
		t.Fatalf("trashed = %+v, want one entry", trashed)
	}
	if trashed[0].OriginalPath != filepath.Join(dir, name) {
		t.Errorf("originalPath = %q", trashed[0].OriginalPath)
	}
	// The exact name is not asserted: if a previous run left a file of the same
	// name behind, availableName correctly picks "... copy.txt".
	if filepath.Dir(trashed[0].TrashPath) != trash {
		t.Errorf("trashPath = %q, want it inside %q", trashed[0].TrashPath, trash)
	}
	if !exists(trashed[0].TrashPath) {
		t.Errorf("%s is not on disk", trashed[0].TrashPath)
	}
}

func TestTrashMissingPath(t *testing.T) {
	fs := New()
	_, err := fs.Trash([]string{filepath.Join(t.TempDir(), "ghost.txt")})
	if payload := decodeError(t, err); payload.Code != codeNotFound {
		t.Errorf("code = %q, want %q", payload.Code, codeNotFound)
	}
}

func TestMountPoint(t *testing.T) {
	mount, err := mountPoint(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if mount == "" || mount[0] != '/' {
		t.Errorf("mountPoint = %q, want an absolute path", mount)
	}

	// A path that does not exist still belongs to a volume — resolved through
	// its nearest existing ancestor, which is what Trash needs.
	missing, err := mountPoint(filepath.Join(t.TempDir(), "not", "yet", "here"))
	if err != nil {
		t.Fatal(err)
	}
	if missing != mount {
		t.Errorf("mountPoint of a missing path = %q, want %q", missing, mount)
	}
}

func TestIsWithin(t *testing.T) {
	cases := []struct {
		ancestor, child string
		want            bool
	}{
		{"/a", "/a", true},
		{"/a", "/a/b", true},
		{"/a", "/ab", false},
		{"/a/b", "/a", false},
		{"/", "/anything", true},
	}
	for _, testCase := range cases {
		if got := isWithin(testCase.ancestor, testCase.child); got != testCase.want {
			t.Errorf("isWithin(%q, %q) = %v, want %v",
				testCase.ancestor, testCase.child, got, testCase.want)
		}
	}
}
