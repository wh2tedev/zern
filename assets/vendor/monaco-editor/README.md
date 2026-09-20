# Running Monaco 100% offline

By default, KCode loads Monaco from the jsDelivr CDN. If this folder
contains a real copy of Monaco, KCode uses it automatically instead -
no code changes needed, no internet required after that.

## How to get the local copy (needs Node.js once, on any machine)

```bash
npm install monaco-editor@0.45.0 --no-save
cp -r node_modules/monaco-editor/min ./min
rm -rf node_modules package-lock.json
```

Run that from inside this folder (`assets/vendor/monaco-editor/`). When
you're done, this folder should look like:

```
assets/vendor/monaco-editor/
├── README.md          <- this file
└── min/
    └── vs/
        ├── loader.js
        ├── editor/
        │   └── editor.main.js
        └── ... (everything else npm installed)
```

That's it - reload the app. KCode checks for `min/vs/loader.js` here
on startup; if it's missing (like right now, fresh from the zip), it
silently falls back to the CDN version, so nothing breaks either way.

## Why this matters on Termux/offline setups

If you're running KCode without a reliable internet connection (or
jsDelivr is ever down/blocked), the editor currently can't load at all
without this local copy - Monaco itself, not just your files, comes
from that CDN.

## Note

Codicons, JSZip, and the optional Inter font still load from their own
CDNs regardless of this setting - this only affects Monaco itself. Say
the word if you want those made local too.
