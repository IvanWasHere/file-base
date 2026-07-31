package filesystem

// Mutating filesystem operations (PLAN.md M6).
//
// The same rule as the read side holds: Go performs, it does not decide. The
// caller supplies an explicit conflict policy per call; Go never prompts, never
// picks a winner, and never asks whether a delete should have been a trash.
//
// Batch calls (Move, Copy) are deliberately partial-tolerant: one unreadable
// source must not abandon the other nine. Per-item outcomes come back in
// OpResult rather than as a returned error, and only a failure that invalidates
// the whole call — a destination that is not a directory — is an error.

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
)

// Conflict policies. The frontend sends one of these strings with every
// Move/Copy; deciding *which* is a UI concern (PLAN.md §1).
const (
	// PolicyReplace overwrites the existing destination entry.
	PolicyReplace = "replace"
	// PolicySkip leaves the existing entry alone and reports nothing.
	PolicySkip = "skip"
	// PolicyKeepBoth renames the incoming item Finder-style ("x copy.txt").
	PolicyKeepBoth = "keep-both"
	// PolicyFail collects the collision in OpResult.Conflicts so the frontend
	// can ask the user. This is the default for an unrecognised policy — an
	// unknown string must never be interpreted as permission to overwrite.
	PolicyFail = "fail"
)

// OpFailure is one item that could not be processed. Mirrors OperationResult
// in frontend/src/types/file.ts.
type OpFailure struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// OpMoved pairs a source with where it ended up.
//
// Both halves are reported because they cannot be derived from each other: a
// keep-both resolution renames the item, and a batch containing skips cannot be
// zipped back against its input. Undo needs the exact pairing.
type OpMoved struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

// OpResult reports per-item outcomes of a batch operation. Every source appears
// in exactly one of the three slices, except under PolicySkip where a skipped
// collision appears in none.
type OpResult struct {
	Succeeded []OpMoved   `json:"succeeded"`
	Conflicts []string    `json:"conflicts"`
	Failures  []OpFailure `json:"failures"`
}

func newOpResult() OpResult {
	// Non-nil slices: Wails marshals a nil slice to JSON null, which would make
	// the frontend guard every `.length` read.
	return OpResult{Succeeded: []OpMoved{}, Conflicts: []string{}, Failures: []OpFailure{}}
}

// CreateFolder creates a single directory inside parent.
func (f *FS) CreateFolder(parent string, name string) (FileItem, error) {
	path, err := childPath(parent, name)
	if err != nil {
		return FileItem{}, err
	}
	// os.Mkdir already fails with EEXIST; classify() maps that to already-exists.
	if err := os.Mkdir(path, 0o755); err != nil {
		return FileItem{}, wrap(path, err)
	}
	return describe(path, false), nil
}

// CreateFile creates an empty file inside parent.
func (f *FS) CreateFile(parent string, name string) (FileItem, error) {
	path, err := childPath(parent, name)
	if err != nil {
		return FileItem{}, err
	}
	// O_EXCL makes the exists-check atomic; a separate Lstat first would race.
	handle, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return FileItem{}, wrap(path, err)
	}
	if err := handle.Close(); err != nil {
		return FileItem{}, wrap(path, err)
	}
	return describe(path, false), nil
}

// Rename changes an item's name in place. newName is a bare name, not a path —
// moving between directories is Move's job.
func (f *FS) Rename(path string, newName string) (FileItem, error) {
	cleaned := filepath.Clean(path)
	if err := validateName(newName, cleaned); err != nil {
		return FileItem{}, err
	}
	if _, err := os.Lstat(cleaned); err != nil {
		return FileItem{}, wrap(cleaned, err)
	}

	target := filepath.Join(filepath.Dir(cleaned), newName)
	if target == cleaned {
		return describe(cleaned, false), nil
	}

	// APFS is case-insensitive by default, so "notes" -> "Notes" finds itself
	// and would look like a collision. A case-only rename is always allowed;
	// os.Rename performs it correctly.
	if !strings.EqualFold(target, cleaned) {
		if _, err := os.Lstat(target); err == nil {
			return FileItem{}, newError(codeAlreadyExists, target, newName+" already exists")
		}
	}

	if err := os.Rename(cleaned, target); err != nil {
		return FileItem{}, wrap(cleaned, err)
	}
	return describe(target, false), nil
}

// Move relocates sources into destDir, falling back to copy-then-delete when
// the two sit on different volumes (os.Rename cannot cross a mount point).
func (f *FS) Move(sources []string, destDir string, policy string) (OpResult, error) {
	return transfer(sources, destDir, policy, moveOne)
}

