// Save Actions - first-party Zern extension. Runs right before a file is written, so what is saved is already tidy.
export function activate(zern) {
  function tidy({ path, languageId, text }) {
    if (!text) return text;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const markdown = /markdown/i.test(languageId) || /\.(md|markdown|mdx)$/i.test(path || '');
    let out = text;
    if (zern.settings.get('trimTrailingWhitespace') && !(markdown && zern.settings.get('skipMarkdown'))) {
      out = out.split('\n').map((l) => l.replace(/[ \t]+(\r?)$/, '$1')).join('\n');
    }
    if (zern.settings.get('trimFinalNewlines')) out = out.replace(/(\r?\n){2,}$/, eol);
    if (zern.settings.get('insertFinalNewline') && out.length && !/\n$/.test(out)) out += eol;
    return out;
  }

  zern.editor.onWillSave(tidy);

  zern.commands.register('saveActions.run', () => {
    const info = zern.editor.active();
    if (!info) { zern.window.showMessage('info', 'Open a file first.'); return; }
    const changed = zern.editor.setText(tidy({ ...info, text: zern.editor.getDocumentText() }));
    zern.window.showMessage('info', changed ? 'File tidied.' : 'Nothing to tidy.');
  });
}

export function deactivate() { /* the save hook is released through zern.subscriptions */ }
