# Markdown Tools

Two chores you do not want to do by hand when writing Markdown.

## Table of contents

- **Insert Table of Contents** adds a linked list of your headings where the cursor is, wrapped in `<!-- toc -->` and `<!-- tocstop -->` markers.
- **Update Table of Contents** rewrites that block after you add or rename headings.

Links use GitHub-style anchors (lowercase, no punctuation, repeated titles get `-1`, `-2`). Headings inside code blocks are ignored.

## Format tables

**Format Tables** (Command Palette, or the right-click menu in Markdown files) lines up the columns of every table in the file and keeps your alignment marks (`:---`, `:---:`, `---:`).

Before:

```
| Name | Role |
|---|:-:|
| Ada | Engineer |
```

After:

```
| Name | Role     |
| ---- | :------: |
| Ada  | Engineer |
```

## Settings

| Setting | What it does |
|---|---|
| First heading level | 1 includes the `#` title, 2 starts at `##` |
| Last heading level | Deeper headings are left out |

## Good to know

- Everything is a single undo step, and nothing is touched if there is nothing to do.
- Tables inside code blocks are left alone.
