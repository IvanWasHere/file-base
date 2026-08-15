# Releasing

`.github/workflows/release.yml` builds File Base on a macOS runner and attaches
the result to a GitHub release.

## Cutting a release

```bash
git tag v0.1.0
git push origin v0.1.0
```

That runs the workflow, and if everything passes it creates a **draft** release
with two downloads attached: `FileBase-0.1.0.dmg` (the one to point people at —
open it, drag the app onto the Applications shortcut) and
`FileBase-0.1.0-universal.zip` (the same app, for anyone who prefers it). Draft on purpose — look at it,
edit the notes, then publish. Nothing is public until you press the button.

To test the pipeline without spending a tag, run the workflow by hand from the
Actions tab (**Run workflow**). It builds and uploads the zip as a workflow
artifact, and skips the release step entirely.

The tag is the version: `v0.1.0` becomes `0.1.0` in `wails.json`'s
`info.productVersion`, which is what `CFBundleShortVersionString` and
`CFBundleVersion` are built from — so Get Info and the About panel agree with the
release the download came from. Don't set the version in `wails.json` by hand.

The workflow runs the full suite first — lint, ~650 frontend tests, the
production frontend build, `go vet`, `go test ./backend/...` — so a red build
cannot become a release.

**The frontend is built before any Go command runs, and that order is load
bearing.** `main.go` carries `//go:embed all:frontend/dist`, and `frontend/dist`
is gitignored — so on a fresh checkout it does not exist, and anything covering
the root package dies with:

```
main.go:24:12: pattern all:frontend/dist: no matching files found
```

Locally this never shows up, because a previous `wails build` has always left a
`dist` behind. It cost one release run to find. If you add a Go step, put it
after `npm run build` or scope it to `./backend/...`.

## What you get without signing, and what that costs

Releases are unsigned, deliberately — see the next section for why and for what
turning it on would take. `wails build` **ad-hoc signs** the app:

```
$ codesign -dv build/bin/file-base.app
CodeDirectory ... flags=0x2(adhoc)

$ spctl -a -vv -t exec build/bin/file-base.app
build/bin/file-base.app: rejected
```

An ad-hoc signature identifies nobody. On the machine that built it the app opens
fine. **Downloaded from GitHub by anyone else it will not**, because the download
carries a quarantine flag and Gatekeeper refuses anything without a Developer ID.

How a user gets past it depends on their macOS version, and this is worth getting
right in the release notes because the old advice stopped working:

- **macOS 15 (Sequoia) and later** — including macOS 26, which this was written
  on — Apple **removed** the Control-click → Open bypass for quarantined
  unsigned apps. The route now is: try to open it, dismiss the warning, then
  **System Settings → Privacy & Security → Open Anyway**, once per version.
- **macOS 14 and earlier:** right-click the app → **Open** → **Open**.
- Either way, the terminal equivalent is
  `xattr -dr com.apple.quarantine /Applications/file-base.app`

All of them ask a user to override a security warning, which is a bad habit to
teach. Signing is the fix.

**Signing is not an App Store thing.** The two are separate programmes with
separate certificates: *Apple Distribution* is for the App Store, and **Developer
ID Application** — the one this workflow wants — exists specifically to
distribute outside it. Notarization is the same: you upload the build, Apple
scans it for malware and hands back a ticket. Nothing is reviewed, nothing is
listed, and you keep shipping from GitHub. What it buys is only that the app
opens on a stranger's Mac without ceremony.

## Signing: not set up, and what it would take

The workflow does **not** sign. There is no certificate, no notarization step and
no `MACOS_*` secret — they were written first and removed on purpose, because
signing needs an Apple Developer Program membership (99 USD/year) that this
project does not have. An unsigned release is a real choice with a real cost, and
the cost is the Gatekeeper detour above, paid once by every person who downloads
it.

**Signing is not an App Store thing**, which is the usual reason people skip it.
The two are separate programmes with separate certificates: *Apple Distribution*
is for the App Store, and **Developer ID Application** exists specifically to
distribute *outside* it. Notarization is not a review either — you upload a
build, Apple scans it for malware and returns a ticket. Nothing is listed,
nothing is approved, you keep shipping from GitHub. All it buys is that the app
opens on a stranger's Mac without ceremony.

If a membership ever exists, the steps to add back are:

1. **Import the certificate** into a throwaway keychain on the runner, from a
   base64-encoded `.p12` in a secret. Use a temporary keychain rather than the
   login one, and run `security set-key-partition-list` afterwards or `codesign`
   blocks on a GUI prompt nobody can answer.
2. **`codesign --force --deep --timestamp --options runtime`** the `.app` with a
   *Developer ID Application* identity. `--options runtime` is the hardened
   runtime, which notarization requires.
3. **`xcrun notarytool submit --wait`** the zip, then `xcrun stapler staple` the
   `.app` and rebuild the zip so it carries the ticket. Staple so the app opens
   offline instead of needing a Gatekeeper round trip.
4. **Build the DMG after stapling**, and `codesign` the DMG too — a signed app
   inside an unsigned image still warns on the image.

One trap worth writing down, because it is not obvious and cost a debugging pass:
**`secrets` is not an allowed context in a step's `if`.** Gating a step on
`if: ${{ secrets.FOO != '' }}` does not work; the secrets have to be lifted to
job-level `env` first and the condition written `if: env.FOO != ''`.

The full working version of all four steps is in this repository's history —
`git log -- .github/workflows/release.yml` — rather than commented out in the
file, where it would be dead weight that drifts.

## Known limits

- **macOS only.** The workflow builds `darwin/universal`, verified locally to
  produce `x86_64 arm64` in one binary. The app is macOS-specific anyway: the
  native menu is `runtime.MenuSetApplicationMenu`, the window options are
  `mac.Options`, and the trash goes through Finder.
- **The DMG is a plain one.** `hdiutil` gives a window holding the app and an
  Applications symlink, which is the whole install gesture; it does not have a
  designed background with positioned icons. That needs `create-dmg` or
  Finder-scripting the window, which is the part that goes flaky on a headless
  runner.
- **A private repository has no public downloads.** Release assets follow the
  repository: while it is private, only people with access can download them,
  however the release is configured. Making it public is a repository setting
  (Settings → General → Danger Zone → Change visibility), and it publishes the
  full commit history along with the code.
- **No auto-update.** Every version is a manual download. Sparkle is the usual
  answer and would need an appcast feed and a signing key of its own.