// Copy duplicates sources into destDir. Symlinks are recreated as symlinks
// rather than followed — copying an alias should not silently inline gigabytes,
// and a link pointing into its own subtree would otherwise recurse forever.
func (f *FS) Copy(sources []string, destDir string, policy string) (OpResult, error) {
	return transfer(sources, destDir, policy, copyOne)
}

// TrashedItem records where an item came from and where it went, which is what
// makes "Undo Move to Trash" possible: macOS stores its own Put Back mapping in
// metadata this package does not write, so the mapping is returned instead.
type TrashedItem struct {
	OriginalPath string `json:"originalPath"`
	TrashPath    string `json:"trashPath"`
}

// Trash moves items to the trash of the volume they live on, which is what
// makes them restorable and keeps the operation off the slow cross-volume path.
//
// Deliberately not implemented via `osascript`/Finder: that would need an
// Automation consent prompt and would fail whenever Finder is not running.
//
// Failure is reported on the first item that fails. Items already moved are
// returned alongside the error, so the frontend can still offer to undo them
// rather than losing track of what it just did.
func (f *FS) Trash(paths []string) ([]TrashedItem, error) {
	trashed := []TrashedItem{}

	for _, path := range paths {
		cleaned := filepath.Clean(path)
		info, err := os.Lstat(cleaned)
		if err != nil {
			return trashed, wrap(cleaned, err)
		}
		if err := guardCriticalPath(cleaned); err != nil {
			return trashed, err
		}

		trashDir, err := trashDirFor(cleaned)
		if err != nil {
			return trashed, wrap(cleaned, err)
		}
		name, err := availableName(trashDir, filepath.Base(cleaned))
		if err != nil {
			return trashed, err
		}

		target := filepath.Join(trashDir, name)
		if err := relocate(cleaned, target, info); err != nil {
			return trashed, wrap(cleaned, err)
		}
		trashed = append(trashed, TrashedItem{OriginalPath: cleaned, TrashPath: target})
	}

	return trashed, nil
}

// Delete removes items permanently. Directories are removed with their
// contents. The confirmation prompt is the frontend's responsibility.
func (f *FS) Delete(paths []string) error {
	for _, path := range paths {
		cleaned := filepath.Clean(path)
		if err := guardCriticalPath(cleaned); err != nil {
			return err
		}
		if err := os.RemoveAll(cleaned); err != nil {
			return wrap(cleaned, err)
		}
	}
	return nil
}

// transfer is the shared skeleton of Move and Copy: validate the destination
// once, then apply the conflict policy per source and hand the resolved
// source/target pair to apply.
func transfer(
	sources []string,
	destDir string,
	policy string,
	apply func(source, target string, info fs.FileInfo) error,
) (OpResult, error) {
	result := newOpResult()

	destination := filepath.Clean(destDir)
	destInfo, err := os.Stat(destination)
	if err != nil {
		return result, wrap(destination, err)
	}
	if !destInfo.IsDir() {
		return result, newError(codeNotADirectory, destination, "The destination is not a folder")
	}

	for _, source := range sources {
		cleaned := filepath.Clean(source)

		info, err := os.Lstat(cleaned)
		if err != nil {
			result.Failures = append(result.Failures, OpFailure{cleaned, describeError(err)})
			continue
		}
		// A directory cannot absorb itself. Checked for copy as well as move:
		// copying a folder into its own subtree would grow without terminating.
		if info.IsDir() && isWithin(cleaned, destination) {
			result.Failures = append(result.Failures, OpFailure{
				cleaned, "A folder cannot be moved into itself",
			})
			continue
		}

		name := filepath.Base(cleaned)
		target := filepath.Join(destination, name)

		if target == cleaned {
			// Same folder. Only keep-both is meaningful — that is Duplicate.
			// Any other policy here would ask us to replace an item with itself.
			if policy != PolicyKeepBoth {
				result.Succeeded = append(result.Succeeded, OpMoved{cleaned, cleaned})
				continue
			}
		}

		if _, err := os.Lstat(target); err == nil {
			switch policy {
			case PolicySkip:
				continue
			case PolicyReplace:
				if err := os.RemoveAll(target); err != nil {
					result.Failures = append(result.Failures, OpFailure{cleaned, describeError(err)})
					continue
				}
			case PolicyKeepBoth:
				available, err := availableName(destination, name)
				if err != nil {
					result.Failures = append(result.Failures, OpFailure{cleaned, describeError(err)})
					continue
				}
				target = filepath.Join(destination, available)
			default:
				// PolicyFail and anything unrecognised. Defaulting an unknown
				// policy to "ask" rather than "overwrite" keeps a typo from
				// destroying data.
				result.Conflicts = append(result.Conflicts, cleaned)
				continue
			}
		}

		if err := apply(cleaned, target, info); err != nil {
			result.Failures = append(result.Failures, OpFailure{cleaned, describeError(err)})
			continue
		}
		result.Succeeded = append(result.Succeeded, OpMoved{cleaned, target})
	}

	return result, nil
}

