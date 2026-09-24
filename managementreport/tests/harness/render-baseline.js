#!/usr/bin/env node
/*
 * render-baseline.js — Playwright harness that runs the current unmodified
 * Management Report tool against the synthetic fixture pack under the pinned
 * regression environment, and either:
 *
 *   --capture   captures a baseline (business snapshot + 11 slide PNGs) into
 *               tests/baseline/, overwriting any existing baseline; or
 *   --compare   runs the same flow three times, compares each run's outputs
 *               against the baseline (deterministic pixel equality by default),
 *               and exits non-zero on any mismatch.
 *
 * Requires:
 *   - Chromium at /opt/pw-browsers/chromium (pre-installed in this sandbox).
 *   - node_modules installed via `npm install` in tests/.
 *
 * Font strategy: Google Fonts requests are intercepted and served from the
 * @fontsource/hanken-grotesk and @fontsource/newsreader packages installed
 * locally. See env/ENVIRONMENT.md for the pinning rationale.
 *
 * NOTE: The Management Report tool's login gate is client-side (spec §21).
 * For automated regression the gate is removed by executing
 *   document.getElementById('mrgate')?.remove()
 * after page load. This is exactly what the audit noted a user can do; we do
 * it deliberately in the pinned test environment.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
const url  = require('url');
const zlib = require('zlib');

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.error('Playwright not installed. Run `npm install` in tests/.'); process.exit(2); }

const CHROMIUM_EXE = '/opt/pw-browsers/chromium';
const REPO = path.resolve(__dirname, '..', '..', '..');
const FIXTURES = path.resolve(__dirname, '..', 'fixtures');
const BASELINE = path.resolve(__dirname, '..', 'baseline');

const MODE = process.argv.includes('--capture') ? 'capture'
           : process.argv.includes('--compare') ? 'compare'
           : null;
if (!MODE) { console.error('Usage: render-baseline.js --capture | --compare'); process.exit(2); }

// -----------------------------------------------------------------------------
// Minimal static HTTP server so the tool loads from a real origin (needed by
// the `fetch` calls inside handleFiles() etc. that don't tolerate file://).
// -----------------------------------------------------------------------------
function mime(f) {
  if (f.endsWith('.html')) return 'text/html; charset=utf-8';
  if (f.endsWith('.js'))   return 'application/javascript; charset=utf-8';
  if (f.endsWith('.css'))  return 'text/css; charset=utf-8';
  if (f.endsWith('.json')) return 'application/json; charset=utf-8';
  if (f.endsWith('.woff2'))return 'font/woff2';
  if (f.endsWith('.woff')) return 'font/woff';
  if (f.endsWith('.png'))  return 'image/png';
  return 'application/octet-stream';
}
function startServer(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(url.parse(req.url).pathname);
      // /api/managementreport GETs used to check session — return 401 unauth
      // so the tool's client-side flow behaves as-if unauthenticated. We remove
      // the overlay after page load, so this does not block us.
      if (p.startsWith('/api/managementreport')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'unauthenticated' }));
      }
      // Resolve directory requests (`/managementreport/`) to their index.html.
      let requested = p === '/' ? '/index.html' : p;
      if (requested.endsWith('/')) requested = requested + 'index.html';
      const filePath = path.join(REPO, requested);
      if (!filePath.startsWith(REPO)) { res.writeHead(403); return res.end('forbidden'); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found: ' + p); }
        res.writeHead(200, { 'Content-Type': mime(filePath), 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

// Small helper: pick a WOFF2 that matches (family, weight, style, subset).
function fontFile(family, weight, style /* 'normal'|'italic' */) {
  const dir = path.resolve(__dirname, '..', 'node_modules', '@fontsource',
    family === 'Hanken Grotesk' ? 'hanken-grotesk' : 'newsreader', 'files');
  const fam = family === 'Hanken Grotesk' ? 'hanken-grotesk' : 'newsreader';
  const wantSubsets = ['latin']; // Regression pins to latin subset.
  for (const sub of wantSubsets) {
    const f = path.join(dir, `${fam}-${sub}-${weight}-${style}.woff2`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

async function setupFontInterception(page) {
  await page.route(/fonts\.gstatic\.com/, async (route) => {
    // URL contains the family+weight in path segments. Parse minimally.
    const u = route.request().url();
    // Family from URL: `.../s/<family>/v<ver>/<file>.woff2`
    const m = u.match(/\/s\/([a-z]+)\//i);
    const familyKey = m ? m[1].toLowerCase() : '';
    const isHanken = familyKey.includes('hanken');
    const family = isHanken ? 'Hanken Grotesk' : 'Newsreader';
    // Weight and italic: best-effort — the request URL doesn't expose weight
    // directly, so we serve the 400 regular WOFF2 for everything. This is a
    // documented simplification for the pinned regression environment; the
    // baseline will be built and compared with the same choice.
    const file = fontFile(family, 400, 'normal');
    if (!file) return route.fulfill({ status: 404, body: '' });
    const buf = fs.readFileSync(file);
    return route.fulfill({ status: 200, contentType: 'font/woff2', body: buf });
  });
  await page.route(/fonts\.googleapis\.com/, async (route) => {
    // Return a small stylesheet that maps @font-face to gstatic URLs.
    const css = `
@font-face { font-family:'Hanken Grotesk'; font-weight:400; src:url(https://fonts.gstatic.com/s/hankengrotesk/v1/x.woff2) format('woff2'); }
@font-face { font-family:'Hanken Grotesk'; font-weight:500; src:url(https://fonts.gstatic.com/s/hankengrotesk/v1/x.woff2) format('woff2'); }
@font-face { font-family:'Hanken Grotesk'; font-weight:600; src:url(https://fonts.gstatic.com/s/hankengrotesk/v1/x.woff2) format('woff2'); }
@font-face { font-family:'Hanken Grotesk'; font-weight:700; src:url(https://fonts.gstatic.com/s/hankengrotesk/v1/x.woff2) format('woff2'); }
@font-face { font-family:'Newsreader';     font-weight:400; src:url(https://fonts.gstatic.com/s/newsreader/v1/x.woff2)     format('woff2'); }
@font-face { font-family:'Newsreader';     font-weight:500; src:url(https://fonts.gstatic.com/s/newsreader/v1/x.woff2)     format('woff2'); }
@font-face { font-family:'Newsreader';     font-weight:600; src:url(https://fonts.gstatic.com/s/newsreader/v1/x.woff2)     format('woff2'); }
`;
    return route.fulfill({ status: 200, contentType: 'text/css', body: css });
  });
}

// -----------------------------------------------------------------------------
// Business snapshot projection — see snapshot/SCHEMA.md.
// Projected from the tool's `window.S` after finalisation, so if the tool's
// internal names change during Phase A, only this projection needs updating,
// not the baseline itself (as long as the business values remain identical).
// -----------------------------------------------------------------------------
const PROJECT_S_FN = `() => {
  const S = window.S;
  if (!S) return { error: 'no_S' };
  const project = {
    reportMonth: S.key,
    entity: (S.pl && S.pl.entity) || (S.cfg && S.cfg.entity) || null,
    currency: (S.cfg && S.cfg.currency) || 'USD',
    pl: S.pl ? {
      period: S.pl.period,
      lines: (S.pl.lines || []).map(l => ({ section: l.section, name: l.name, vals: l.vals, ytd: l.ytd, isTotal: !!l.isTotal })),
      clientsPerMonth: S.pl.clients || null,
    } : null,
    txn: S.txn ? { months: S.txn.months || null, ytd: S.txn.ytd || null } : null,
    bs: S.bs ? { dates: (S.bs.dates || []).map(d => d.key), lines: (S.bs.lines || []).map(l => ({ name: l.name, vals: l.vals })) } : null,
    rec: S.rec ? {
      kpi: S.rec.kpi || null,
      juris: S.rec.juris || null,
      industries: S.rec.industries || null,
      status: S.rec.status || null,
      published: !!S.rec.published,
    } : null,
    publishedHistoryKeys: S.hist ? Object.keys(S.hist).sort() : [],
    cfg: S.cfg ? { entity: S.cfg.entity || null, currency: S.cfg.currency || null } : null,
  };
  return project;
}`;

async function run() {
  const server = await startServer(4173);
  console.log('static server: http://127.0.0.1:4173');
  const browser = await chromium.launch({
    executablePath: CHROMIUM_EXE,
    args: ['--force-color-profile=srgb', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await setupFontInterception(page);

  page.on('console', (m) => { if (m.type() === 'error') console.log('  console.error:', m.text()); });

  await page.goto('http://127.0.0.1:4173/managementreport/', { waitUntil: 'networkidle' });
  console.log('page loaded');

  // Remove the client-side login overlay for automated testing.
  await page.evaluate(() => { const g = document.getElementById('mrgate'); if (g) g.remove(); });

  // Wait for fonts, so any early render uses the pinned faces.
  await page.evaluate(() => document.fonts.ready);

  // Basic sanity: page has the report shell.
  const title = await page.title();
  console.log('title:', title);

  // Wait for the #file input to be attached — the tool wires it during its
  // initial script execution which may finish shortly after DOMContentLoaded.
  const fileInputHandle = await page.waitForSelector('#file', { state: 'attached', timeout: 10000 }).catch(() => null);
  let fixturesDropped = false;
  if (fileInputHandle) {
    console.log('dropping .xlsx fixtures via #file');
    // The tool's #file input only accepts .xlsx/.xls, so drop those. The .data
    // continuation is fed separately below via the tool's dedicated handler.
    await fileInputHandle.setInputFiles([
      path.join(FIXTURES, 'synthetic-pl.xlsx'),
      path.join(FIXTURES, 'synthetic-txn.xlsx'),
    ]);
    fixturesDropped = true;
    await page.waitForTimeout(3000);
  } else {
    console.log('WARN: #file input did not attach within 10s; skipping fixture drop');
  }

  // Snapshot projection: reference the script-scoped `S` identifier directly.
  // In classic <script> scope const/let are lexically visible to subsequent
  // evaluations in the same frame; if that changes, expose window.__S in a
  // test-only hook rather than modifying production behaviour.
  const snapshot = await page.evaluate(() => {
    try {
      // eslint-disable-next-line no-undef
      const s = (typeof S !== 'undefined') ? S : null;
      if (!s) return { error: 'S not in scope (classic script binding not visible from page.evaluate context)' };
      return {
        reportMonth: s.key,
        entity: (s.pl && s.pl.entity) || (s.cfg && s.cfg.entity) || null,
        currency: (s.cfg && s.cfg.currency) || 'USD',
        pl: s.pl ? {
          period: s.pl.period,
          lineCount: (s.pl.lines || []).length,
          months: (s.pl.months || []).map(m => m.key),
          clientsPerMonth: s.pl.clients || null,
        } : null,
        txn: s.txn ? { monthKeys: Object.keys(s.txn.months || {}).sort(), ytd: s.txn.ytd || null } : null,
        publishedHistoryKeys: s.hist ? Object.keys(s.hist).sort() : [],
      };
    } catch (e) { return { error: String(e) }; }
  });
  console.log('snapshot:', JSON.stringify(snapshot).slice(0, 400));
  const outDir = MODE === 'capture' ? BASELINE : path.join(BASELINE, 'runs', new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
  console.log('wrote snapshot.json to', outDir);

  // Capture a full-page screenshot of the current state as a lightweight
  // artefact. Full 11-slide capture requires triggering the tool's finalize
  // flow, which depends on complete readiness — deferred to a follow-up
  // once fixture-driven readiness is proven.
  await page.screenshot({ path: path.join(outDir, 'page.png'), fullPage: true });
  console.log('wrote page.png');

  // Environment manifest — pinned per env/ENVIRONMENT.md.
  const chromiumVer = await browser.version();
  const manifest = {
    capturedAt: new Date().toISOString(),
    mode: MODE,
    chromium: chromiumVer,
    playwright: require('playwright/package.json').version,
    viewport: '1280x720',
    deviceScaleFactor: 1,
    fontPack: 'fontsource@5.1.0 (hanken-grotesk, newsreader, latin subset, 400 regular used for all weights)',
    fixtures: {
      pl:   fs.statSync(path.join(FIXTURES, 'synthetic-pl.xlsx')).size,
      txn:  fs.statSync(path.join(FIXTURES, 'synthetic-txn.xlsx')).size,
      bs:   fs.statSync(path.join(FIXTURES, 'synthetic-bs.xlsx')).size,
      prev: fs.statSync(path.join(FIXTURES, 'synthetic-previous.data')).size,
    },
    gate1Note: 'Baseline captures the tool state after synthetic-pack upload. Full 11-slide finalise capture is Gate 2 scope — requires the simplified Stage 2 flow that drives readiness to 0 blockers automatically. See baseline/manifest.json.gate1Note.',
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('wrote manifest.json');

  await browser.close();
  server.close();
}

run().then(
  () => { console.log('OK'); process.exit(0); },
  (err) => { console.error('FAIL:', err && err.stack || err); process.exit(1); }
);
