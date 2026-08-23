package filesystem

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"howett.net/plist"
)

// Tag is one Finder tag: a name and a slot in Finder's colour palette.
//
// The pair is what macOS itself stores. A tag with the same name and a
// different colour is the *same* tag as far as Finder is concerned — the colour
// travels with the name, which is why "Red" is a name rather than a colour, and
// why a user can rename Finder's red tag to "Urgent" and keep the dot.
type Tag struct {
	Name string `json:"name"`
	// Color is Finder's palette index: 0 none, 1 grey, 2 green, 3 purple,
	// 4 blue, 5 yellow, 6 red, 7 orange. Reported as the number rather than as
	// a colour name, because the number is what is on disk — translating it to
	// a swatch is a UI decision (PLAN.md §1).
	Color int `json:"color"`
}

// tagsAttr is where Finder keeps tags: an extended attribute holding a property
// list of strings, each "Name" or "Name\nColorIndex".
//
// The same data Finder's own Tags submenu writes, so a tag set here appears in
// Finder without a relaunch and vice versa. There is no API for this that does
// not go through Foundation; the xattr *is* the interface.
const tagsAttr = "com.apple.metadata:_kMDItemUserTags"

// maxColor is the highest palette index Finder draws. Anything above it would
// render as no colour at all, so it is clamped on the way in.
const maxColor = 7

// ReadTags returns the Finder tags on path, newest-first as stored.
//
// Exported for the frontend's benefit only in the sense that FileItem carries
// the same values; the listing already includes them, so the UI rarely needs
// this call.
func (f *FS) ReadTags(path string) ([]Tag, error) {
	if _, err := os.Lstat(path); err != nil {
		return nil, wrap(path, err)
	}
	return readTags(path), nil
}

// SetTags replaces the tag set on every path with tags.
//
// Replaces rather than merges: the dialog that calls this shows the union of
// what is selected and lets the user edit it, so a merge would make unticking a
// tag impossible. An empty list removes the attribute entirely rather than
// writing an empty array, which is what Finder does — an empty array would
// leave a file carrying metadata that says nothing.
//
// Every path is attempted even after one fails, so a selection containing one
// read-only file still gets tagged everywhere else; the first failure is
// returned once the rest are done.
func (f *FS) SetTags(paths []string, tags []Tag) error {
	normalised := NormaliseTags(tags)

	var failure error
	for _, path := range paths {
		var err error
		if len(normalised) == 0 {
			err = clearTagsAttr(path)
		} else {
			var encoded []byte
			if encoded, err = encodeTags(normalised); err == nil {
				err = writeTagsAttr(path, encoded)
			}
		}
		if err != nil && failure == nil {
			failure = wrap(path, err)
		}
	}
	return failure
}

// NormaliseTags trims, drops blanks, clamps colours into the palette and
// collapses duplicate names, keeping the first spelling of each.
//
// Applied on the way to disk rather than trusted from the caller: the frontend
// normalises too, but this is what actually writes the file, and a tag named
// " " or coloured 42 is a file Finder renders oddly forever.
func NormaliseTags(tags []Tag) []Tag {
	result := make([]Tag, 0, len(tags))
	seen := make(map[string]bool, len(tags))

	for _, tag := range tags {
		name := strings.TrimSpace(tag.Name)
		if name == "" {
			continue
		}
		// Case-insensitively, because Finder treats "Work" and "work" as one
		// tag and shows whichever spelling was typed first.
		key := strings.ToLower(name)
		if seen[key] {
			continue
		}
		seen[key] = true

		color := tag.Color
		if color < 0 || color > maxColor {
			color = 0
		}
		result = append(result, Tag{Name: name, Color: color})
	}
	return result
}

// readTags is the best-effort form used while listing a directory.
//
// A file with no tags, an unreadable attribute or a property list written by
// something else all mean the same thing to a listing — no tags — and none of
// them should make an entry fail to render.
func readTags(path string) []Tag {
	raw, err := readTagsAttr(path)
	if err != nil || len(raw) == 0 {
		return nil
	}
	return decodeTags(raw)
}

// decodeTags parses the property list Finder writes.
//
// Both spellings are accepted: "Name" (what older systems wrote for an
// uncoloured tag) and "Name\n6". An entry whose index is not a number keeps its
// name and loses its colour, rather than being dropped — the name is the part
// the user typed.
func decodeTags(raw []byte) []Tag {
	var entries []string
	if _, err := plist.Unmarshal(raw, &entries); err != nil {
		return nil
	}

	tags := make([]Tag, 0, len(entries))
	for _, entry := range entries {
		name, index, split := strings.Cut(entry, "\n")
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}

		color := 0
		if split {
			if parsed, err := strconv.Atoi(strings.TrimSpace(index)); err == nil {
				if parsed >= 0 && parsed <= maxColor {
					color = parsed
				}
			}
		}
		tags = append(tags, Tag{Name: name, Color: color})
	}
	if len(tags) == 0 {
		return nil
	}
	return tags
}

// encodeTags writes the binary property list Finder itself writes.
//
// Binary rather than XML: macOS reads either, but Finder round-trips binary,
// and matching it byte-for-byte in shape means a file tagged here is
// indistinguishable from one tagged in Finder.
//
// The colour index is always written, even when it is zero. Finder does the
// same, and the alternative — omitting it — is the older spelling this decodes
// but does not produce.
func encodeTags(tags []Tag) ([]byte, error) {
	entries := make([]string, 0, len(tags))
	for _, tag := range tags {
		entries = append(entries, fmt.Sprintf("%s\n%d", tag.Name, tag.Color))
	}
	return plist.Marshal(entries, plist.BinaryFormat)
}
