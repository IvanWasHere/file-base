// Package shell exposes macOS shell integration: opening files with their
// default application, opening them with a chosen one, and revealing them in
// Finder.
package shell

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"howett.net/plist"
)

type Shell struct{}

func New() *Shell {
	return &Shell{}
}

// Application is one row of the Open With menu (PLAN.md §M25).
//
// No icon field, deliberately: no menu in this app draws one, and producing it
// would mean decoding .icns or linking AppKit to make this the single menu that
// looks different (§M25 decision 2).
type Application struct {
	// The bundle, e.g. /Applications/Preview.app — what OpenWith is given.
	Path string `json:"path"`
	// What the bundle calls itself, e.g. "Preview".
	Name string `json:"name"`
	// e.g. com.apple.Preview. Empty when the bundle has no Info.plist, which a
	// wrapper script pretending to be an app is allowed to do.
	BundleID string `json:"bundleId"`
	// Whether a double-click would already go here.
	IsDefault bool `json:"isDefault"`
}

// Applications is what ApplicationsFor answers with.
type Applications struct {
	// The file's uniform type identifier, e.g. public.jpeg. The frontend caches
	// the list under this rather than under the path, because every JPEG in a
	// folder has the same handlers (§M25 decision 3). Empty when the system
	// cannot identify the file, which turns the cache into a per-path one.
	UTI string `json:"uti"`
	// Default first, then by name. Never nil, so the frontend renders an empty
	// list rather than a missing one.
	Apps []Application `json:"apps"`
}

// OpenFile hands the path to Launch Services, exactly as double-clicking in
// Finder would.
func (s *Shell) OpenFile(path string) error {
	cleaned := filepath.Clean(path)
	if err := exists(cleaned); err != nil {
		return err
	}
	return launch(cleaned, "open", "--", cleaned)
}

// RevealInFinder opens the enclosing folder with the item selected.
func (s *Shell) RevealInFinder(path string) error {
	cleaned := filepath.Clean(path)
	if err := exists(cleaned); err != nil {
		return err
	}
	return launch(cleaned, "open", "-R", "--", cleaned)
}

// OpenWith opens every path with one application.
//
// The whole selection goes in a single `open -a` rather than one call per file,
// so a dozen photos arrive in one Preview window rather than a dozen
// (§M25 decision 6).
func (s *Shell) OpenWith(paths []string, appPath string) error {
	if len(paths) == 0 {
		return nil
	}

	app := filepath.Clean(appPath)
	if err := exists(app); err != nil {
		return err
	}
	for _, path := range paths {
		if err := exists(filepath.Clean(path)); err != nil {
			return err
		}
	}

	return launch(paths[0], "open", openWithArgs(paths, app)...)
}

// openWithArgs is split out because it is the part worth a test: `--` has to
// separate the application from the files, or a file named "-n" would be read
// as a flag.
func openWithArgs(paths []string, appPath string) []string {
	args := make([]string, 0, len(paths)+3)
	args = append(args, "-a", filepath.Clean(appPath), "--")
	for _, path := range paths {
		args = append(args, filepath.Clean(path))
	}
	return args
}

// ApplicationsFor lists the applications that can open the path.
//
// Empty is a real answer — plenty of types have no registered handler — and is
// reported as an empty list rather than as an error, so the menu can say so.
func (s *Shell) ApplicationsFor(path string) (Applications, error) {
	cleaned := filepath.Clean(path)
	if err := exists(cleaned); err != nil {
		return Applications{}, err
	}

	blob, err := copyApplications(cleaned)
	if err != nil {
		return Applications{}, shellError("unknown", cleaned, err.Error())
	}
	return applications(blob)
}

// answer mirrors the dictionary fb_application_urls builds.
type answer struct {
	UTI        string   `plist:"uti"`
	Default    string   `plist:"default"`
	Candidates []string `plist:"candidates"`
}

