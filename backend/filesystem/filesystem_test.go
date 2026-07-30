package filesystem

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func decodeError(t *testing.T, err error) errorPayload {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
	message := err.Error()
	if !strings.HasPrefix(message, errorPrefix) {
		t.Fatalf("error is not encoded for the bridge: %q", message)
	}
	var payload errorPayload
	if decodeErr := json.Unmarshal([]byte(strings.TrimPrefix(message, errorPrefix)), &payload); decodeErr != nil {
		t.Fatalf("error payload is not valid JSON: %v", decodeErr)
	}
	return payload
}

func find(items []FileItem, name string) (FileItem, bool) {
	for _, item := range items {
		if item.Name == name {
			return item, true
		}
	}
	return FileItem{}, false
}

func TestReadDirectoryListsEntries(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "Reports"), 0o755); err != nil {
		t.Fatal(err)
	}

	items, err := New().ReadDirectory(dir, false)
	if err != nil {
		t.Fatalf("ReadDirectory: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(items))
	}

	file, ok := find(items, "notes.txt")
	if !ok {
		t.Fatal("notes.txt missing from listing")
	}
	if file.IsDirectory {
		t.Error("notes.txt reported as a directory")
	}
	if file.Size != 5 {
		t.Errorf("size = %d, want 5", file.Size)
	}
	if file.ModifiedAt == 0 || file.CreatedAt == 0 {
		t.Error("timestamps not populated")
	}
	if file.MimeType != "text/plain" {
		t.Errorf("mime = %q, want text/plain", file.MimeType)
	}
	if file.Path != filepath.Join(dir, "notes.txt") {
		t.Errorf("path = %q, want absolute path", file.Path)
	}

	folder, ok := find(items, "Reports")
	if !ok {
		t.Fatal("Reports missing from listing")
	}
	if !folder.IsDirectory {
		t.Error("Reports not reported as a directory")
	}
	if folder.MimeType != "inode/directory" {
		t.Errorf("mime = %q, want inode/directory", folder.MimeType)
	}
}

