package shell

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"howett.net/plist"
)

// bundle writes an application bundle with the given Info.plist values and
// returns its path. Enough of one for readInfoPlist: Launch Services is not
// involved, so nothing has to be registered or signed.
func bundle(t *testing.T, root, name string, info map[string]any) string {
	t.Helper()

	path := filepath.Join(root, name+".app")
	if err := os.MkdirAll(filepath.Join(path, "Contents"), 0o755); err != nil {
		t.Fatalf("creating bundle: %v", err)
	}
	if info == nil {
		return path
	}

	blob, err := plist.Marshal(info, plist.XMLFormat)
	if err != nil {
		t.Fatalf("encoding Info.plist: %v", err)
	}
	if err := os.WriteFile(filepath.Join(path, "Contents", "Info.plist"), blob, 0o644); err != nil {
		t.Fatalf("writing Info.plist: %v", err)
	}
	return path
}

// answerPlist encodes the dictionary fb_application_urls hands back, so the
// mapping can be driven without asking the machine what it has installed.
func answerPlist(t *testing.T, uti, preferred string, candidates []string) []byte {
	t.Helper()

	value := map[string]any{"uti": uti, "candidates": candidates}
	if preferred != "" {
		value["default"] = preferred
	}
	blob, err := plist.Marshal(value, plist.BinaryFormat)
	if err != nil {
		t.Fatalf("encoding answer: %v", err)
	}
	return blob
}

func names(apps []Application) []string {
	out := make([]string, len(apps))
	for i, app := range apps {
		out[i] = app.Name
	}
	return out
}

func TestApplicationsPutsTheDefaultFirstThenSortsByName(t *testing.T) {
	root := t.TempDir()
	preview := bundle(t, root, "Preview", map[string]any{"CFBundleName": "Preview"})
	acorn := bundle(t, root, "Acorn", map[string]any{"CFBundleName": "Acorn"})
	code := bundle(t, root, "Visual Studio Code", map[string]any{
		"CFBundleDisplayName": "Code",
		"CFBundleIdentifier":  "com.microsoft.VSCode",
	})

	got, err := applications(answerPlist(t, "public.jpeg", preview, []string{code, acorn, preview}))
	if err != nil {
		t.Fatalf("applications: %v", err)
	}

	if got.UTI != "public.jpeg" {
		t.Errorf("uti = %q, want public.jpeg", got.UTI)
	}
	// Preview because it is the default, then Acorn before Visual Studio Code —
	// Launch Services' own order was Code, Acorn, Preview. And "Visual Studio
	// Code", not the "Code" its Info.plist prefers: the row names the bundle the
	// way the folder listing beside it does (§M25 decision 2).
	want := []string{"Preview", "Acorn", "Visual Studio Code"}
	if diff := strings.Join(names(got.Apps), ","); diff != strings.Join(want, ",") {
		t.Errorf("order = %s, want %s", diff, strings.Join(want, ","))
	}
	if !got.Apps[0].IsDefault {
		t.Error("the first row should be marked as the default")
	}
	if got.Apps[1].IsDefault || got.Apps[2].IsDefault {
		t.Error("only one row may be the default")
	}
	if got.Apps[2].BundleID != "com.microsoft.VSCode" {
		t.Errorf("bundleId = %q, want com.microsoft.VSCode", got.Apps[2].BundleID)
	}
}

func TestApplicationsListsTheDefaultEvenWhenItIsNotACandidate(t *testing.T) {
	root := t.TempDir()
	preview := bundle(t, root, "Preview", map[string]any{"CFBundleName": "Preview"})
	acorn := bundle(t, root, "Acorn", map[string]any{"CFBundleName": "Acorn"})

	got, err := applications(answerPlist(t, "public.jpeg", preview, []string{acorn}))
	if err != nil {
		t.Fatalf("applications: %v", err)
	}

	if len(got.Apps) != 2 {
		t.Fatalf("got %d rows, want 2", len(got.Apps))
	}
	if got.Apps[0].Path != preview || !got.Apps[0].IsDefault {
		t.Errorf("first row = %+v, want the default Preview", got.Apps[0])
	}
}

func TestApplicationsDropsARepeatedPath(t *testing.T) {
	root := t.TempDir()
	preview := bundle(t, root, "Preview", map[string]any{"CFBundleName": "Preview"})

	got, err := applications(answerPlist(t, "public.jpeg", "", []string{preview, preview + "/", preview}))
	if err != nil {
		t.Fatalf("applications: %v", err)
	}

	if len(got.Apps) != 1 {
		t.Fatalf("got %d rows, want 1: %v", len(got.Apps), names(got.Apps))
	}
	if got.Apps[0].IsDefault {
		t.Error("nothing is the default when Launch Services named none")
	}
}

