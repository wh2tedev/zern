'use strict';
// Optional end-to-end checks in a real browser: `npm run test:e2e`
// Needs Playwright and a browser:  npm i -D playwright && npx playwright install chromium
// Set ZERN_CHROME=/path/to/chrome to use an existing Chrome/Chromium instead.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok    ' : 'FAILED'} ${msg}`); if (!ok) failed++; };

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch({ executablePath: process.env.ZERN_CHROME || undefined, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForSelector('#landing:not([hidden])');

  // --- Welcome page
  check(await page.isVisible('text=Download for Linux (.deb)'), 'landing: download button visible');
  await page.click('[data-dd=l-dd-product]');
  check(await page.isVisible('#l-dd-product'), 'landing: Product menu opens');
  await page.keyboard.press('Escape');
  await page.click('.l-foot [data-legal=privacy]');
  check((await page.innerText('#l-legal-title')) === 'Privacy Policy', 'landing: Privacy panel opens');
  await page.keyboard.press('Escape');
  await page.click('.l-hero .l-btn:has-text("Try on web")');
  await page.waitForSelector('#landing', { state: 'hidden' });
  check(await page.isVisible('#status-bar'), 'landing: "Try on web" opens the editor');

  // --- XSS: hostile branch and repository names must stay text
  await page.evaluate(async () => {
    const { AppState } = await import('./js/state.js');
    AppState.github = { owner: '<b id=pwn-owner>x</b>', repo: '"><img src=x onerror=window.__pwned=1>', branch: 'feature/<img/src=x/onerror=window.__pwned=1>', isPrivate: false };
    document.dispatchEvent(new CustomEvent('zern:scm-changed', { detail: { changes: [] } }));
  });
  await page.waitForTimeout(300);
  const injected = await page.evaluate(() => ({ pwned: window.__pwned === 1, imgs: document.querySelectorAll('#status-bar img, #status-bar b#pwn-owner').length, text: document.getElementById('status-branch').textContent }));
  check(!injected.pwned && injected.imgs === 0, 'xss: branch name in the status bar is not executed');
  check(injected.text.includes('<img/src=x/onerror=window.__pwned=1>'), 'xss: the branch name is shown as plain text');

  check(errors.length === 0, `no uncaught errors${errors.length ? ': ' + errors[0] : ''}`);
  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll end-to-end checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
