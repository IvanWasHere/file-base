---
title: Text reader for huge files
lead: Open a log file of any size, even one many times larger than your Mac's memory, and jump straight to any part of it.
---

![The text reader showing a 64 KB window of an 890 MB file]({{ '/assets/img/guide/text-reader.png' | relative_url }})

Most editors try to load the whole file, which fails when the file is tens of gigabytes. The text reader only ever reads **one window** of the file at a time, so a 100 GB file opens as quickly as a 10 KB one.

## Opening it

Right-click any file and choose **Open in Text Reader**, or select it and use **File → Open in Text Reader**.

## Getting around

The controls along the bottom:

- **‹ and ›** move one window back or forward.
- **The slider** jumps anywhere in the file. Drag it to the middle to see the middle.
- **Offset** takes a byte position. Type it and press **Go** to land exactly there.
- **Chunk** sets how much is shown at once: 10 KB, 64 KB, 256 KB, 1 MB or 4 MB.
- **Whole lines**, when ticked, trims each window to start and end at line breaks, so you don't see half a line at the edges.
- **⟳** re-reads the window. This is useful for a log file that's still being written.

The right side shows which bytes you're looking at and the file's total size.

## Why byte offsets, not line numbers?

To know which line is at the 50 GB mark, you would have to read all 50 GB before it, and not reading the whole file is the point of the reader. Byte positions can be jumped to instantly.

The reader is for **reading only**. Editing the middle of a huge file would mean rewriting everything after the edit.
