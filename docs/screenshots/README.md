# Screenshots

The four images the root README's 2 × 2 table renders. Names are load-bearing —
the table references them by path, and the website shows copies of them from
`docs/site/assets/img/showcase/`.

All four are **16:9 at 1920 × 1080**, in the default **Nocturne** theme, and
generated rather than hand-taken, so they can be redone whenever the UI changes.

The easy way is the **Screenshots** workflow (Actions → Screenshots → Run
workflow → `readme`), which regenerates them on a macOS runner, refreshes the
website's copies, and opens a pull request. Locally:

```bash
(cd frontend && npm run dev:mock -- --port 5199 --strictPort)   # in one terminal
cd docs/site/scripts && npm i --no-save playwright && npx playwright install chromium
node capture.mjs readme               # all four
node capture.mjs readme screen2       # just one
```

They run against the mock bridge, so every filename is from the fake `/Users/dev`
tree and nothing private ends up in a public README. The window's traffic-light
buttons are drawn in by the script, since a browser page has no window.

After regenerating, refresh the website's copies:

```bash
for i in 1 2 3 4; do sips -Z 1600 docs/screenshots/screen$i.png --out docs/site/assets/img/showcase/screen$i.png; done
```

| File | What it shows |
| --- | --- |
| `screen1.png` | **Browse** — three tabs, Split Right with Documents, a Photos view of Wallpapers and a project folder, preview panel open on the selected photo. |
| `screen2.png` | **Archive** — the Compress dialog over that workspace: four files, zip split every 100 MB with an AES-256 password. |
| `screen3.png` | **Checksums** — Calculate Hashes on four downloads, with a pasted SHA-256 line matching one of them. |
| `screen4.png` | **New File Templates** — New File from Template with React Component selected and `Button.tsx` named. |

The scenes are `README_SCENES` in `docs/site/scripts/capture.mjs`.
