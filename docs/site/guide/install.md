---
title: Install
lead: FileBase ships as a disk image for macOS. It runs natively on both Apple silicon and Intel Macs, on macOS 10.13 or later.
---

## Download

1. Go to the [latest release](https://github.com/{{ site.repository }}/releases/latest) on GitHub.
2. Download the **`.dmg`** file. A `.zip` of the same app is there too, if you prefer.
3. Open the disk image and drag **FileBase.app** onto the **Applications** shortcut next to it.

## The first launch

> **Builds are not signed yet**, so macOS blocks the first launch with a warning. The app isn't damaged. It just doesn't have an Apple Developer ID yet, and macOS marks anything downloaded from the internet as quarantined.

You only need to do this once for each new version:

- **macOS 15 and later:** double-click FileBase and dismiss the warning. Then open **System Settings → Privacy & Security**, scroll to the bottom, and click **Open Anyway**.
- **macOS 14 and earlier:** right-click FileBase in Applications, choose **Open**, then click **Open** again in the dialog.

After that, FileBase opens like any other app.

## Updating

Download the new release and drag it into Applications again, replacing the old copy. Your tabs, favorites, templates and settings are stored separately in `~/Library/Application Support/MacFileExplorer`, so they carry over.
