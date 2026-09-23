---
title: Themes and settings
lead: Pick a theme, choose the columns you want, and trim the right-click menu to what you use.
---

Open Settings with <kbd>⌘,</kbd> or **File → Settings…**.

## Themes

![Settings open on Themes, listing dark and light themes]({{ '/assets/img/guide/settings.png' | relative_url }})

FileBase comes with five themes:

- **Dark:** Nocturne (the default), Vault Dark, Graphite
- **Light:** Vault Light, Parchment

Click a theme to switch to it straight away. **Match System** follows the macOS appearance live, using a dark theme at night and a light one during the day if your Mac switches automatically.

For a quick switch, use **View → Theme**: *Match System*, *Light* or *Dark*.

![FileBase in the light theme]({{ '/assets/img/guide/light.png' | relative_url }})

### Your own themes

A theme is just a list of colours in a small file. Export one of the built-in themes from the Themes page, edit the colours, and put it in:

```
~/Library/Application Support/MacFileExplorer/Themes
```

It then appears under **From the themes folder**. A theme can only change colours, so it's safe to use one someone else made.

## Columns

Choose which columns appear in [Details view](../views/#details): size, type, modified, created and others. **Name** is always shown. **Reset Columns** restores the default set, order and widths.

You can also reorder and resize columns by dragging their headers in the listing.

## Right-click menu

Untick any command you never use to remove it from the right-click menu. It stays available in the menu bar and through its keyboard shortcut. Each row shows where the command appears: on files, folders, or the empty background of a folder.

## Sidebar and panels

These live in the **View** menu rather than Settings:

- **Show Sidebar** (<kbd>⌥⌘S</kbd>)
- **Show Preview** (<kbd>Space</kbd>)
- **Show Hidden Files** (<kbd>⇧⌘.</kbd>)

All of these settings are remembered between launches.
