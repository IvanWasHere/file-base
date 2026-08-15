package hashing

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// Digest correctness is a Go concern, and this is where it is pinned.
//
// The values below were produced by shasum(1), md5(1) and zlib's crc32 — three
// implementations that share no code with Go's standard library. Computing them
// with Go and asserting Go matches would be a test that cannot fail.
//
// The empty input is in the table because it is exactly where a wrong
// implementation looks right: a hasher that never writes anything still returns
// the correct digest of nothing. The million-byte input is there because it is
// the only case that crosses `bufferSize` — several times — so a streaming bug
// that drops or double-counts a buffer shows up here and nowhere else.
var vectors = map[string]struct{ empty, abc, million string }{
	"crc32": {
		empty:   "00000000",
		abc:     "352441c2",
		million: "dc25bfbc",
	},
	"md5": {
		empty:   "d41d8cd98f00b204e9800998ecf8427e",
		abc:     "900150983cd24fb0d6963f7d28e17f72",
		million: "7707d6ae4e027c70eea2a935c2296f21",
	},
	"sha1": {
		empty:   "da39a3ee5e6b4b0d3255bfef95601890afd80709",
		abc:     "a9993e364706816aba3e25717850c26c9cd0d89d",
		million: "34aa973cd4c4daa4f61eeb2bdbad27316534016f",
	},
	"sha224": {
		empty:   "d14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f",
		abc:     "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7",
		million: "20794655980c91d8bbb4c1ea97618a4bf03f42581948b2ee4ee7ad67",
	},
	"sha256": {
		empty:   "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		abc:     "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		million: "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
	},
	"sha384": {
		empty:   "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b",
		abc:     "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
		million: "9d0e1809716474cb086e834e310a4a1ced149e9c00f248527972cec5704c2a5b07b8b3dc38ecc4ebae97ddd87f3d8985",
	},
	"sha512": {
		empty:   "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
		abc:     "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
		million: "e718483d0ce769644e2e42c7bc15b4638e1f98b13b2044285632a803afa973ebde0ff244877ea60a4cb0432ce577c31beb009c5c2c49aa2e4eadb217ad8cc09b",
	},
}

// collector stands in for the Wails runtime, gathering what a job emits and
// blocking until it is over. Every test drives the package through its real
// event surface rather than calling hashOne directly.
type collector struct {
	hashing *Hashing

	mu       sync.Mutex
	results  []Result
	progress []Progress
	done     Done
	finished chan struct{}
}

func newCollector() *collector {
	c := &collector{hashing: New(), finished: make(chan struct{})}
	c.hashing.emitResult = func(result Result) {
		c.mu.Lock()
		defer c.mu.Unlock()
		c.results = append(c.results, result)
	}
	c.hashing.emitProgress = func(progress Progress) {
		c.mu.Lock()
		defer c.mu.Unlock()
		c.progress = append(c.progress, progress)
	}
	c.hashing.emitDone = func(done Done) {
		c.mu.Lock()
		c.done = done
		c.mu.Unlock()
		close(c.finished)
	}
	return c
}

func (c *collector) wait(t *testing.T) {
	t.Helper()
	select {
	case <-c.finished:
	case <-time.After(30 * time.Second):
		t.Fatal("the job never emitted its Done event")
	}
}

func (c *collector) digests() map[string]string {
	c.mu.Lock()
	defer c.mu.Unlock()
	byPath := map[string]string{}
	for _, result := range c.results {
		byPath[result.Path] = result.Digest
	}
	return byPath
}

func write(t *testing.T, dir, name string, content []byte) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("writing %s: %v", name, err)
	}
	return path
}

func TestPublishedVectors(t *testing.T) {
	dir := t.TempDir()
	inputs := map[string][]byte{
		"empty":   {},
		"abc":     []byte("abc"),
		"million": bytes.Repeat([]byte("a"), 1_000_000),
	}
	paths := map[string]string{}
	for name, content := range inputs {
		paths[name] = write(t, dir, name+".bin", content)
	}

	for algorithm, expected := range vectors {
		t.Run(algorithm, func(t *testing.T) {
			c := newCollector()
			// All three files in one job, so the worker pool is carrying
			// different files through different algorithms' state at once: a
			// shared hash.Hash would show up as a wrong digest here.
			if _, err := c.hashing.Hash(Request{
				Paths:     []string{paths["empty"], paths["abc"], paths["million"]},
				Algorithm: algorithm,
			}); err != nil {
				t.Fatalf("starting the job: %v", err)
			}
			c.wait(t)

			got := c.digests()
			for name, want := range map[string]string{
				"empty": expected.empty, "abc": expected.abc, "million": expected.million,
			} {
				if got[paths[name]] != want {
					t.Errorf("%s of %s = %q, want %q", algorithm, name, got[paths[name]], want)
				}
			}
			if c.done.Completed != 3 || c.done.Failed != 0 {
				t.Errorf("Done = %+v, want 3 completed and 0 failed", c.done)
			}
		})
	}
}

