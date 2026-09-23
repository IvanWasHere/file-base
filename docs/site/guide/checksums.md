---
title: Checksums
lead: Check that a download is exactly what it claims to be, or fingerprint files to compare later.
---

![The Calculate Hashes window showing a SHA-256 checksum]({{ '/assets/img/guide/hashes.png' | relative_url }})

## Calculating

Select one or more files and press <kbd>⌥⌘H</kbd>, click the **#** button in the toolbar, or right-click → **Calculate Hashes…**.

Pick an algorithm on the left. They're grouped by what they're good for:

| Group | Algorithms | Use it for |
| --- | --- | --- |
| **Secure hashes** | SHA-256, SHA-512, SHA-384, SHA-224 | Checking a download hasn't been tampered with |
| **Published checksums** | SHA-1, MD5 | Matching an older site that only publishes these. Not secure against deliberate tampering |
| **Integrity check** | CRC32 | Catching accidental corruption only |

Large files are read in small pieces, so hashing a multi-gigabyte file doesn't use much memory. A progress bar shows how far along it is, and you can cancel at any time.

Click the copy icon next to a result to copy it, or **Copy All** for every file at once.

## Verifying a download

This is what checksums are really for:

1. Copy the checksum from the website you downloaded from. It's fine to copy the whole line, as `shasum` prints it (`<hash>  filename`). FileBase picks the hash out of it.
2. Paste it into the **"Paste a checksum to verify…"** box at the top.
3. If the file's result matches, its row **lights up**.

If you pasted a SHA-1 checksum while SHA-256 is selected, FileBase doesn't just say "no match". It tells you which algorithm the checksum **looks like**, so you can switch to it on the left.
