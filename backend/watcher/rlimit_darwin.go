//go:build darwin

package watcher

import "syscall"

// raiseFileLimit lifts the soft descriptor limit toward the hard one.
//
// macOS uses kqueue, and fsnotify's kqueue backend holds a file descriptor for
// every entry in a watched directory. A default soft limit of 256 is exhausted
// by one moderately sized folder, and running out of descriptors does not fail
// politely — unrelated opens start failing too.
//
// Best effort by design: if the limit cannot be raised, watching still works
// for smaller directories and maxEntries keeps the demand bounded.
func raiseFileLimit() {
	var limit syscall.Rlimit
	if err := syscall.Getrlimit(syscall.RLIMIT_NOFILE, &limit); err != nil {
		return
	}
	if limit.Cur >= limit.Max {
		return
	}

	// Darwin rejects RLIM_INFINITY here and caps at kern.maxfilesperproc, so the
	// hard limit is requested rather than something unbounded.
	limit.Cur = limit.Max
	_ = syscall.Setrlimit(syscall.RLIMIT_NOFILE, &limit)
}