func moveOne(source, target string, info fs.FileInfo) error {
	return relocate(source, target, info)
}

func copyOne(source, target string, info fs.FileInfo) error {
	return copyTree(source, target, info)
}

// relocate renames when it can and copies-then-removes when it cannot. Only
// EXDEV justifies the slow path: every other error is a real failure and must
// not be retried as a copy.
func relocate(source, target string, info fs.FileInfo) error {
	err := os.Rename(source, target)
	if err == nil {
		return nil
	}
	if !errors.Is(err, syscall.EXDEV) {
		return err
	}

	if err := copyTree(source, target, info); err != nil {
		// Leave no half-written duplicate behind after a failed cross-volume
		// move; the source is still intact, so this is recoverable.
		_ = os.RemoveAll(target)
		return err
	}
	return os.RemoveAll(source)
}

// copyTree copies a file, symlink or directory tree, preserving permissions and
// modification times.
func copyTree(source, target string, info fs.FileInfo) error {
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		destination, err := os.Readlink(source)
		if err != nil {
			return err
		}
		return os.Symlink(destination, target)

	case info.IsDir():
		if err := os.Mkdir(target, info.Mode().Perm()); err != nil && !errors.Is(err, fs.ErrExist) {
			return err
		}
		entries, err := os.ReadDir(source)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			childInfo, err := entry.Info()
			if err != nil {
				return err
			}
			child := filepath.Join(source, entry.Name())
			if err := copyTree(child, filepath.Join(target, entry.Name()), childInfo); err != nil {
				return err
			}
		}
		// After the children: writing into a directory bumps its mtime, so this
		// has to come last or it would be immediately overwritten.
		return os.Chtimes(target, info.ModTime(), info.ModTime())

	case info.Mode().IsRegular():
		return copyFile(source, target, info)

	default:
		// Sockets, devices, FIFOs. Recreating them is not something a file
		// explorer should attempt.
		return fmt.Errorf("%s is not a regular file", filepath.Base(source))
	}
}

func copyFile(source, target string, info fs.FileInfo) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()

	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, info.Mode().Perm())
	if err != nil {
		return err
	}

	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		_ = os.Remove(target)
		return err
	}
	// Closed explicitly rather than deferred: a write error surfaces at close on
	// some filesystems, and a deferred close would swallow it.
	if err := out.Close(); err != nil {
		_ = os.Remove(target)
		return err
	}
	return os.Chtimes(target, info.ModTime(), info.ModTime())
}

// childPath validates a new item's name and returns its full path.
func childPath(parent string, name string) (string, error) {
	cleanedParent := filepath.Clean(parent)
	if err := validateName(name, cleanedParent); err != nil {
		return "", err
	}
	info, err := os.Stat(cleanedParent)
	if err != nil {
		return "", wrap(cleanedParent, err)
	}
	if !info.IsDir() {
		return "", newError(codeNotADirectory, cleanedParent, "The destination is not a folder")
	}
	return filepath.Join(cleanedParent, name), nil
}

// validateName rejects anything that is not a plain file name. Without this a
// "name" of "../../etc" would let the frontend write outside the folder the
// user is looking at.
func validateName(name string, path string) error {
	switch {
	case strings.TrimSpace(name) == "":
		return newError(codeInvalidName, path, "The name cannot be empty")
	case name == "." || name == "..":
		return newError(codeInvalidName, path, "That name is reserved")
	case strings.ContainsRune(name, '/'):
		return newError(codeInvalidName, path, "A name cannot contain \"/\"")
	case strings.ContainsRune(name, 0):
		return newError(codeInvalidName, path, "A name cannot contain a null character")
	// HFS+/APFS cap a single component at 255 bytes; failing here gives a clear
	// message instead of ENAMETOOLONG from deep inside a syscall.
	case len(name) > 255:
		return newError(codeInvalidName, path, "That name is too long")
	}
	return nil
}

var copyCounterPattern = regexp.MustCompile(`^(.*) copy(?: (\d+))?$`)

