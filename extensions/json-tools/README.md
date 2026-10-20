# JSON Tools

Clean up and check JSON without leaving the editor.

## Commands

Run them from the Command Palette (`Ctrl+Q`); **Format** and **Minify** are also in the right-click menu of JSON files.

| Command | What it does |
|---|---|
| Format JSON | Re-indents the document (or the selection) |
| Minify JSON | Removes all whitespace |
| Sort Keys | Sorts object keys alphabetically, at every level |
| Validate JSON | Tells you if it is valid, and where it is not |
| Escape / Unescape | Turns text into a JSON string literal, and back |

They work on the **selection**, or on the **whole file** if nothing is selected. If the JSON is not valid, you get the error and **nothing is changed**. Every command is one undo step.

## Settings

| Setting | What it does |
|---|---|
| Indentation | Spaces per level (1 to 8) |
| Indent with tabs | Use tabs instead of spaces |

## Good to know

- JSON with comments (such as `tsconfig.json`) is not valid JSON, so these commands refuse to change it rather than lose the comments.
- Key order is preserved except when you ask for **Sort Keys**.
