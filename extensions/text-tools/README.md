# Text Tools

Small, everyday text transformations without leaving the editor. Everything runs locally.

## How to use

Select some text, right-click and choose **Text Tools: Transform Selection…**, or run any command from the Command Palette (`Ctrl+Q`).

## What it can do

| Group | Transformations |
|---|---|
| Case | UPPERCASE, lowercase, Title Case, camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE |
| Lines | Sort ascending or descending, remove duplicates, reverse, trim trailing whitespace |
| Encoding | Base64, URL and HTML encode and decode |
| Insert | UUID, lorem ipsum, current date |

- **Line commands work on the whole file** when nothing is selected. The rest need a selection.
- With several selections, each one is transformed on its own, and everything is a single undo step.

## Settings

| Setting | What it does |
|---|---|
| Lorem ipsum paragraphs | How many paragraphs are inserted (1 to 10) |
| Date format | Format of "Insert Current Date" |

## Good to know

- Base64 and URL decoding fail with a message if the selection is not valid for that conversion; nothing is changed.
