//go:build darwin

package filesystem

import (
	"errors"

	"golang.org/x/sys/unix"
)

// The extended-attribute half of Finder tags, kept beside stat_darwin.go for
// the same reason: it is the one part of the feature that is macOS syscalls
// rather than data.
//
// Note the absence of unix.XATTR_NOFOLLOW everywhere below. Tags follow the
// symlink, deliberately: Finder tags the *file*, and a tagged alias whose
// target shows nothing would be a tag the user cannot see from the folder the
// file actually lives in.

// firstRead is the buffer a tag attribute is first read into. Finder's own tag
// lists are a few dozen bytes; a size query followed by a second read would
// double the syscalls per directory entry to save a stack allocation.
const firstRead = 1024

// readTagsAttr returns the raw property list, or nil when there is none.
//
// ENOATTR — the overwhelmingly common case, since most files have no tags — is
// reported as "no attribute" rather than as an error, so the caller does not
// have to know the errno.
func readTagsAttr(path string) ([]byte, error) {
	buffer := make([]byte, firstRead)

	size, err := unix.Getxattr(path, tagsAttr, buffer)
	if errors.Is(err, unix.ERANGE) {
		// Longer than the first guess: ask how long, then read exactly that.
		// Two syscalls, but only for the rare file with many tags.
		size, err = unix.Getxattr(path, tagsAttr, nil)
		if err != nil {
			return nil, ignoreMissingAttr(err)
		}
		buffer = make([]byte, size)
		size, err = unix.Getxattr(path, tagsAttr, buffer)
	}
	if err != nil {
		return nil, ignoreMissingAttr(err)
	}
	return buffer[:size], nil
}

func writeTagsAttr(path string, data []byte) error {
	return unix.Setxattr(path, tagsAttr, data, 0)
}

// clearTagsAttr removes the attribute, treating "there was none" as success:
// untagging an untagged file is what the user asked for either way.
func clearTagsAttr(path string) error {
	return ignoreMissingAttr(unix.Removexattr(path, tagsAttr))
}

func ignoreMissingAttr(err error) error {
	if errors.Is(err, unix.ENOATTR) {
		return nil
	}
	return err
}