// availableName mirrors nextAvailableName in frontend/src/utils/path.ts —
// "Report.pdf" -> "Report copy.pdf" -> "Report copy 2.pdf". The two must agree,
// because the frontend previews the resulting name before the call and Go
// produces it during the call.
func availableName(dir string, name string) (string, error) {
	if _, err := os.Lstat(filepath.Join(dir, name)); err != nil {
		return name, nil
	}

	base, extension := splitExtension(name)
	root := base
	if match := copyCounterPattern.FindStringSubmatch(base); match != nil {
		root = match[1]
	}

	candidate := root + " copy" + extension
	for counter := 2; counter < 10_000; counter++ {
		if _, err := os.Lstat(filepath.Join(dir, candidate)); err != nil {
			return candidate, nil
		}
		candidate = root + " copy " + strconv.Itoa(counter) + extension
	}
	return "", newError(codeAlreadyExists, filepath.Join(dir, name), "No free name is available")
}

// splitExtension mirrors extname() in frontend/src/utils/path.ts: a leading dot
// starts a hidden name, it does not start an extension. filepath.Ext disagrees
// (it calls ".gitignore" an extension), which would rename the file to
// " copy.gitignore".
func splitExtension(name string) (base string, extension string) {
	index := strings.LastIndex(name, ".")
	if index <= 0 {
		return name, ""
	}
	return name[:index], name[index:]
}

// isWithin reports whether child is ancestor itself or sits beneath it.
func isWithin(ancestor, child string) bool {
	if ancestor == child {
		return true
	}
	return strings.HasPrefix(child, strings.TrimSuffix(ancestor, "/")+"/")
}

// guardCriticalPath refuses to delete a volume root or a home directory. These
// are reachable in the UI, and a mis-aimed recursive delete on one of them is
// not something a confirmation dialog can undo.
func guardCriticalPath(path string) error {
	if path == "/" || path == "." {
		return newError(codeInvalidName, path, "Refusing to delete the volume root")
	}
	if home, err := os.UserHomeDir(); err == nil && filepath.Clean(home) == path {
		return newError(codeInvalidName, path, "Refusing to delete the home folder")
	}
	if mount, err := mountPoint(path); err == nil && mount == path {
		return newError(codeInvalidName, path, "Refusing to delete a volume root")
	}
	return nil
}

// trashDirFor resolves the trash that serves path's volume: ~/.Trash for the
// boot volume, /Volumes/<name>/.Trashes/<uid> for anything else. Using the
// volume's own trash keeps the operation a rename rather than a full copy.
//
// The boot volume is identified by comparing mount points with the home
// directory rather than by testing for "/". Since macOS Catalina the boot disk
// is two volumes — a read-only "/" and the writable "/System/Volumes/Data" that
// home is firmlinked from — so a user's file never reports "/" as its mount.
func trashDirFor(path string) (string, error) {
	home, homeErr := os.UserHomeDir()
	homeTrash := ""
	if homeErr == nil {
		homeTrash = filepath.Join(home, ".Trash")
	}

	mount, err := mountPoint(path)
	if err != nil || mount == "/" {
		return ensureDir(homeTrash, 0o700, homeErr)
	}
	if homeErr == nil {
		if homeMount, homeMountErr := mountPoint(home); homeMountErr == nil && homeMount == mount {
			return ensureDir(homeTrash, 0o700, nil)
		}
	}

	// Per-user trash on a secondary volume; 0700 is what macOS itself uses.
	volumeTrash := filepath.Join(mount, ".Trashes", strconv.Itoa(os.Getuid()))
	if created, err := ensureDir(volumeTrash, 0o700, nil); err == nil {
		return created, nil
	}
	// Read-only or permission-blocked volume: fall back to the home trash and
	// accept the cross-volume copy. Better a slow trash than a failed one.
	return ensureDir(homeTrash, 0o700, homeErr)
}

func ensureDir(path string, mode fs.FileMode, prior error) (string, error) {
	if prior != nil {
		return "", prior
	}
	if path == "" {
		return "", errors.New("no trash directory is available")
	}
	if err := os.MkdirAll(path, mode); err != nil {
		return "", err
	}
	return path, nil
}

// describeError unwraps the syscall noise os.Rename and friends add, so the
// per-item message in OpResult reads as a sentence rather than a stack of paths.
func describeError(err error) string {
	var pathErr *os.PathError
	if errors.As(err, &pathErr) {
		return pathErr.Err.Error()
	}
	var linkErr *os.LinkError
	if errors.As(err, &linkErr) {
		return linkErr.Err.Error()
	}
	return err.Error()
}
