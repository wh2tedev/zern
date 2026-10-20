# Zern extensions

Extensions live here, one folder each. Only extensions listed in `registry.json` can be installed: every one is published and reviewed by the Zern team, which is what the verified badge in the Extensions view means.

```
extensions/
  registry.json            list of available extensions (the trust list)
  <name>/
    zern-extension.json    manifest
    main.js                exports activate(zern) and, optionally, deactivate()
    icon.svg
    README.md              shown in the details page
    CHANGELOG.md
```

## Manifest

`id`, `displayName`, `publisher`, `version`, `description`, `icon`, `categories`, `main`, `readme`, `changelog`, plus:

- `contributes.commands`: `command`, `title`, optional `keybinding`.
- `contributes.settings`: `key`, `type` (`boolean`, `number` with `min`/`max`, `enum` with `options`, `string`), `title`, `description`, `default`. They show up in the **Settings** tab of the details page.
- `contributes.menus`: add commands to menus. `"editor/context"` entries (`command`, optional `when`, a Monaco condition such as `editorHasSelection` or `editorLangId == 'json'`) appear in the editor's right-click menu; `"explorer/context"` entries (`command`, optional `when`: `file` or `folder`, optional `icon`) appear in the Explorer's. A command from the Explorer menu receives `{ path, type }`.
- `contributes.views`: documentation only (title and description shown in the Features tab). The view itself is created in code with `zern.window.createSidebarView`.
- `recommend`: `fileExtensions` and a `message`. Zern suggests installing the extension when such a file is opened (once per session; "Don't show again" is remembered).

Bump `version` when you change an extension: users who have it installed get an **Updated** mark and a link to the changelog. Commands are added to the Command Palette (`Ctrl+Q`); `main.js` provides what they do with `zern.commands.register(id, fn)`.

## API (`zern`)

| Namespace | Members |
|---|---|
| `zern.commands` | `register(id, fn)`, `execute(id)` |
| `zern.workspace` | `kind()`, `activePath()`, `readText(path)`, `readBytes(path)`, `findFiles({ extensions, exclude, max })`, `openFile(path, { line, column })`, `trustId()`, `isTrusted()`, `requestTrust({ reason })`, `onDidChangeContent(fn)`, `onDidSave(fn)`, `onDidChangeActive(fn)` |
| `zern.window` | `createSidePanel({ title })`, `createSidebarView({ id, title, icon })` (own icon in the activity bar; returns `{ el, setTitle, setBadge, setActions, show, onDidShow }`), `createStatusBarItem({ text, tooltip, command, alignment })`, `showMessage(type, text)`, `showQuickPick({ placeholder, items })`, `showInputBox({ placeholder, value })` |
| `zern.serve` | `available()`, `register(handler)` returns `{ baseUrl }` (virtual HTTP served by the service worker) |
| `zern.settings` | `get(key)`, `onDidChange(fn)` |
| `zern.editor` | `active()`, `getDocumentText()`, `getSelectedText()`, `transform(fn, { wholeDocument })` (replaces each selection with `fn(text)`, one undo step), `insertText(text)`, `setText(text)` (touches only what changes), `onWillSave(handler)` (`handler({ path, languageId, text })` returns the new text), `onDidScroll(fn)` |
| `zern.markdown` | `render(text)` (escapes raw HTML) |
| `zern.storage` | `get(key, fallback)`, `set(key, value)` |

Everything an extension registers is disposed automatically when it is disabled or uninstalled.

## Trust

Extensions that run a project's own code inside Zern (HTML Preview's full mode) must call `zern.workspace.requestTrust({ reason })` first. It asks the user once per project and remembers the answer; GitHub repositories are never trusted. Without trust, fall back to a sandbox with no access to Zern's data.
