---
title: Known limits
lead: Things FileBase can't do yet, or does differently on purpose, listed here so they don't surprise you.
---

## Dragging out to Finder

You can drag files **into** FileBase from Finder, and between FileBase panes, but not from FileBase **out to** Finder or other apps. To get a file somewhere else, use **Reveal in Finder** (<kbd>⇧⌘R</kbd>) and drag it from there, or **Copy Path** (<kbd>⌥⌘C</kbd>).

## Browsing an archive unpacks it

Opening an archive like a folder extracts it to a temporary folder first, which is deleted when you leave. Looking at one file in a 4 GB archive still unpacks all 4 GB. If you only need part of a big archive, give it time or free up space first.

## Password-protected zips in macOS's own tools

Zips with a password are encrypted with AES-256. Archive Utility, the zip tool built into macOS, has never supported this. 7-Zip, Keka, The Unarchiver and WinRAR open them without trouble, and so does FileBase.

## 7z and rar are open-only

FileBase can open and extract 7z and rar archives but can't create them. See [Archives](../archives/#creating-an-archive).

## The text reader is read-only

Editing the middle of a very large file means rewriting everything after the change, so the [text reader](../text-reader/) doesn't offer it.

## Window edges in light themes

The scrollbars and the strip behind the window's title bar stay dark in light themes, and the window can flash dark for a moment at launch before your theme loads.

## Unsigned builds

Releases aren't signed with an Apple Developer ID yet, so macOS asks you to confirm the first launch of each version. See [Install](../install/#the-first-launch).

---

Found something else? [Open an issue on GitHub](https://github.com/{{ site.repository }}/issues).
