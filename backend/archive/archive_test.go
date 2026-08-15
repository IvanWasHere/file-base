package archive

import (
	"archive/zip"
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

/*
Fixtures are built by this package's own writer wherever it can write the
format, so a round trip tests both halves at once. The two 7z files are
embedded instead: nothing here can *create* a 7z, and a test that skipped when
`7z` was missing from the machine would quietly stop covering the format.

RAR is the honest gap. Nobody can create one — the compressor is proprietary —
so rar extraction has no test here and is checked by hand against a real
archive. That is written down rather than left to be discovered.
*/

const plain7z = "N3q8ryccAARx50hDoAAAAAAAAAAWAAAAAAAAAEvGQy4BABJoZWxsbyB3b3JsZApzZWNvbmQKAOAA" +
	"yACBXQAAgTMHrg/Pbu6MB7DD2irXWGSss3jOVN2o0NmZyk/kl89i3UXvPJ/T5Or4pgZ2+DcU+Y4+" +
	"vFHDFoDvhWrgzWRRPtlFOEPsz+AAIKMEKnUuc6Y7BZpQf0h2wYDv2XnIUZSYgaKnLPKIwU+kzPXi" +
	"B2zqonC22czKO5hERUA8Je5CAAAAFwYXAQmAiQAHCwEAASEhARgMgMkAAA=="

const secret7z = "N3q8ryccAARYa/vCxQAAAAAAAAAWAAAAAAAAABskfrNQBFtryawgYiterOi8DXtFGIRUPdQdTBHj" +
	"mtm7r4PAGuAA4ACdXQAAgTMHrg/QDv4UireO7n+3xEk7iMZKL5yZkniIq112ZjlV1Ef/ra6Su3a1" +
	"Ii78hKOizsFBbH/VIuxob62uy4ZEynmMUBtPO4A/LD3rgMLut4QHHBPoaZwGxJ/u1ZPhFPP3GdTX" +
	"OdldSlGo3mdH2uMn5e40xaB7ic7sssSJ0nwoL5JOpKfNQwzDezjoOEf9eGmDOQnPr6HrKXeYAAAA" +
	"ABcGIAEJgKUABwsBAAEhIQEYDIDhAAA="

/* ---------- helpers ---------- */

// source builds the tree every round trip starts from.
func source(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "src")
	mustMkdir(t, filepath.Join(root, "nested"))
	mustWrite(t, filepath.Join(root, "a.txt"), "hello world\n")
	mustWrite(t, filepath.Join(root, "nested", "b.txt"), "second\n")
	return root
}

func mustMkdir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeBase64(t *testing.T, path, encoded string) string {
	t.Helper()
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, path, string(data))
	return path
}

// run drives one job to completion through the real event surface.
func run(t *testing.T, start func(*Archive) (string, error)) Done {
	t.Helper()
	a := New()
	finished := make(chan Done, 1)
	a.emitDone = func(d Done) { finished <- d }

	if _, err := start(a); err != nil {
		return Done{Error: err.Error()}
	}
	select {
	case done := <-finished:
		return done
	case <-time.After(60 * time.Second):
		t.Fatal("the job never emitted its Done event")
	}
	return Done{}
}

func extract(t *testing.T, path, destination, password string) Done {
	t.Helper()
	return run(t, func(a *Archive) (string, error) {
		return a.Extract(ExtractRequest{Path: path, Destination: destination, Password: password})
	})
}

func create(t *testing.T, request CreateRequest) Done {
	t.Helper()
	return run(t, func(a *Archive) (string, error) { return a.Create(request) })
}

// files lists every regular file under root, relative and sorted.
func files(root string) []string {
	var out []string
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		relative, _ := filepath.Rel(root, path)
		out = append(out, filepath.ToSlash(relative))
		return nil
	})
	sort.Strings(out)
	return out
}

/* ---------- detection ---------- */