// A published checksum is usually pasted with the filename beside it, so the
// digest has to be exactly the string on the page — lowercase hex, no padding,
// no prefix. CRC32 in particular must keep its leading zeros.
func TestDigestsAreBareLowercaseHex(t *testing.T) {
	dir := t.TempDir()
	path := write(t, dir, "empty.bin", nil)

	c := newCollector()
	if _, err := c.hashing.Hash(Request{Paths: []string{path}, Algorithm: "crc32"}); err != nil {
		t.Fatalf("starting the job: %v", err)
	}
	c.wait(t)

	if got := c.digests()[path]; got != "00000000" {
		t.Errorf("crc32 of the empty file = %q, want %q — leading zeros were dropped", got, "00000000")
	}
}

// Permission denied on one file in a selection of forty must not kill the
// batch, which is the same rule that keeps one dangling symlink from making a
// directory unlistable.
func TestOneFailureDoesNotKillTheBatch(t *testing.T) {
	dir := t.TempDir()
	good := write(t, dir, "good.txt", []byte("abc"))
	missing := filepath.Join(dir, "gone.txt")

	c := newCollector()
	if _, err := c.hashing.Hash(Request{
		Paths:     []string{good, missing},
		Algorithm: "sha256",
	}); err != nil {
		t.Fatalf("starting the job: %v", err)
	}
	c.wait(t)

	if got := c.digests()[good]; got != vectors["sha256"].abc {
		t.Errorf("the readable file digested to %q, want %q", got, vectors["sha256"].abc)
	}

	var failure *Result
	for i := range c.results {
		if c.results[i].Path == missing {
			failure = &c.results[i]
		}
	}
	if failure == nil {
		t.Fatal("the missing file produced no row at all — it would vanish from the modal")
	}
	if failure.Digest != "" {
		t.Errorf("a failed row carries a digest: %q", failure.Digest)
	}
	// The row has to reach the UI as a typed FsError, not as prose, which is
	// what the fs-error envelope and the not-found classification are for.
	if !strings.HasPrefix(failure.Error, "fs-error:") {
		t.Errorf("error is not encoded for the bridge: %q", failure.Error)
	}
	if !strings.Contains(failure.Error, `"code":"not-found"`) {
		t.Errorf("error is not classified as not-found: %q", failure.Error)
	}

	if c.done.Completed != 1 || c.done.Failed != 1 {
		t.Errorf("Done = %+v, want 1 completed and 1 failed", c.done)
	}
}

// The UI drops folders before asking (decision 8). This is the backstop: one
// folder in the list must fail its own row rather than the job.
func TestAFolderFailsItsOwnRow(t *testing.T) {
	dir := t.TempDir()
	good := write(t, dir, "good.txt", []byte("abc"))
	nested := filepath.Join(dir, "nested")
	if err := os.Mkdir(nested, 0o755); err != nil {
		t.Fatalf("creating a folder: %v", err)
	}

	c := newCollector()
	if _, err := c.hashing.Hash(Request{
		Paths:     []string{good, nested},
		Algorithm: "sha256",
	}); err != nil {
		t.Fatalf("starting the job: %v", err)
	}
	c.wait(t)

	if c.done.Completed != 1 || c.done.Failed != 1 {
		t.Errorf("Done = %+v, want the file to succeed and the folder to fail", c.done)
	}
}

// A count-based bar reads 0/1 for four minutes and then finishes, which is the
// common case for this feature: one large file.
func TestProgressIsReportedInBytes(t *testing.T) {
	dir := t.TempDir()
	size := 4 * bufferSize
	path := write(t, dir, "large.bin", bytes.Repeat([]byte("a"), size))

	c := newCollector()
	if _, err := c.hashing.Hash(Request{Paths: []string{path}, Algorithm: "sha256"}); err != nil {
		t.Fatalf("starting the job: %v", err)
	}
	c.wait(t)

	if len(c.progress) == 0 {
		t.Fatal("no progress was reported — the bar would sit at zero until the digest landed")
	}

	var previous int64
	for _, progress := range c.progress {
		if progress.BytesRead <= previous {
			t.Errorf("progress went backwards: %d after %d", progress.BytesRead, previous)
		}
		if progress.Total != int64(size) {
			t.Errorf("progress reports total %d, want %d", progress.Total, size)
		}
		previous = progress.BytesRead
	}

	if c.results[0].Bytes != int64(size) {
		t.Errorf("the result reports %d bytes read, want %d", c.results[0].Bytes, size)
	}
}

