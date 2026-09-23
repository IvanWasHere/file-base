---
title: Archives
lead: Open zip, 7z, rar and tarballs like folders, and create zip and tar archives with optional splitting and a password.
---

## Browsing an archive

**Double-click an archive** and FileBase opens it like a folder. You can look around, preview files, and copy or drag things out of it.

Archives open **read-only**: to change what's inside, copy it out, edit it, and compress again.

Behind the scenes, FileBase unpacks the archive into a temporary folder and cleans it up when you leave. That means opening a very large archive takes time and disk space, even if you only want one file from it.

If an archive is password-protected, FileBase asks for the password. You get three tries.

### Formats that open

zip, **7z**, **rar**, tar, gzip, bzip2, xz, lzma, lz4, zstd, brotli, snappy and compress, plus every `tar.*` combination of them (`.tar.gz`, `.tgz`, `.tar.zst` and so on).

FileBase identifies archives by their **contents**, not their extension, so a 7z file that's been misnamed `.zip` still opens.

## Extracting

Select one or more archives and choose **File → Uncompress** (or right-click → **Uncompress**). Each archive is extracted next to itself, into a folder named after it. If the archive contains just one item, that item is extracted directly, with no extra folder around it.

## Creating an archive

![The Compress window with name, format, split and password fields]({{ '/assets/img/guide/compress.png' | relative_url }})

Select the files and folders to include and press <kbd>⌥⌘K</kbd>, or choose **File → Compress…**.

- **Name**: what the archive is called. The extension is added for you.
- **Format**: pick one of the formats below.
- **Split into parts**: keep it as one file, or split it into 10 MB, 100 MB, 700 MB, 1 GB or 4 GB parts, e.g. to fit a size limit on uploads or a FAT32 drive.
- **Password**: optional, for **zip** only. Encrypts the contents with **AES-256**.

| Format | When to use it |
| --- | --- |
| **Zip** | Opens everywhere. The safe default for sending files to other people |
| **Tar + Zstandard** | Fast and small, a great everyday choice |
| **Tar + XZ** | The smallest files, but the slowest |
| **Tar + LZ4** | The fastest, with the largest files |
| **Tar + Gzip**, **Bzip2**, **Brotli** | When something on the other end expects them |
| **Tar** | Bundles files with no compression |

**7z and rar can be opened but not created.** The rar format is proprietary, and there's no well-maintained library for writing 7z, so they're left out of the list instead of failing partway through.

> **Password-protected zips and macOS:** Archive Utility, the zip tool built into macOS, can't open AES-256 zips. 7-Zip, Keka, The Unarchiver and WinRAR can, and so can FileBase.