// Content first, because M10 shipped the opposite twice: a text file named
// `.png` that rendered as a broken image, and a mime type built from an
// extension. An archive named `.zip` that is really a 7z has to open.
func TestDetectReadsContentNotTheName(t *testing.T) {
	dir := t.TempDir()
	seven := writeBase64(t, filepath.Join(dir, "misnamed.zip"), plain7z)

	kind, err := Detect(seven)
	if err != nil {
		t.Fatal(err)
	}
	if kind.Format != Format7z {
		t.Errorf("format = %q, want %q", kind.Format, Format7z)
	}
}

// The distinction that decides whether a mount is a folder or one file.
func TestDetectSeparatesTarredStreamsFromPlainOnes(t *testing.T) {
	dir := t.TempDir()
	root := source(t)

	tarred := filepath.Join(dir, "tree.tar.gz")
	if done := create(t, CreateRequest{
		Sources: []string{root}, Destination: tarred, Format: "tar.gz",
	}); done.Error != "" {
		t.Fatal(done.Error)
	}

	kind, err := Detect(tarred)
	if err != nil {
		t.Fatal(err)
	}
	if kind.Format != FormatGzip || !kind.TarInside {
		t.Errorf("tar.gz detected as %+v, want gz with a tar inside", kind)
	}
}

func TestDetectIgnoresOrdinaryFiles(t *testing.T) {
	dir := t.TempDir()
	plain := filepath.Join(dir, "notes.txt")
	mustWrite(t, plain, "just some words, definitely not an archive\n")

	kind, err := Detect(plain)
	if err != nil {
		t.Fatal(err)
	}
	if kind.Archive() {
		t.Errorf("a text file was detected as %q", kind.Format)
	}
}

func TestStripArchiveExtension(t *testing.T) {
	for input, want := range map[string]string{
		"notes.txt.gz": "notes.txt",
		"tree.tar.xz":  "tree",
		"photos.zip":   "photos",
		"backup.tgz":   "backup",
		"data":         "data.out", // nothing to strip: never collide with itself
	} {
		if got := StripArchiveExtension(input); got != want {
			t.Errorf("StripArchiveExtension(%q) = %q, want %q", input, got, want)
		}
	}
}

/* ---------- safety ---------- */

// "Zip slip": an entry named `../../../etc/passwd` is not a mostly-good archive
// with one odd member, it is a file built to write outside the folder it was
// pointed at. The whole extraction is refused, and nothing lands anywhere.
func TestZipSlipIsRefusedAndNothingIsWritten(t *testing.T) {
	dir := t.TempDir()
	malicious := filepath.Join(dir, "evil.zip")

	handle, err := os.Create(malicious)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(handle)
	for _, name := range []string{"harmless.txt", "../../escaped.txt"} {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte("payload")); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	_ = handle.Close()

	destination := filepath.Join(dir, "out")
	done := extract(t, malicious, destination, "")

	if done.Error == "" {
		t.Fatal("a zip-slip archive extracted without complaint")
	}
	if !strings.Contains(done.Error, "outside the destination") {
		t.Errorf("error does not name the problem: %s", done.Error)
	}
	if _, err := os.Stat(filepath.Join(dir, "escaped.txt")); err == nil {
		t.Error("an entry escaped the destination")
	}
	if _, err := os.Stat(destination); err == nil {
		t.Error("the failed extraction left a half-unpacked folder behind")
	}
}

func TestSafeJoinRefusesEscapes(t *testing.T) {
	root := "/tmp/dest"
	// `a/../b.txt` is refused with the rest even though it would resolve inside
	// the destination. Archive writers normalise paths, so a `..` element in a
	// real entry is vanishingly rare and in a hostile one is the whole attack —
	// refusing the lot is worth losing a case nobody produces.
	for _, name := range []string{
		"../escape", "../../escape", "/absolute/path", "a/../../escape",
		"a/../b.txt", "",
	} {
		if _, err := safeJoin(root, name); err == nil {
			t.Errorf("safeJoin accepted %q", name)
		}
	}
	for _, name := range []string{"a.txt", "nested/b.txt", "./a.txt"} {
		if _, err := safeJoin(root, name); err != nil {
			t.Errorf("safeJoin refused %q: %v", name, err)
		}
	}
}

