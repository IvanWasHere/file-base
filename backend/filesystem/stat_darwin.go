//go:build darwin

package filesystem

import (
	"io/fs"
	"syscall"
)

// UF_HIDDEN — the per-file "hidden" flag Finder honours. A file can be hidden
// without a leading dot (e.g. /Volumes on a stock install), so both are checked.
const flagHidden = 0x8000

// platformStat pulls the macOS-only bits out of a FileInfo: creation time and
// the hidden flag. Both are reported, not interpreted — whether a hidden file
// is *shown* is a frontend decision.
func platformStat(info fs.FileInfo) (createdAtMillis int64, hiddenFlag bool) {
	raw, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return info.ModTime().UnixMilli(), false
	}

	created := raw.Birthtimespec.Sec*1000 + raw.Birthtimespec.Nsec/1_000_000
	if created <= 0 {
		created = info.ModTime().UnixMilli()
	}
	return created, raw.Flags&flagHidden != 0
}

// Mount flags from <sys/mount.h>.
const (
	mntRemovable  = 0x00000200 // media can be ejected
	mntDontBrowse = 0x00100000 // not shown in Finder (system/helper volumes)
)

type volumeStat struct {
	Total     uint64
	Free      uint64
	Removable bool
	// Browsable mirrors Finder: a nobrowse mount is machinery, not a place.
	Browsable bool
}

// statVolume reports capacity and mount flags for the filesystem at path.
func statVolume(path string) (volumeStat, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return volumeStat{}, err
	}

	blockSize := uint64(stat.Bsize)
	return volumeStat{
		Total: stat.Blocks * blockSize,
		// Bavail, not Bfree: Bfree counts blocks reserved for root that an
		// ordinary user cannot actually use, which would overstate free space.
		Free:      stat.Bavail * blockSize,
		Removable: stat.Flags&mntRemovable != 0,
		Browsable: stat.Flags&mntDontBrowse == 0,
	}, nil
}