// Hidden entries must be returned and flagged, never filtered out: whether they
// are displayed is a frontend setting (PRD — "No filtering" in Go).
func TestReadDirectoryReturnsHiddenEntriesFlagged(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{".hidden", "visible.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}

	items, err := New().ReadDirectory(dir, false)
	if err != nil {
		t.Fatalf("ReadDirectory: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("hidden entry was filtered out: got %d entries", len(items))
	}

	hidden, _ := find(items, ".hidden")
	if !hidden.Hidden {
		t.Error(".hidden not flagged as hidden")
	}
	visible, _ := find(items, "visible.txt")
	if visible.Hidden {
		t.Error("visible.txt incorrectly flagged as hidden")
	}
}

func TestReadDirectoryReportsSymlinks(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target.txt")
	if err := os.WriteFile(target, []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(dir, "link.txt")); err != nil {
		t.Fatal(err)
	}

	items, err := New().ReadDirectory(dir, false)
	if err != nil {
		t.Fatalf("ReadDirectory: %v", err)
	}

	link, ok := find(items, "link.txt")
	if !ok {
		t.Fatal("symlink missing from listing")
	}
	if !link.Symlink {
		t.Error("symlink not flagged")
	}
	if link.SymlinkTarget != target {
		t.Errorf("target = %q, want %q", link.SymlinkTarget, target)
	}
	if link.Broken {
		t.Error("valid symlink marked broken")
	}
}

// A dangling symlink must not make the whole directory unlistable.
func TestReadDirectorySurvivesBrokenSymlink(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "real.txt"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, "gone.txt"), filepath.Join(dir, "dangling")); err != nil {
		t.Fatal(err)
	}

	items, err := New().ReadDirectory(dir, false)
	if err != nil {
		t.Fatalf("a broken symlink made the directory unreadable: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(items))
	}

	dangling, ok := find(items, "dangling")
	if !ok {
		t.Fatal("broken symlink omitted from listing")
	}
	if !dangling.Broken {
		t.Error("broken symlink not flagged as broken")
	}
	if !dangling.Symlink {
		t.Error("broken symlink not flagged as a symlink")
	}
}

func TestReadDirectoryFollowSymlinks(t *testing.T) {
	dir := t.TempDir()
	targetDir := filepath.Join(dir, "target")
	if err := os.Mkdir(targetDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(targetDir, filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}

	notFollowed, err := New().ReadDirectory(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	link, _ := find(notFollowed, "link")
	if link.IsDirectory {
		t.Error("unfollowed symlink reported as a directory")
	}

	followed, err := New().ReadDirectory(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	link, _ = find(followed, "link")
	if !link.IsDirectory {
		t.Error("followed symlink to a directory not reported as one")
	}
}

func TestReadDirectoryErrors(t *testing.T) {
	t.Run("missing path", func(t *testing.T) {
		_, err := New().ReadDirectory(filepath.Join(t.TempDir(), "nope"), false)
		if payload := decodeError(t, err); payload.Code != codeNotFound {
			t.Errorf("code = %q, want %q", payload.Code, codeNotFound)
		}
	})

	t.Run("path is a file", func(t *testing.T) {
		file := filepath.Join(t.TempDir(), "file.txt")
		if err := os.WriteFile(file, nil, 0o644); err != nil {
			t.Fatal(err)
		}
		_, err := New().ReadDirectory(file, false)
		if payload := decodeError(t, err); payload.Code != codeNotADirectory {
			t.Errorf("code = %q, want %q", payload.Code, codeNotADirectory)
		}
	})

	t.Run("unreadable directory", func(t *testing.T) {
		if os.Getuid() == 0 {
			t.Skip("root bypasses permission checks")
		}
		dir := filepath.Join(t.TempDir(), "locked")
		if err := os.Mkdir(dir, 0o000); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })

		_, err := New().ReadDirectory(dir, false)
		if payload := decodeError(t, err); payload.Code != codePermissionDenied {
			t.Errorf("code = %q, want %q", payload.Code, codePermissionDenied)
		}
	})
}

func TestReadFileInfo(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "report.pdf")
	if err := os.WriteFile(path, []byte("pdf"), 0o644); err != nil {
		t.Fatal(err)
	}

	item, err := New().ReadFileInfo(path)
	if err != nil {
		t.Fatalf("ReadFileInfo: %v", err)
	}
	if item.Name != "report.pdf" {
		t.Errorf("name = %q", item.Name)
	}
	if item.Permissions == "" {
		t.Error("permissions not populated")
	}

	_, err = New().ReadFileInfo(filepath.Join(dir, "absent"))
	if payload := decodeError(t, err); payload.Code != codeNotFound {
		t.Errorf("code = %q, want %q", payload.Code, codeNotFound)
	}
}

func TestExists(t *testing.T) {
	dir := t.TempDir()
	present, err := New().Exists(dir)
	if err != nil || !present {
		t.Fatalf("Exists(dir) = %v, %v; want true, nil", present, err)
	}

	// A missing path is a false result, not an error — callers branch on the
	// boolean, and forcing them into a try/catch would be hostile.
	absent, err := New().Exists(filepath.Join(dir, "nope"))
	if err != nil {
		t.Fatalf("Exists on a missing path returned an error: %v", err)
	}
	if absent {
		t.Error("Exists reported a missing path as present")
	}
}

func TestStandardPaths(t *testing.T) {
	paths, err := New().StandardPaths()
	if err != nil {
		t.Fatalf("StandardPaths: %v", err)
	}
	if paths.Home == "" || !filepath.IsAbs(paths.Home) {
		t.Fatalf("home = %q, want an absolute path", paths.Home)
	}
	if paths.Downloads != filepath.Join(paths.Home, "Downloads") {
		t.Errorf("downloads = %q", paths.Downloads)
	}
	if paths.Applications != "/Applications" {
		t.Errorf("applications = %q", paths.Applications)
	}
}

func TestListVolumes(t *testing.T) {
	volumes, err := New().ListVolumes()
	if err != nil {
		t.Fatalf("ListVolumes: %v", err)
	}
	if len(volumes) == 0 {
		t.Fatal("no volumes returned")
	}

	root := volumes[0]
	if !root.Root || root.Path != "/" {
		t.Fatalf("first volume = %+v, want the boot volume", root)
	}
	if root.TotalBytes <= 0 || root.FreeBytes <= 0 {
		t.Errorf("boot volume capacity not reported: total=%d free=%d", root.TotalBytes, root.FreeBytes)
	}
	if root.FreeBytes > root.TotalBytes {
		t.Errorf("free (%d) exceeds total (%d)", root.FreeBytes, root.TotalBytes)
	}

	// The boot volume is symlinked into /Volumes; it must appear exactly once.
	seen := map[string]int{}
	for _, volume := range volumes {
		seen[volume.Path]++
	}
	for path, count := range seen {
		if count > 1 {
			t.Errorf("volume %q listed %d times", path, count)
		}
	}
}

func TestMimeTypeFor(t *testing.T) {
	cases := []struct {
		name  string
		isDir bool
		want  string
	}{
		{"Reports", true, "inode/directory"},
		{"a.txt", false, "text/plain"},
		{"a.unknownext", false, "application/octet-stream"},
		{"noextension", false, "application/octet-stream"},
	}
	for _, testCase := range cases {
		if got := mimeTypeFor(testCase.name, testCase.isDir); got != testCase.want {
			t.Errorf("mimeTypeFor(%q) = %q, want %q", testCase.name, got, testCase.want)
		}
	}
}