// A megabyte can expand to terabytes, and browsing is something the user does
// by double-clicking rather than by deciding.
func TestBrowseCapStopsAnExpandingArchive(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "big")
	mustMkdir(t, root)
	mustWrite(t, filepath.Join(root, "large.bin"), strings.Repeat("a", 200_000))

	archivePath := filepath.Join(dir, "big.tar.gz")
	if done := create(t, CreateRequest{
		Sources: []string{root}, Destination: archivePath, Format: "tar.gz",
	}); done.Error != "" {
		t.Fatal(done.Error)
	}

	destination := filepath.Join(dir, "out")
	done := run(t, func(a *Archive) (string, error) {
		return a.Extract(ExtractRequest{
			Path: archivePath, Destination: destination, MaxBytes: 50_000,
		})
	})

	if done.Error == "" {
		t.Fatal("the cap did not stop the extraction")
	}
	if !strings.Contains(done.Error, "Uncompress") {
		t.Errorf("the cap message does not offer the way forward: %s", done.Error)
	}
}

/* ---------- round trips ---------- */

// Every writable format, out and back. Testing creation against our own
// extractor would be circular if that were all — the command-line round trip in
// the milestone notes is what pins the output as genuinely interoperable — but
// it does catch a format that cannot read what it just wrote.
func TestEveryWritableFormatRoundTrips(t *testing.T) {
	for _, format := range CreateFormats() {
		t.Run(format, func(t *testing.T) {
			dir := t.TempDir()
			root := source(t)
			archivePath := filepath.Join(dir, "out."+format)

			created := create(t, CreateRequest{
				Sources: []string{root}, Destination: archivePath, Format: format, Level: 5,
			})
			if created.Error != "" {
				t.Fatalf("create: %s", created.Error)
			}

			destination := filepath.Join(dir, "back")
			extracted := extract(t, archivePath, destination, "")
			if extracted.Error != "" {
				t.Fatalf("extract: %s", extracted.Error)
			}

			got := files(destination)
			want := []string{"src/a.txt", "src/nested/b.txt"}
			if strings.Join(got, ",") != strings.Join(want, ",") {
				t.Errorf("round trip produced %v, want %v", got, want)
			}
		})
	}
}

