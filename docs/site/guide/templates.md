---
title: New files from templates
lead: Create a new file that already has the right starting content — or add your own templates.
---

![The New File window with the Markdown Document template selected]({{ '/assets/img/guide/template.png' | relative_url }})

## An empty file

Press <kbd>⌘N</kbd> to create an empty file in the current folder. Type its name, including the extension, and press <kbd>Return</kbd>.

## From a template

Press <kbd>⌥⌘N</kbd> or choose **File → New File from Template…**.

1. Pick a template on the left. The built-in ones are an **HTML document**, a **Markdown document**, a **JSON file**, a **React component**, a **Python script**, a **shell script**, a **Dockerfile** and a **.gitignore**, among others.
2. Adjust the name on the right. The right extension is filled in for you.
3. Press <kbd>Return</kbd> or click **Create**.

Shell scripts are created already executable.

FileBase will never overwrite an existing file when creating one. If the name is taken, it tells you instead.

## Your own templates

Any file you put in the templates folder shows up in the list next to the built-in ones:

```
~/Library/Application Support/MacFileExplorer/Templates
```

The quickest way there is the **Reveal Templates Folder** button at the bottom of the template list. Drop in a file, such as an invoice skeleton, a license header or a project README, and it's available next time you open the window.