// applications turns the property list into the rows the menu draws.
//
// Everything except the twenty lines of C lives here, on a decoded struct, so
// the ordering, the de-duplication and the naming are testable from a plist
// built by hand.
func applications(blob []byte) (Applications, error) {
	var decoded answer
	if _, err := plist.Unmarshal(blob, &decoded); err != nil {
		return Applications{}, shellError("unknown", "", err.Error())
	}

	preferred := filepath.Clean(decoded.Default)
	apps := make([]Application, 0, len(decoded.Candidates))
	seen := make(map[string]bool, len(decoded.Candidates))

	// The default is not always in the candidate list — a handler registered
	// for the type but since deleted leaves one without the other — so it is
	// added first and the loop below skips it as a duplicate.
	for _, candidate := range append([]string{decoded.Default}, decoded.Candidates...) {
		if candidate == "" {
			continue
		}
		path := filepath.Clean(candidate)
		// Launch Services lists a second copy of an application as a second
		// entry, and so it should; the same copy twice is what this drops.
		if seen[path] {
			continue
		}
		seen[path] = true

		info := readInfoPlist(path)
		apps = append(apps, Application{
			Path:      path,
			Name:      appName(info, path),
			BundleID:  stringValue(info, "CFBundleIdentifier"),
			IsDefault: path == preferred && decoded.Default != "",
		})
	}

	// Default first, then alphabetical. Launch Services' own order is its
	// registration order, which reads as random in a menu.
	sort.SliceStable(apps, func(i, j int) bool {
		if apps[i].IsDefault != apps[j].IsDefault {
			return apps[i].IsDefault
		}
		return strings.ToLower(apps[i].Name) < strings.ToLower(apps[j].Name)
	})

	return Applications{UTI: decoded.UTI, Apps: apps}, nil
}

// maxInfoPlist caps what is read from a bundle's Info.plist. Real ones are a
// few kilobytes; anything past this is not a property list worth parsing.
const maxInfoPlist = 1 << 20

// readInfoPlist returns a bundle's Info.plist as a map, or nil.
//
// Every failure is nil rather than an error: a bundle with no readable
// Info.plist is still an application Launch Services offered, and it should
// appear in the menu under its folder name rather than not at all.
func readInfoPlist(appPath string) map[string]any {
	target := filepath.Join(appPath, "Contents", "Info.plist")

	info, err := os.Stat(target)
	if err != nil || info.Size() > maxInfoPlist {
		return nil
	}
	blob, err := os.ReadFile(target)
	if err != nil {
		return nil
	}

	var decoded map[string]any
	if _, err := plist.Unmarshal(blob, &decoded); err != nil {
		return nil
	}
	return decoded
}

// appName is what the menu row says: the bundle's name on disk, without its
// extension.
//
// Not CFBundleDisplayName, which was the first attempt and was wrong in the
// running app (PLAN.md §M25 decision 2). "Visual Studio Code.app" introduces
// itself in its Info.plist as "Code", and three other places in this app would
// have gone on calling it Visual Studio Code: the folder listing the user
// right-clicked from, the picker's All Applications list, and Finder's own
// Open With menu beside it. A file explorer names a bundle the way it names
// every other item — by what it is called on disk.
//
// Info.plist is the fallback rather than the source, for the bundle that is not
// named `.app` at all.
func appName(info map[string]any, path string) string {
	if name := strings.TrimSuffix(filepath.Base(path), ".app"); name != "" && name != "/" {
		return name
	}
	for _, key := range []string{"CFBundleDisplayName", "CFBundleName"} {
		if name := stringValue(info, key); name != "" {
			return name
		}
	}
	return filepath.Base(path)
}

func stringValue(info map[string]any, key string) string {
	text, ok := info[key].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

// exists is the check every call here shares: `open` reports a missing file
// with an exit status and a sentence, and "not-found" is a case the frontend
// already knows how to phrase.
func exists(path string) error {
	if _, err := os.Lstat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return shellError("not-found", path, "The item no longer exists")
		}
		return shellError("unknown", path, err.Error())
	}
	return nil
}

func launch(path string, name string, args ...string) error {
	// `open` returns as soon as Launch Services accepts the request, so this
	// does not block on the target application starting.
	if output, err := exec.Command(name, args...).CombinedOutput(); err != nil {
		message := string(output)
		if message == "" {
			message = err.Error()
		}
		return shellError("unknown", filepath.Clean(path), message)
	}
	return nil
}

// Mirrors the encoding in backend/filesystem/errors.go so the frontend bridge
// parses both with the same code path.
func shellError(code, path, message string) error {
	encoded, err := json.Marshal(map[string]string{
		"code": code, "path": path, "message": message,
	})
	if err != nil {
		return errors.New(message)
	}
	return errors.New("fs-error:" + string(encoded))
}