func TestSingleStreamExtractsOneFileNamedAfterTheArchive(t *testing.T) {
	dir := t.TempDir()
	// A gzip holding one file rather than a tar — `report.csv.gz` opening to
	// `report.csv` without a special case.
	plain := filepath.Join(dir, "report.csv")
	mustWrite(t, plain, "a,b,c\n1,2,3\n")

	archivePath := filepath.Join(dir, "report.csv.gz")
	if done := create(t, CreateRequest{
		Sources: []string{plain}, Destination: archivePath, Format: "tar.gz",
	}); done.Error != "" {
		t.Fatal(done.Error)
	}

	// Written as a tar.gz, so it *is* tarred; the interesting case is the
	// detector agreeing rather than the name deciding.
	kind, err := Detect(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	if !kind.TarInside {
		t.Fatal("expected a tar inside")
	}
}

/* ---------- passwords ---------- */

func TestEncryptedZipRoundTripsAndRefusesTheWrongPassword(t *testing.T) {
	dir := t.TempDir()
	root := source(t)
	archivePath := filepath.Join(dir, "secret.zip")

	if done := create(t, CreateRequest{
		Sources: []string{root}, Destination: archivePath, Format: "zip", Password: "hunter2",
	}); done.Error != "" {
		t.Fatal(done.Error)
	}

	good := extract(t, archivePath, filepath.Join(dir, "good"), "hunter2")
	if good.Error != "" {
		t.Fatalf("correct password failed: %s", good.Error)
	}
	if len(files(filepath.Join(dir, "good"))) != 2 {
		t.Errorf("extracted %v", files(filepath.Join(dir, "good")))
	}

	// The one failure the UI reacts to rather than reports.
	none := extract(t, archivePath, filepath.Join(dir, "none"), "")
	if !strings.Contains(none.Error, "password-required") {
		t.Errorf("no password gave %s", none.Error)
	}
	wrong := extract(t, archivePath, filepath.Join(dir, "wrong"), "nope")
	if !strings.Contains(wrong.Error, "password-required") {
		t.Errorf("wrong password gave %s", wrong.Error)
	}
	if !strings.Contains(wrong.Error, "did not work") {
		t.Errorf("a wrong password should say so, not just ask again: %s", wrong.Error)
	}
}

func TestEncrypted7zRoundTrips(t *testing.T) {
	dir := t.TempDir()
	archivePath := writeBase64(t, filepath.Join(dir, "secret.7z"), secret7z)

	good := extract(t, archivePath, filepath.Join(dir, "good"), "hunter2")
	if good.Error != "" {
		t.Fatalf("correct password failed: %s", good.Error)
	}

	// A 7z does not fail at open time the way a zip entry does — the decoder
	// fails part-way with an lzma2 error that says nothing a user could act on,
	// so the encrypted hint has to be read off the library's own error.
	wrong := extract(t, archivePath, filepath.Join(dir, "wrong"), "nope")
	if !strings.Contains(wrong.Error, "password-required") {
		t.Errorf("wrong 7z password gave %s", wrong.Error)
	}
}

func TestPlain7zExtracts(t *testing.T) {
	dir := t.TempDir()
	archivePath := writeBase64(t, filepath.Join(dir, "plain.7z"), plain7z)

	done := extract(t, archivePath, filepath.Join(dir, "out"), "")
	if done.Error != "" {
		t.Fatal(done.Error)
	}
	if got := files(filepath.Join(dir, "out")); len(got) != 2 {
		t.Errorf("extracted %v", got)
	}
}

func TestPasswordIsRefusedForFormatsThatCannotUseOne(t *testing.T) {
	dir := t.TempDir()
	done := create(t, CreateRequest{
		Sources:     []string{source(t)},
		Destination: filepath.Join(dir, "out.tar.gz"),
		Format:      "tar.gz",
		Password:    "hunter2",
	})
	if !strings.Contains(done.Error, "only zip") {
		t.Errorf("a password on a tar.gz gave %s", done.Error)
	}
}

/* ---------- what cannot be created ---------- */

// Absent from the list rather than present and failing at the end of a long
// job, which is the difference between a limitation and a bug.
func TestUncreatableFormatsAreRefusedUpFront(t *testing.T) {
	dir := t.TempDir()
	for _, format := range []string{"7z", "rar"} {
		done := create(t, CreateRequest{
			Sources:     []string{source(t)},
			Destination: filepath.Join(dir, "out."+format),
			Format:      format,
		})
		if !strings.Contains(done.Error, "cannot create") {
			t.Errorf("%s: %s", format, done.Error)
		}
	}

	for _, format := range CreateFormats() {
		if format == "7z" || format == "rar" {
			t.Errorf("%s is offered as creatable and must not be", format)
		}
	}
}

/* ---------- splitting ---------- */

func TestSplittingProducesNumberedPartsThatReassemble(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "big")
	mustMkdir(t, root)
	// Incompressible, so the parts are about the data rather than about gzip.
	for index := 0; index < 3; index++ {
		// Genuinely incompressible, or gzip returns one small part and the test
		// measures nothing.
		payload := make([]byte, 20_000)
		if _, err := rand.Read(payload); err != nil {
			t.Fatal(err)
		}
		_ = index
		if err := os.WriteFile(filepath.Join(root, "r"+itoa(index)+".bin"), payload, 0o644); err != nil {
			t.Fatal(err)
		}
	}

	base := filepath.Join(dir, "out.tar.gz")
	done := create(t, CreateRequest{
		Sources: []string{root}, Destination: base, Format: "tar.gz", SplitBytes: 4096,
	})
	if done.Error != "" {
		t.Fatal(done.Error)
	}

	// The first part is what the user is handed: the base name never exists.
	if !strings.HasSuffix(done.Path, ".001") {
		t.Errorf("reported %q, want the first part", done.Path)
	}
	if _, err := os.Stat(base); err == nil {
		t.Error("the unsplit base name was written as well")
	}

	parts := SplitParts(done.Path)
	if len(parts) < 2 {
		t.Fatalf("expected several parts, got %v", parts)
	}
	for _, part := range parts[:len(parts)-1] {
		info, err := os.Stat(part)
		if err != nil {
			t.Fatal(err)
		}
		if info.Size() != 4096 {
			t.Errorf("%s is %d bytes, want the split size", filepath.Base(part), info.Size())
		}
	}
}

