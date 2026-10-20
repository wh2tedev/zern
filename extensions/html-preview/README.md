# HTML Preview

See your page the way a browser does, right next to your code.

## Features

- **Real preview.** `<link>`, `<script>`, images, fonts and `fetch()` calls resolve against your project files, so multi-page sites work and links between pages can be followed.
- **Live reload.** The preview refreshes as you type, including unsaved changes, and keeps your scroll position.
- **Console.** `console.log`, errors and unhandled promise rejections from the page show up in a built-in console, with a counter for errors.
- **Responsive sizes.** Switch between Responsive, Mobile (375), Tablet (768) and Desktop (1280).
- **Address bar.** Shows the page you are on and lets you reload or open it in a new tab.

## Usage

1. Open an `.html` file.
2. Press `Ctrl+Alt+V`, click **Preview** in the status bar, or run **HTML Preview: Open Preview to the Side** from the Command Palette (`Ctrl+Q`).

## Settings

| Setting | What it does |
|---|---|
| Auto reload | Refresh while you type (turn off to refresh only with the reload button) |
| Reload delay | Wait after typing before refreshing (100 to 2000 ms) |
| Default screen size | Size used when the preview opens |

## Trust

The full preview runs your page's scripts in the same origin as Zern, so they could read data kept in the browser (such as a GitHub token). The first time you preview a project, Zern asks if you **trust** it. If you do not, the preview runs in **isolated mode**: still live, but sandboxed, with no relative `fetch()` or page navigation. Click the **Isolated** tag to trust the project later. The desktop app and GitHub repositories always use isolated mode.

## Good to know

- Real folders, virtual projects and GitHub repositories are all supported.
- In a **GitHub repository** the preview runs in *isolated mode*: files are inlined and the page runs in a sandbox with no access to Zern's data. Relative `fetch()` calls and navigation between pages are not available there.
- Binary files (images, fonts) are only available from real folders, since the virtual filesystem stores text.
