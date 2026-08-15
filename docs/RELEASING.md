# Releasing

`.github/workflows/release.yml` builds File Base on a macOS runner and attaches
the result to a GitHub release.

## Cutting a release

```bash
git tag v0.1.0
git push origin v0.1.0
```

That runs the workflow, and if everything passes it creates a **draft** release
with `FileBase-0.1.0-universal.zip` attached. Draft on purpose — look at it,
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

Nothing below is set up yet, which is a deliberate starting point rather than an
oversight. As it stands `wails build` **ad-hoc signs** the app:

```
$ codesign -dv build/bin/file-base.app
CodeDirectory ... flags=0x2(adhoc)

$ spctl -a -vv -t exec build/bin/file-base.app
build/bin/file-base.app: rejected
```

An ad-hoc signature identifies nobody. On the machine that built it the app opens
fine. **Downloaded from GitHub by anyone else it will not**, because the download
carries a quarantine flag and Gatekeeper refuses anything without a Developer ID:
macOS says *"file-base.app is damaged and can't be opened"*, which is a lie about
a real problem — the app is intact, it is unsigned.

Two ways round it, both belonging in the release notes if you ship unsigned:

- **Right-click the app → Open**, then Open again in the dialog. Per app, once.
- Or from a terminal: `xattr -dr com.apple.quarantine /Applications/file-base.app`

Both ask a user to override a security warning, which is a bad habit to teach.
Signing is the fix.

## Turning signing on

Requires an **Apple Developer Program** membership (99 USD/year). With one, add
four repository secrets and the workflow starts signing and notarizing on the
next tag — no edits to the YAML. Every signing step is `if: env.… != ''`, so
they skip themselves until the secrets exist.

| Secret | What it is |
| --- | --- |
| `MACOS_CERTIFICATE` | Your **Developer ID Application** certificate, exported as `.p12`, base64-encoded |
| `MACOS_CERTIFICATE_PASSWORD` | The password you set when exporting the `.p12` |
| `MACOS_SIGNING_IDENTITY` | The identity's full name, e.g. `Developer ID Application: Your Name (TEAMID)` |
| `MACOS_NOTARY_APPLE_ID` | The Apple ID of the developer account |
| `MACOS_NOTARY_PASSWORD` | An **app-specific password**, not your Apple ID password |
| `MACOS_NOTARY_TEAM_ID` | Your 10-character team ID |

Signing runs on `MACOS_CERTIFICATE`; notarization runs on
`MACOS_NOTARY_APPLE_ID`. Setting the first three gets you a signed build that
Gatekeeper still stops on first launch; all six gets you one that just opens.

### Getting each of them

1. **The certificate.** In Xcode: Settings → Accounts → your team → Manage
   Certificates → **+** → *Developer ID Application*. Then in Keychain Access,
   find it under *My Certificates*, right-click → Export → `.p12`, and set a
   password.

   ```bash
   base64 -i DeveloperID.p12 | pbcopy   # paste as MACOS_CERTIFICATE
   ```

   *Developer ID Application* is the one that matters — "Apple Development" and
   "Apple Distribution" certificates cannot ship outside the App Store, and using
   one produces a build that fails notarization at the end rather than at the
   start.

2. **The identity name**, exactly as `codesign` wants it:

   ```bash
   security find-identity -v -p codesigning
   ```

3. **The app-specific password.** appleid.apple.com → Sign-In and Security →
   App-Specific Passwords. Your real Apple ID password will not work here.

4. **The team ID** is in the same `security find-identity` output, in
   parentheses, and on developer.apple.com under Membership.

### Checking it worked

The workflow prints the answer before publishing, under **Verify what will be
published**:

```
--- Gatekeeper assessment ---
build/bin/file-base.app: accepted
source=Notarized Developer ID
```

`rejected` there means the download will be rejected on other people's machines
too. That step never fails the build — it reports, so the log says plainly what a
user is going to hit.

## Known limits

- **macOS only.** The workflow builds `darwin/universal`, verified locally to
  produce `x86_64 arm64` in one binary. The app is macOS-specific anyway: the
  native menu is `runtime.MenuSetApplicationMenu`, the window options are
  `mac.Options`, and the trash goes through Finder.
- **The release is a zip, not a DMG.** A zip needs no extra tooling and unzips
  to a bundle in one double-click; the app is dragged to Applications by hand. A
  DMG with a drag-to-Applications background is a `create-dmg` step away if it
  is ever worth the dependency.
- **No auto-update.** Every version is a manual download. Sparkle is the usual
  answer and would need an appcast feed and a signing key of its own.
