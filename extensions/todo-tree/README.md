# TODO Tree

See every `TODO`, `FIXME` and `NOTE` you left in your code, in one place.

## Features

- **A sidebar view** with its own icon. It lists the tags found in your project, grouped by file, with a counter on the icon.
- **Click to jump** to the exact line.
- **Filter** the results by tag, text or file name.
- **Scan a single folder** from the Explorer: right-click a folder and choose **TODO Tree: Scan This Folder**.
- **Stays up to date:** a file is re-scanned each time you save it.

## What counts as a tag

In code files a tag only counts inside a comment (`// TODO: …`, `# FIXME …`, `<!-- NOTE … -->`), so a variable named `TODO` is ignored. In Markdown and text files a tag counts anywhere.

## Settings

| Setting | What it does |
|---|---|
| Tags | The words to look for (default TODO, FIXME, NOTE, HACK, BUG) |
| File types | Extensions to scan |
| Maximum files | Stops after this many files (10 to 5000) |
| Update when saving | Re-scan a file when it is saved |

## Good to know

- Folders such as `node_modules`, `.git`, `dist` and `build` are skipped, and files over 400 KB are ignored.
- In **GitHub repositories** each scanned file is a network request, so a scan is limited to 40 files.
