// Package filesystem is the native filesystem bridge.
//
// It reports what the operating system says and nothing more. There is no
// sorting, no filtering, no navigation and no application state here — those
// are TypeScript's job (see PLAN.md §1). Notably ReadDirectory returns hidden
// entries flagged rather than removed, because "show hidden files" is a user
// setting, not a filesystem fact.
package filesystem

import (
	"errors"
	"io/fs"
	"mime"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// FS is bound to Wails; its exported methods become the generated TS bindings.
type FS struct{}

func New() *FS {
	return &FS{}
}

// FileItem is the wire representation of a directory entry.
//
// Deliberately absent: `extension` and `category`. Both are derived in
// TypeScript — they are presentation concerns, and deriving them here would put
// UI decisions in Go.
type FileItem struct {
	Path          string `json:"path"`
	Name          string `json:"name"`
	Size          int64  `json:"size"`
	IsDirectory   bool   `json:"isDirectory"`
	CreatedAt     int64  `json:"createdAt"`  // unix milliseconds
	ModifiedAt    int64  `json:"modifiedAt"` // unix milliseconds
	Permissions   string `json:"permissions"`
	Hidden        bool   `json:"hidden"`
	Symlink       bool   `json:"symlink"`
	SymlinkTarget string `json:"symlinkTarget"`
	MimeType      string `json:"mimeType"`
	// Broken is true when the entry exists but could not be stat'd — a dangling
	// symlink, or a mount that went away. The entry is still returned so the UI
	// can show it as unavailable rather than silently omitting it.
	Broken bool `json:"broken"`
}

type Volume struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	TotalBytes int64  `json:"totalBytes"`
	FreeBytes  int64  `json:"freeBytes"`
	Removable  bool   `json:"removable"`
	Root       bool   `json:"root"`
}

type StandardPaths struct {
	Home         string `json:"home"`
	Desktop      string `json:"desktop"`
	Documents    string `json:"documents"`
	Downloads    string `json:"downloads"`
	Applications string `json:"applications"`
	Movies       string `json:"movies"`
	Music        string `json:"music"`
	Pictures     string `json:"pictures"`
	Trash        string `json:"trash"`
}

// ReadDirectory lists every entry in path, hidden ones included and flagged.
//
// followSymlinks controls whether a link is described by its target's metadata
// (Stat) or its own (Lstat). Entries that cannot be stat'd are returned with
// Broken set instead of failing the whole read — one dangling symlink should
// not make a folder unlistable.
func (f *FS) ReadDirectory(path string, followSymlinks bool) ([]FileItem, error) {
	cleaned := filepath.Clean(path)

	entries, err := os.ReadDir(cleaned)
	if err != nil {
		return nil, wrap(cleaned, err)
	}

	items := make([]FileItem, 0, len(entries))
	for _, entry := range entries {
		items = append(items, Describe(filepath.Join(cleaned, entry.Name()), followSymlinks))
	}

	// Stable byte order only. Real ordering (name/date/size/type, folders-first,
	// locale-aware) is applied in TypeScript.
	sort.Slice(items, func(i, j int) bool { return items[i].Path < items[j].Path })
	return items, nil
}

func (f *FS) ReadFileInfo(path string) (FileItem, error) {
	cleaned := filepath.Clean(path)
	if _, err := os.Lstat(cleaned); err != nil {
		return FileItem{}, wrap(cleaned, err)
	}
	return Describe(cleaned, false), nil
}

// ReadFileInfos describes many paths in one call.
//
// The FTS5 index stores paths, not metadata, so a search hit list has to be
// stat'd before it can be rendered — 200 separate bridge round trips for one
// keystroke's worth of results is the thing this avoids.
//
// Paths that no longer exist are omitted rather than returned broken: a stale
// index entry is not something to show the user, it is something to skip.
func (f *FS) ReadFileInfos(paths []string) ([]FileItem, error) {
	items := make([]FileItem, 0, len(paths))
	for _, path := range paths {
		cleaned := filepath.Clean(path)
		if _, err := os.Lstat(cleaned); err != nil {
			continue
		}
		items = append(items, Describe(cleaned, false))
	}
	return items, nil
}

func (f *FS) Exists(path string) (bool, error) {
	_, err := os.Lstat(filepath.Clean(path))
	if err == nil {
		return true, nil
	}
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	return false, wrap(path, err)
}

// StandardPaths resolves well-known locations from the OS rather than letting
// the frontend build them by string concatenation.
func (f *FS) StandardPaths() (StandardPaths, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return StandardPaths{}, wrap("", err)
	}
	return StandardPaths{
		Home:         home,
		Desktop:      filepath.Join(home, "Desktop"),
		Documents:    filepath.Join(home, "Documents"),
		Downloads:    filepath.Join(home, "Downloads"),
		Applications: "/Applications",
		Movies:       filepath.Join(home, "Movies"),
		Music:        filepath.Join(home, "Music"),
		Pictures:     filepath.Join(home, "Pictures"),
		Trash:        filepath.Join(home, ".Trash"),
	}, nil
}

