---
title: File operations
lead: Copy, move, rename, duplicate and delete, with undo for anything you didn't mean.
---

![The right-click menu on a file]({{ '/assets/img/guide/context-menu.png' | relative_url }})

Every command below is available in three places: the **File** and **Edit** menus, the **right-click menu**, and a **keyboard shortcut**. Use whichever you like, since they all do the same thing.

## Copy, cut and paste

| Action | Shortcut |
| --- | --- |
| Copy | <kbd>⌘C</kbd> |
| Cut | <kbd>⌘X</kbd> |
| Paste into the current folder | <kbd>⌘V</kbd> |
| Duplicate in place | <kbd>⌘D</kbd> |

To move files, **cut** them, go to the new folder and **paste**. Cut files aren't touched until you paste.

**Copy Path** (<kbd>⌥⌘C</kbd>) puts the full path of the selection on the clipboard as text. It's handy for pasting into the Terminal or a chat.

## When a name is already taken

If you paste or drop something where an item with the same name already exists, FileBase asks what to do:

- **Keep Both** gives the new copy a numbered name, e.g. *Report 2.pdf*.
- **Replace** overwrites the existing item.
- **Skip** leaves the existing item alone and doesn't copy that one.
- **Cancel** stops the whole operation.

The choice you make applies to every clash in that operation.

## Rename

Select an item and press <kbd>Return</kbd>, or right-click and choose **Rename**. Type the new name, then press <kbd>Return</kbd> to save or <kbd>Esc</kbd> to cancel.

## New folders

Click **New Folder** in the toolbar or press <kbd>⇧⌘N</kbd>. The folder appears at the **top** of the listing with its name ready to edit, so you don't have to hunt for it. Anything you just pasted or created is also held at the top until your next action, then the listing goes back to its normal order.

For new *files*, see [New files from templates](../templates/).

## Trash and delete

| Action | Shortcut |
| --- | --- |
| Move to Trash | <kbd>⌫</kbd> (or <kbd>⌦</kbd>) |
| Delete Immediately | <kbd>⇧⌫</kbd> |

**Move to Trash** can be undone. **Delete Immediately** skips the Trash and removes the item for good, so FileBase asks you to confirm first.

## Undo

Press <kbd>⌘Z</kbd> to undo the last file operation. The Edit menu tells you what will be undone, e.g. *Undo Rename*. You can undo:

- creating a file or folder,
- renames,
- moves (including cut and paste and drag and drop),
- copies and duplicates,
- moving to the Trash (the items are put back where they were).

FileBase remembers the last 25 operations. Things that can't be reversed, like **Delete Immediately** or a **Replace** that overwrote a file, can't be undone, and the Undo menu item skips them rather than pretending.

## Drag and drop

- **Between panes or into a folder:** drag the selection and drop it on a pane or a folder. On the same drive, dragging **moves**. Onto a different drive, it **copies**. Hold <kbd>⌥ Option</kbd> while dropping to always copy.
- **From Finder into FileBase:** drop files onto whichever pane you want them in.
- **From FileBase to Finder** isn't possible yet (see [Known limits](../limits/)). Use **Reveal in Finder** (<kbd>⇧⌘R</kbd>) or **Copy Path** instead.

## Reveal in Finder

<kbd>⇧⌘R</kbd> opens a Finder window with the selected item highlighted.
