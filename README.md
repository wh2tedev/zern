# Zern Code

Code editor for the browser (PWA) and the desktop (Electron), built on Monaco.
Work on real folders or a virtual project, and edit GitHub repositories. No account, no server.

## Run

Serve this folder with any static server over `localhost` or HTTPS:

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

Desktop (Linux ARM64, `.deb`): download it from [Releases](https://github.com/wh2tedev/zern/releases) and run `sudo apt install ./zern*.deb`, or build it yourself with `npm install && npm run build:arm64`. The window remembers its size, position and maximized state.

## Browsers

- Chrome / Edge: everything.
- Firefox / Safari: virtual project and GitHub (no real folders).

## Privacy

No analytics and no server of its own. Your files stay in your browser or on your disk.
The only servers Zern contacts are `api.github.com` (when you use the GitHub features; your token is sent only there),
Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) for the Inter, Lora and JetBrains Mono typefaces, and
`cdn.jsdelivr.net` as a fallback if the bundled Monaco or JSZip is missing. `npm test` fails if a new host appears
without updating the Privacy text. The full policy is on the welcome page (footer > Privacy).

## Tests

```bash
npm test          # no dependencies, plain Node 18+: unit and consistency checks (~70)
npm run test:e2e  # optional, real browser: npm i -D playwright && npx playwright install chromium
```

`npm test` covers save-time edits, shortcuts, settings.json validation, Markdown, token encryption, window state, an XSS guard
(every value placed in an HTML string must be escaped with `js/escape.js` or reviewed in `tests/xss-allowlist.js`),
and consistency (one version everywhere, complete offline file list, every icon has a glyph, extension catalog up to date, notices complete).
Run it before every release.

## License

MIT, see [LICENSE](LICENSE). Third-party components: [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
Zern Code is not affiliated with Microsoft or GitHub.

## Extensions

Zern has an Extensions view (`Ctrl+Shift+X`) to install, disable and uninstall extensions. Only extensions published by the Zern team are available, marked with a verified badge. They live in the [`extensions/`](extensions/README.md) folder. Available today: **HTML Preview** (`Ctrl+Alt+V`), **Markdown Preview** (`Ctrl+Alt+M`), **Text Tools**, **TODO Tree**, **JSON Tools**, **Save Actions** and **Markdown Tools**.

Your GitHub token is never stored as plain text: the desktop app keeps it in the system keyring, and the web version keeps it for the session only, or encrypted with a passphrase if you choose to remember it.

## Offline assets and desktop build

Monaco, Codicons and JSZip are bundled in `assets/vendor/`, so Zern works without internet. After `npm install`:

- `npm run vendor` refreshes them from `node_modules` (Monaco only with `--force`).
- `npm run catalog` rebuilds `extensions/catalog.js` (the extension catalog used by the desktop app). Run it after changing an extension.
- `npm run build:arm64` builds the Linux ARM64 `.deb` (it runs both steps first). `npm start` opens the desktop app in development.

## Keyboard shortcuts and settings.json

Open **File > Keyboard Shortcuts** to rebind any command, or **File > Settings (JSON)** to edit every setting (and your shortcuts) as JSON with validation.
