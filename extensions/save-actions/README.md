# Save Actions

Files come out of the editor tidy, every time, without you thinking about it.

## What it does when you save

- **Trims trailing whitespace** at the end of every line.
- **Adds a final newline** if the file does not end with one.
- **Removes extra blank lines** at the end of the file (several become one line break).

The changes are made just before the file is written, in the editor itself, so you see them and can undo them with `Ctrl+Z`. Your cursor and scroll position stay where they were.

You can also run it by hand: **Save Actions: Tidy the Current File Now** in the Command Palette (`Ctrl+Q`).

## Settings

| Setting | What it does |
|---|---|
| Trim trailing whitespace | On by default |
| Keep trailing spaces in Markdown | On by default: two spaces at the end of a line are a Markdown line break |
| Insert final newline | On by default |
| Remove extra blank lines at the end | On by default |

## Good to know

- Line endings (LF or CRLF) are kept as they are in the file.
- It works with autosave too. Turn off what you do not want in the Settings tab.
