# Monaco Editor (local copy)

Zern loads Monaco from `min/vs/` in this folder, so the editor works fully offline.
If the folder is missing, it falls back to the jsDelivr CDN automatically.

- The copy in the project is the one Zern is tested with.
- To replace it with another version:
  `npm i -D monaco-editor@<version>` then `npm run vendor -- --force`

The app's icons (`css/icons.css`) are generated from the Codicons font that Monaco embeds, so they match Monaco's and
never need a separate icon package. After replacing Monaco, `npm run vendor` rebuilds them (or `npm run icons`).
JSZip (ZIP import/export) lives in `../jszip/`.