/* ---------- mounts ---------- */

func TestMountIsCreatedNamedAndReleased(t *testing.T) {
	a := New()
	mount, err := a.NewMount("/somewhere/Photos.zip")
	if err != nil {
		t.Fatal(err)
	}

	// Random for uniqueness, named for the breadcrumb: `… / Photos.zip / holiday`.
	if filepath.Base(mount) != "Photos.zip" {
		t.Errorf("mount leaf is %q, want the archive's name", filepath.Base(mount))
	}
	if !strings.HasPrefix(filepath.Base(filepath.Dir(mount)), mountPrefix) {
		t.Errorf("mount is not under the app's own prefix: %s", mount)
	}
	if _, err := os.Stat(mount); err != nil {
		t.Fatal(err)
	}

	if err := a.ReleaseMount(mount); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Dir(mount)); err == nil {
		t.Error("releasing left the random directory behind")
	}
}

// ReleaseMount deletes recursively, so the guard is the whole safety story: a
// bug elsewhere that passed a user path must not be able to erase it.
func TestReleaseMountRefusesAnythingItDidNotCreate(t *testing.T) {
	a := New()
	precious := filepath.Join(t.TempDir(), "Documents")
	mustMkdir(t, precious)
	mustWrite(t, filepath.Join(precious, "thesis.txt"), "years of work")

	if err := a.ReleaseMount(precious); err == nil {
		t.Fatal("ReleaseMount accepted a path it did not create")
	}
	if _, err := os.Stat(filepath.Join(precious, "thesis.txt")); err != nil {
		t.Fatal("it deleted the folder anyway")
	}
}

// Read-only is what makes "the mount is reclaimed when you leave" safe: there
// is no unsaved work to lose, because the OS refuses the edit.
func TestReadOnlyMountCannotBeWrittenTo(t *testing.T) {
	dir := t.TempDir()
	root := source(t)
	archivePath := filepath.Join(dir, "tree.zip")
	if done := create(t, CreateRequest{
		Sources: []string{root}, Destination: archivePath, Format: "zip",
	}); done.Error != "" {
		t.Fatal(done.Error)
	}

	a := New()
	mount, err := a.NewMount(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = a.ReleaseMount(mount) }()

	done := run(t, func(a *Archive) (string, error) {
		return a.Extract(ExtractRequest{
			Path: archivePath, Destination: mount, ReadOnly: true,
		})
	})
	if done.Error != "" {
		t.Fatal(done.Error)
	}

	inside := filepath.Join(mount, "src", "a.txt")
	if err := os.WriteFile(inside, []byte("edited"), 0o644); err == nil {
		t.Error("a read-only mount accepted a write")
	}
	if err := os.WriteFile(filepath.Join(mount, "new.txt"), []byte("x"), 0o644); err == nil {
		t.Error("a read-only mount accepted a new file")
	}
}