func TestApplicationsReadsAnEmptyListAsAnAnswer(t *testing.T) {
	got, err := applications(answerPlist(t, "public.data", "", nil))
	if err != nil {
		t.Fatalf("applications: %v", err)
	}

	// Not nil: the frontend draws "no applications available" from an empty
	// list, and a missing one would decode as undefined.
	if got.Apps == nil {
		t.Fatal("apps should be an empty list, not nil")
	}
	if len(got.Apps) != 0 {
		t.Errorf("got %d rows, want none", len(got.Apps))
	}
}

func TestApplicationsRefusesSomethingThatIsNotAPropertyList(t *testing.T) {
	if _, err := applications([]byte("not a plist")); err == nil {
		t.Fatal("expected an error")
	}
}

func TestAppNameIsTheNameOnDisk(t *testing.T) {
	cases := []struct {
		name string
		path string
		info map[string]any
		want string
	}{
		// The case that sent the first implementation back: VS Code calls
		// itself "Code", and every other row in this app calls it Visual
		// Studio Code (§M25 decision 2).
		{"the bundle name loses to the file name", "/Applications/Visual Studio Code.app",
			map[string]any{"CFBundleDisplayName": "Code", "CFBundleName": "Code"},
			"Visual Studio Code"},
		{"the extension goes", "/Applications/Marta.app", nil, "Marta"},
		{"no plist is not a problem", "/Applications/Preview.app", nil, "Preview"},
		// A handler that is not a bundle at all — Launch Services will offer
		// one, and there is no extension to strip.
		{"something that is not a bundle", "/usr/bin/vim",
			map[string]any{"CFBundleName": "Vim"}, "vim"},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := appName(test.info, test.path); got != test.want {
				t.Errorf("appName = %q, want %q", got, test.want)
			}
		})
	}
}

func TestReadInfoPlistIsNilRatherThanAnError(t *testing.T) {
	root := t.TempDir()

	if info := readInfoPlist(bundle(t, root, "Bare", nil)); info != nil {
		t.Error("a bundle with no Info.plist should read as nil")
	}
	if info := readInfoPlist(filepath.Join(root, "Gone.app")); info != nil {
		t.Error("a bundle that does not exist should read as nil")
	}

	broken := bundle(t, root, "Broken", nil)
	if err := os.WriteFile(filepath.Join(broken, "Contents", "Info.plist"), []byte("{"), 0o644); err != nil {
		t.Fatalf("writing: %v", err)
	}
	if info := readInfoPlist(broken); info != nil {
		t.Error("an unparseable Info.plist should read as nil")
	}

	good := bundle(t, root, "Good", map[string]any{"CFBundleName": "Good"})
	if info := readInfoPlist(good); stringValue(info, "CFBundleName") != "Good" {
		t.Errorf("readInfoPlist = %v, want CFBundleName Good", info)
	}
}

func TestOpenWithArgsSeparatesTheApplicationFromTheFiles(t *testing.T) {
	got := openWithArgs([]string{"/tmp/a.png", "/tmp/./b.png"}, "/Applications/Preview.app/")
	want := []string{"-a", "/Applications/Preview.app", "--", "/tmp/a.png", "/tmp/b.png"}

	if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Errorf("args = %v, want %v", got, want)
	}
}

func TestOpenWithReportsAMissingItemRatherThanRunningOpen(t *testing.T) {
	root := t.TempDir()
	app := bundle(t, root, "Preview", nil)

	err := (&Shell{}).OpenWith([]string{filepath.Join(root, "gone.png")}, app)
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), `"code":"not-found"`) {
		t.Errorf("error = %v, want a not-found fs-error", err)
	}
}

func TestOpenWithNothingSelectedIsNotAnError(t *testing.T) {
	if err := (&Shell{}).OpenWith(nil, "/Applications/Preview.app"); err != nil {
		t.Errorf("OpenWith with no paths = %v, want nil", err)
	}
}

func TestApplicationsForReportsAMissingFile(t *testing.T) {
	_, err := (&Shell{}).ApplicationsFor(filepath.Join(t.TempDir(), "gone.jpg"))
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), `"code":"not-found"`) {
		t.Errorf("error = %v, want a not-found fs-error", err)
	}
}

// The one test that asks the machine what it has installed. A TextEdit-openable
// file has a handler on every Mac, so an empty list here means the cgo call is
// not working rather than that the system has nothing to offer.
func TestApplicationsForAsksLaunchServices(t *testing.T) {
	path := filepath.Join(t.TempDir(), "note.txt")
	if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
		t.Fatalf("writing: %v", err)
	}

	got, err := (&Shell{}).ApplicationsFor(path)
	if err != nil {
		t.Fatalf("ApplicationsFor: %v", err)
	}

	if got.UTI != "public.plain-text" {
		t.Errorf("uti = %q, want public.plain-text", got.UTI)
	}
	if len(got.Apps) == 0 {
		t.Fatal("no application can open a .txt file — the Launch Services call is not working")
	}
	for _, app := range got.Apps {
		if app.Name == "" || !strings.HasSuffix(app.Path, ".app") {
			t.Errorf("row = %+v, want a named .app bundle", app)
		}
	}
}
