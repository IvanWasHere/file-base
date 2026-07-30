package filesystem

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"syscall"
)

// Wails v2 marshals a returned error to JavaScript as its Error() string, which
// would leave the frontend pattern-matching on English prose. Instead every
// error leaves Go as a JSON payload behind this sentinel prefix, and the bridge
// adapter parses it back into a typed FsError.
//
// Choosing the code is classification, not policy: Go reports *what* the OS
// said, the frontend decides what to do about it.
const errorPrefix = "fs-error:"

type errorPayload struct {
	Code    string `json:"code"`
	Path    string `json:"path"`
	Message string `json:"message"`
}

// Codes mirror FsErrorCode in frontend/src/types/errors.ts.
const (
	codePermissionDenied  = "permission-denied"
	codeNotFound          = "not-found"
	codeAlreadyExists     = "already-exists"
	codeNotADirectory     = "not-a-directory"
	codeDirectoryNotEmpty = "directory-not-empty"
	codeDiskUnavailable   = "disk-unavailable"
	codeNoSpace           = "no-space"
	codeReadOnly          = "read-only"
	codeUnknown           = "unknown"
)

func wrap(path string, err error) error {
	if err == nil {
		return nil
	}
	payload := errorPayload{Code: classify(err), Path: path, Message: err.Error()}
	encoded, marshalErr := json.Marshal(payload)
	if marshalErr != nil {
		return err
	}
	return errors.New(errorPrefix + string(encoded))
}

func newError(code, path, message string) error {
	encoded, err := json.Marshal(errorPayload{Code: code, Path: path, Message: message})
	if err != nil {
		return errors.New(message)
	}
	return errors.New(errorPrefix + string(encoded))
}

func classify(err error) string {
	switch {
	case errors.Is(err, fs.ErrPermission), errors.Is(err, syscall.EACCES), errors.Is(err, syscall.EPERM):
		// On macOS this is usually a declined TCC consent prompt rather than a
		// Unix mode problem; the frontend surfaces a Privacy & Security hint.
		return codePermissionDenied
	case errors.Is(err, fs.ErrNotExist), errors.Is(err, syscall.ENOENT):
		return codeNotFound
	case errors.Is(err, fs.ErrExist), errors.Is(err, syscall.EEXIST):
		return codeAlreadyExists
	case errors.Is(err, syscall.ENOTDIR):
		return codeNotADirectory
	case errors.Is(err, syscall.ENOTEMPTY):
		return codeDirectoryNotEmpty
	case errors.Is(err, syscall.ENOSPC), errors.Is(err, syscall.EDQUOT):
		return codeNoSpace
	case errors.Is(err, syscall.EROFS):
		return codeReadOnly
	case errors.Is(err, syscall.EIO), errors.Is(err, syscall.ENXIO), errors.Is(err, syscall.ENODEV):
		return codeDiskUnavailable
	}

	var pathErr *os.PathError
	if errors.As(err, &pathErr) && pathErr.Err != nil {
		if code := classify(pathErr.Err); code != codeUnknown {
			return code
		}
	}
	return codeUnknown
}