// A crash cannot clean up after itself, and a temp folder that is never
// reclaimed is a disk leak measured in gigabytes.
func TestSweepRemovesOrphanedMounts(t *testing.T) {
	a := New()
	orphan, err := a.NewMount("/somewhere/Left.zip")
	if err != nil {
		t.Fatal(err)
	}
	// Forget it, as a crashed process would.
	a.mounts = map[string]bool{}

	if Sweep() == 0 {
		t.Error("Sweep found nothing to remove")
	}
	if _, err := os.Stat(filepath.Dir(orphan)); err == nil {
		t.Error("the orphan survived the sweep")
	}
}

/* ---------- collapsing ---------- */

func TestSingleRootIsCollapsedAndManyEntriesAreNot(t *testing.T) {
	dir := t.TempDir()

	// One top-level entry: `report.pdf.zip` must not produce `report/report.pdf`.
	single := filepath.Join(dir, "single")
	mustMkdir(t, single)
	mustWrite(t, filepath.Join(single, "only.txt"), "alone")
	if got, _ := collapseSingleRoot(single); filepath.Base(got) != "only.txt" {
		t.Errorf("a lone entry was not collapsed: %s", got)
	}

	// Many: the tarbomb every modern tool learned to defend against.
	many := filepath.Join(dir, "many")
	mustMkdir(t, many)
	mustWrite(t, filepath.Join(many, "one.txt"), "1")
	mustWrite(t, filepath.Join(many, "two.txt"), "2")
	if got, _ := collapseSingleRoot(many); got != many {
		t.Errorf("a multi-entry folder was collapsed into %s", got)
	}
}

/* ---------- drift ---------- */

// The frontend's create list is what the dialog offers; this package is what
// can actually write. A format offered there that Go cannot produce would fail
// at the end of a long job, and nothing else in either build would catch it —
// the same guard as appmenu's and hashing's.
func TestCreateFormatsMatchFrontend(t *testing.T) {
	source, err := os.ReadFile(
		filepath.Join("..", "..", "frontend", "src", "constants", "archiveFormats.ts"),
	)
	if err != nil {
		t.Fatalf("reading the frontend format list: %v", err)
	}

	declared := map[string]bool{}
	for _, match := range regexp.MustCompile(`id: '([a-z0-9.]+)'`).FindAllStringSubmatch(string(source), -1) {
		declared[match[1]] = true
	}
	if len(declared) == 0 {
		t.Fatal("found no formats in archiveFormats.ts — this test would pass vacuously")
	}

	for _, format := range CreateFormats() {
		if !declared[format] {
			t.Errorf("Go writes %q, which the dialog does not offer", format)
		}
		delete(declared, format)
	}
	for format := range declared {
		t.Errorf("the dialog offers %q, which Go cannot write", format)
	}
}

// The session guard recognises a dead mount by the shape of its path, before
// any registry exists to ask. If the two prefixes drift, a pane restored inside
// a swept mount comes back pointing at a folder that is not there.
func TestMountPrefixMatchesFrontend(t *testing.T) {
	source, err := os.ReadFile(
		filepath.Join("..", "..", "frontend", "src", "services", "archives", "mountPaths.ts"),
	)
	if err != nil {
		t.Fatalf("reading the frontend mount prefix: %v", err)
	}

	match := regexp.MustCompile(`MOUNT_PREFIX = '([^']+)'`).FindStringSubmatch(string(source))
	if match == nil {
		t.Fatal("could not find MOUNT_PREFIX — this test would pass vacuously")
	}
	if match[1] != mountPrefix {
		t.Errorf("frontend prefix %q, backend %q", match[1], mountPrefix)
	}
}