// ListVolumes returns the boot volume plus everything mounted under /Volumes.
//
// A volume whose capacity cannot be read is still listed, with zero capacity —
// an ejected or unreachable disk should appear in the sidebar as unavailable
// rather than vanish.
func (f *FS) ListVolumes() ([]Volume, error) {
	volumes := make([]Volume, 0, 4)

	// The boot volume's display name comes from its /Volumes symlink, so it
	// reads as the user named it rather than a hardcoded "Macintosh HD".
	root := Volume{Name: bootVolumeName(), Path: "/", Root: true}
	if stat, err := statVolume("/"); err == nil {
		root.TotalBytes = int64(stat.Total)
		root.FreeBytes = int64(stat.Free)
	}
	volumes = append(volumes, root)

	entries, err := os.ReadDir("/Volumes")
	if err != nil {
		// No /Volumes (or unreadable) is not fatal — the boot volume still stands.
		return volumes, nil
	}

	for _, entry := range entries {
		mount := filepath.Join("/Volumes", entry.Name())

		// The boot volume is symlinked into /Volumes; skip the duplicate.
		if resolved, err := filepath.EvalSymlinks(mount); err == nil && resolved == "/" {
			continue
		}

		volume := Volume{Name: entry.Name(), Path: mount}
		stat, err := statVolume(mount)
		if err != nil {
			// Unreachable mount (ejected mid-read): list it with no capacity so
			// the UI can show it as unavailable rather than dropping it.
			volumes = append(volumes, volume)
			continue
		}

		// nobrowse mounts are machinery — Finder hides them, so do we.
		if !stat.Browsable {
			continue
		}

		volume.TotalBytes = int64(stat.Total)
		volume.FreeBytes = int64(stat.Free)
		volume.Removable = stat.Removable
		volumes = append(volumes, volume)
	}

	return volumes, nil
}

// bootVolumeName reads the user-visible name of "/" from its /Volumes symlink,
// falling back to the macOS default.
func bootVolumeName() string {
	entries, err := os.ReadDir("/Volumes")
	if err != nil {
		return "Macintosh HD"
	}
	for _, entry := range entries {
		mount := filepath.Join("/Volumes", entry.Name())
		if resolved, err := filepath.EvalSymlinks(mount); err == nil && resolved == "/" {
			return entry.Name()
		}
	}
	return "Macintosh HD"
}

// Describe builds a FileItem, degrading to a Broken entry when stat fails.
//
// Exported for backend/search, which describes entries as it walks past them
// and would otherwise pay for a second Lstat by going through ReadFileInfo.
func Describe(path string, followSymlinks bool) FileItem {
	name := filepath.Base(path)

	linkInfo, err := os.Lstat(path)
	if err != nil {
		return FileItem{Path: path, Name: name, Hidden: strings.HasPrefix(name, "."), Broken: true}
	}

	isSymlink := linkInfo.Mode()&os.ModeSymlink != 0
	target := ""
	info := linkInfo

	if isSymlink {
		target, _ = os.Readlink(path)
		resolved, resolveErr := os.Stat(path)
		if resolveErr != nil {
			// Dangling link: describe the link itself and mark it broken.
			created, hiddenFlag := platformStat(linkInfo)
			return FileItem{
				Path: path, Name: name, Size: linkInfo.Size(),
				CreatedAt: created, ModifiedAt: linkInfo.ModTime().UnixMilli(),
				Permissions: linkInfo.Mode().String(),
				Hidden:      hiddenFlag || strings.HasPrefix(name, "."),
				Symlink:     true, SymlinkTarget: target,
				MimeType: "inode/symlink", Broken: true,
			}
		}
		if followSymlinks {
			info = resolved
		}
	}

	created, hiddenFlag := platformStat(info)

	return FileItem{
		Path:          path,
		Name:          name,
		Size:          info.Size(),
		IsDirectory:   info.IsDir(),
		CreatedAt:     created,
		ModifiedAt:    info.ModTime().UnixMilli(),
		Permissions:   info.Mode().String(),
		Hidden:        hiddenFlag || strings.HasPrefix(name, "."),
		Symlink:       isSymlink,
		SymlinkTarget: target,
		MimeType:      mimeTypeFor(name, info.IsDir()),
	}
}

func mimeTypeFor(name string, isDir bool) string {
	if isDir {
		return "inode/directory"
	}
	if detected := mime.TypeByExtension(filepath.Ext(name)); detected != "" {
		if semicolon := strings.IndexByte(detected, ';'); semicolon >= 0 {
			return strings.TrimSpace(detected[:semicolon])
		}
		return detected
	}
	return "application/octet-stream"
}
