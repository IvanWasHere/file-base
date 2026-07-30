// Package shell exposes macOS shell integration: opening files with their
// default application and revealing them in Finder.
package shell

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
)

type Shell struct{}

func New() *Shell {
	return &Shell{}
}

// OpenFile hands the path to Launch Services, exactly as double-clicking in
// Finder would.
func (s *Shell) OpenFile(path string) error {
	return run(path, "open", "--", filepath.Clean(path))
}

// RevealInFinder opens the enclosing folder with the item selected.
func (s *Shell) RevealInFinder(path string) error {
	return run(path, "open", "-R", "--", filepath.Clean(path))
}

// OpenWith opens a path using a specific application bundle.
func (s *Shell) OpenWith(path string, appPath string) error {
	return run(path, "open", "-a", filepath.Clean(appPath), "--", filepath.Clean(path))
}

func run(path string, name string, args ...string) error {
	cleaned := filepath.Clean(path)
	if _, err := os.Lstat(cleaned); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return shellError("not-found", cleaned, "The item no longer exists")
		}
		return shellError("unknown", cleaned, err.Error())
	}

	// `open` returns as soon as Launch Services accepts the request, so this
	// does not block on the target application starting.
	if output, err := exec.Command(name, args...).CombinedOutput(); err != nil {
		message := string(output)
		if message == "" {
			message = err.Error()
		}
		return shellError("unknown", cleaned, message)
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