// Closing the modal means stop, not "keep reading a 20GB disk image for the
// next four minutes". Cancel is issued from inside the first progress callback,
// which runs on the reading goroutine — so the abort lands mid-file rather than
// racing the end of it.
func TestCancelStopsTheReadMidFile(t *testing.T) {
	dir := t.TempDir()
	path := write(t, dir, "large.bin", bytes.Repeat([]byte("a"), 8*bufferSize))

	c := newCollector()
	// The id only exists once Hash returns, but the first progress event can be
	// emitted before that — so the callback waits for it rather than testing
	// whether it has arrived yet. Without this the whole test turns on which of
	// the two goroutines wins, and a lost cancel looks like a broken feature.
	var id string
	ready := make(chan struct{})
	c.hashing.emitProgress = func(Progress) {
		<-ready
		_ = c.hashing.Cancel(id)
	}

	started, err := c.hashing.Hash(Request{Paths: []string{path}, Algorithm: "sha512"})
	if err != nil {
		t.Fatalf("starting the job: %v", err)
	}
	id = started
	close(ready)
	c.wait(t)

	if !c.done.Cancelled {
		t.Error("Done does not report the job as cancelled")
	}
	// A half-read file has no digest and no failure to report. The Done event
	// says what happened, once, rather than every abandoned row saying it.
	if len(c.results) != 0 {
		t.Errorf("a cancelled read still emitted %d result(s)", len(c.results))
	}
}

// The read loop is the only place a long hash can notice the window closing.
func TestProgressReaderStopsOnACancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	reader := &progressReader{
		source: bytes.NewReader([]byte("abc")),
		ctx:    ctx,
		report: func(int64) {},
	}
	if _, err := reader.Read(make([]byte, 8)); err == nil {
		t.Error("a cancelled context still read bytes")
	}
}

// Cancelling a job that has already finished is the normal case — the modal
// cancels on close, and the job may well be over by then.
func TestCancellingAnUnknownJobIsNotAnError(t *testing.T) {
	if err := New().Cancel("hash-does-not-exist"); err != nil {
		t.Errorf("Cancel on an unknown id returned %v", err)
	}
}

// A job that can never produce a digest fails the call rather than emitting
// forty error rows that all say the same thing.
func TestBadRequestsAreRejectedUpFront(t *testing.T) {
	h := New()
	if _, err := h.Hash(Request{Paths: []string{"/tmp/x"}, Algorithm: "sha128"}); err == nil {
		t.Error("an algorithm that does not exist was accepted")
	}
	if _, err := h.Hash(Request{Paths: nil, Algorithm: "sha256"}); err == nil {
		t.Error("an empty path list was accepted")
	}
}

// The frontend's list is the menu the user picks from; this package is what can
// actually answer. An algorithm offered in the sidebar that Go has never heard
// of would be a row that fails for a reason nobody can act on — and nothing
// else in either build would catch it, since Go cannot import a TypeScript type
// and the frontend cannot see this file. Same guard as
// appmenu.TestCommandIDsExistInFrontend.
func TestAlgorithmsMatchFrontend(t *testing.T) {
	source, err := os.ReadFile(
		filepath.Join("..", "..", "frontend", "src", "constants", "hashAlgorithms.ts"),
	)
	if err != nil {
		t.Fatalf("reading the frontend algorithm list: %v", err)
	}

	// Scoped to the HashAlgorithm union rather than run over the whole file:
	// AlgorithmGroup is a union of quoted strings too, and matching both would
	// report "secure" as an algorithm Go cannot compute.
	block := regexp.MustCompile(`(?s)export type HashAlgorithm =(.*?)\n\n`).
		FindStringSubmatch(string(source))
	if block == nil {
		t.Fatal("could not find the HashAlgorithm union in hashAlgorithms.ts — its shape " +
			"must have changed, and this test would pass vacuously")
	}

	// Matches the union members: `  | 'sha256'`.
	pattern := regexp.MustCompile(`\|\s*'([a-z0-9]+)'`)
	declared := map[string]bool{}
	for _, match := range pattern.FindAllStringSubmatch(block[1], -1) {
		declared[match[1]] = true
	}

	if len(declared) == 0 {
		t.Fatal("found no algorithms in the HashAlgorithm union — this test would pass vacuously")
	}

	// A union member missing from HASH_ALGORITHMS type-checks perfectly and
	// simply never appears in the sidebar, so nothing else would notice.
	for algorithm := range declared {
		if !strings.Contains(string(source), "id: '"+algorithm+"'") {
			t.Errorf("%q is in the union but not in HASH_ALGORITHMS — it is never offered", algorithm)
		}
	}

	for _, algorithm := range Algorithms() {
		if !declared[algorithm] {
			t.Errorf("Go computes %q, which the frontend does not offer", algorithm)
		}
		delete(declared, algorithm)
	}
	for algorithm := range declared {
		t.Errorf("the frontend offers %q, which Go cannot compute", algorithm)
	}
}
