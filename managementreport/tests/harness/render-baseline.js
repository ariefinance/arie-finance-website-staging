#!/usr/bin/env node
/*
 * render-baseline.js — Playwright harness that drives the CURRENT UNMODIFIED
 * Management Report tool through a full finalisation on the synthetic pack
 * (or, in `--external` mode, on a caller-supplied REAL pack held OUTSIDE the
 * repository), and captures the regression contract's artefacts.
 *
 * Modes:
 *   --capture              write/overwrite the SYNTHETIC baseline in tests/baseline/
 *   --compare              run the SYNTHETIC pack three times and diff against baseline
 *   --external             run against a caller-supplied external pack
 *
 * --external requires:
 *   --pl <path>            external Xero P&L .xlsx
 *   --txn <path>           external Transaction Summary .xlsx
 *   --previous <path>      external Previous Month File (.data)
 *   --input-config <path>  external JSON with manual fill values (kpi, juris,
 *                          industries, commentary, adjustments, overrides)
 *   --output <dir>         external output directory (MUST be OUTSIDE this git
 *                          repository — the harness refuses to write inside it)
 *
 * No external inputs or outputs are ever committed. See README §Deployment
 * gate and env/ENVIRONMENT.md.
 *
 * Requires Chromium at /opt/pw-browsers/chromium and `npm install` in tests/.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
const url  = require('url');
const crypto = require('crypto');
const { execSync } = require('child_process');

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.error('Playwright not installed. Run `npm install` in tests/.'); process.exit(2); }

const CHROMIUM_EXE = '/opt/pw-browsers/chromium';
const REPO = path.resolve(__dirname, '..', '..', '..');
const TESTS = path.resolve(__dirname, '..');
const FIXTURES = path.join(TESTS, 'fixtures');
const BASELINE = path.join(TESTS, 'baseline');

// -----------------------------------------------------------------------------
// CLI parsing.
// -----------------------------------------------------------------------------
function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const MODE = process.argv.includes('--external') ? 'external'
           : process.argv.includes('--capture')  ? 'capture'
           : process.argv.includes('--compare')  ? 'compare'
           : null;
if (!MODE) {
  console.error('Usage:');
  console.error('  render-baseline.js --capture       # write synthetic baseline');
  console.error('  render-baseline.js --compare       # diff synthetic run vs baseline');
  console.error('  render-baseline.js --external --pl <path> --txn <path> --previous <path> --input-config <path> --output <dir>');
  process.exit(2);
}

let inputs = null;
let externalConfig = null;
let outputDir;

// Repo containment check — refuses any path that resolves inside the tests
// directory or the wider repository. Used both for the --output directory
// and defensively for input paths (we accept inputs inside REPO in synthetic
// mode where FIXTURES lives, but external mode must not.)
function assertOutsideRepo(absPath, label) {
  const abs = path.resolve(absPath);
  if (abs === REPO || abs.startsWith(REPO + path.sep)) {
    throw new Error(`${label} path must be OUTSIDE the repository (got ${abs} inside ${REPO}). ` +
      `External regression artefacts must never be written into the public repo.`);
  }
}

if (MODE === 'external') {
  const p = { pl: argVal('--pl'), txn: argVal('--txn'), previous: argVal('--previous'),
              cfg: argVal('--input-config'), out: argVal('--output') };
  for (const k of ['pl','txn','previous','cfg','out']) {
    if (!p[k]) { console.error('--external requires --pl, --txn, --previous, --input-config and --output'); process.exit(2); }
  }
  for (const k of ['pl','txn','previous','cfg']) {
    if (!fs.existsSync(p[k])) { console.error(`missing ${k}: ${p[k]}`); process.exit(2); }
  }
  // Safety: refuse to write inside the repository.
  assertOutsideRepo(p.out, '--output');
  fs.mkdirSync(p.out, { recursive: true });
  inputs = { pl: path.resolve(p.pl), txn: path.resolve(p.txn), previous: path.resolve(p.previous) };
  // Config may be .json or .js (require) — the former is what a real external
  // operator would edit; the latter is how the synthetic pack ships.
  const cfgAbs = path.resolve(p.cfg);
  externalConfig = cfgAbs.endsWith('.js')
    ? require(cfgAbs)
    : JSON.parse(fs.readFileSync(cfgAbs, 'utf8'));
  outputDir = path.resolve(p.out);
  console.log('EXTERNAL MODE — reading real files from outside repo, writing to:', outputDir);
} else {
  inputs = {
    pl:       path.join(FIXTURES, 'synthetic-pl.xlsx'),
    txn:      path.join(FIXTURES, 'synthetic-txn.xlsx'),
    previous: path.join(FIXTURES, 'synthetic-previous.data'),
  };
  // Synthetic fill values — safe to have in source because they are fabricated.
  externalConfig = require(path.join(__dirname, 'synthetic-input.js'));
  outputDir = MODE === 'capture' ? BASELINE
                                 : path.join(BASELINE, 'runs', new Date().toISOString().replace(/[:.]/g,'-'));
}

// -----------------------------------------------------------------------------
// Static server — repository + local fonts.
// -----------------------------------------------------------------------------
function mime(f) {
  if (f.endsWith('.html')) return 'text/html; charset=utf-8';
  if (f.endsWith('.js'))   return 'application/javascript; charset=utf-8';
  if (f.endsWith('.css'))  return 'text/css; charset=utf-8';
  if (f.endsWith('.json')) return 'application/json; charset=utf-8';
  if (f.endsWith('.woff2'))return 'font/woff2';
  return 'application/octet-stream';
}
const FONT_DIR = { hg: path.join(TESTS, 'node_modules', '@fontsource', 'hanken-grotesk', 'files'),
                   nr: path.join(TESTS, 'node_modules', '@fontsource', 'newsreader', 'files') };
function serveTestFont(reqPath, res) {
  const m = reqPath.match(/^\/tests-fonts\/(hg|nr)-(\d{3})-(normal|italic)\.woff2$/);
  if (!m) { res.writeHead(404); return res.end('nf font'); }
  const dir = FONT_DIR[m[1]];
  const prefix = m[1] === 'hg' ? 'hanken-grotesk' : 'newsreader';
  const file = path.join(dir, `${prefix}-latin-${m[2]}-${m[3]}.woff2`);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('nf specific'); }
  res.writeHead(200, { 'Content-Type': 'font/woff2' });
  res.end(fs.readFileSync(file));
}
function startServer(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(url.parse(req.url).pathname);
      if (p.startsWith('/tests-fonts/')) return serveTestFont(p, res);
      if (p.startsWith('/api/managementreport')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'unauthenticated' }));
      }
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

// -----------------------------------------------------------------------------
// Font interception — per-weight, per-style local WOFF2s.
// -----------------------------------------------------------------------------
const FONT_STYLESHEET = `
@font-face { font-family:'Hanken Grotesk'; font-weight:400; font-style:normal; src:url('/tests-fonts/hg-400-normal.woff2') format('woff2'); font-display:block; }
@font-face { font-family:'Hanken Grotesk'; font-weight:500; font-style:normal; src:url('/tests-fonts/hg-500-normal.woff2') format('woff2'); font-display:block; }
@font-face { font-family:'Hanken Grotesk'; font-weight:600; font-style:normal; src:url('/tests-fonts/hg-600-normal.woff2') format('woff2'); font-display:block; }
@font-face { font-family:'Hanken Grotesk'; font-weight:700; font-style:normal; src:url('/tests-fonts/hg-700-normal.woff2') format('woff2'); font-display:block; }
@font-face { font-family:'Newsreader'; font-weight:400; font-style:normal; src:url('/tests-fonts/nr-400-normal.woff2') format('woff2'); font-display:block; }
@font-face { font-family:'Newsreader'; font-weight:500; font-style:normal; src:url('/tests-fonts/nr-500-normal.woff2') format('woff2'); font-display:block; }
@font-face { font-family:'Newsreader'; font-weight:600; font-style:normal; src:url('/tests-fonts/nr-600-normal.woff2') format('woff2'); font-display:block; }
@font-face { font-family:'Newsreader'; font-weight:400; font-style:italic; src:url('/tests-fonts/nr-400-italic.woff2') format('woff2'); font-display:block; }
`;
async function setupFontInterception(page) {
  await page.route(/fonts\.googleapis\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: FONT_STYLESHEET }));
  await page.route(/fonts\.gstatic\.com/, (route) => route.abort());
}

// -----------------------------------------------------------------------------
// Expected readiness signature — the synthetic pack must always produce this
// exact set of pass/warn/blocker labels. Any deviation (extra warning, extra
// blocker) fails Gate 1. This is stronger than "0 blockers".
// -----------------------------------------------------------------------------
const EXPECTED_READINESS_SIGNATURE = {
  blockers: 0,
  warnings: 0,
  passLabels: [
    'Reporting month','Line mapping','Comparative month','Financial data',
    'Per-client denominator','Accounts','Transaction data','Year-to-date volume',
    'Since-incorporation volume','Client count','Jurisdiction distribution',
    'Industry distribution','Pipeline','Regulatory commentary','Technology commentary',
    'EBITDA note','Metrics note','Transaction history','Unit-economics history',
    'Status',
  ],
  warningLabels: [],
  blockerLabels: [],
};

// -----------------------------------------------------------------------------
// Business-snapshot projection — invoked in the browser after finalisation.
// Bound to the report's business boundary; internal names may change without
// changing the snapshot as long as the business output is the same.
// -----------------------------------------------------------------------------
const PROJECT_SNAPSHOT_FN = `(() => {
  try {
    if (typeof S === 'undefined' || !S.rec) return { error: 'no S.rec' };
    // FIGKEYS from production tool. Emit rounded-to-2dp to avoid float noise.
    const FIGKEYS = ['acc','subTxn','fxOther','maint','advisory','rev','staff','prof','other','intro','opex','nonop','ebitda','gp'];
    const round2 = (v) => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 100) / 100 : null;
    const projFig = (o) => { if (!o) return null; const r = {}; for (const k of FIGKEYS) r[k] = round2(o[k]); return r; };
    const c = (typeof compute === 'function') ? compute() : null;
    if (!c) return { error: 'compute() unavailable' };
    // Six-month unit-economics series (last6() slice minus current month, matching
    // the readiness ue-history check surface).
    const l6 = last6();
    const UE = ['gpMargin','revPerClient','gpPerClient','volPerClient','txnPerClient'];
    const ueSeries = l6.map(k => {
      const row = { key: k };
      for (const f of UE) row[f] = round2(metricFor(k, c, f));
      return row;
    });
    // Transaction 6-month series (in/out USD + counts).
    const txnSeries = l6.map(k => {
      const row = { key: k };
      for (const f of ['inUsd','outUsd','inCount','outCount']) row[f] = round2(metricFor(k, c, f));
      return row;
    });
    // Commentary state — capture (noUpdate flag, review flag, text) per section.
    const TEXTS = ['pipeline','regulatory','tech','ebitdaNote','metricsNote'];
    const commentary = {};
    for (const k of TEXTS) {
      commentary[k] = {
        noUpdate: !!(S.rec.noUpdate || {})[k],
        review:   !!(S.rec.review   || {})[k],
        text:     String((S.rec.text || {})[k] || ''),
      };
    }
    // Report-page structure — pull actual titles the tool prepared for the deck.
    const slideEls = [...document.querySelectorAll('.sframe .slide')];
    const pageOrder = slideEls.map((el, i) => {
      const t = el.querySelector('h1, h2, .title, .slide-title');
      return { index: i + 1, title: t ? String(t.textContent || '').trim().slice(0, 120) : '' };
    });
    // Assemble.
    return {
      reportMonth: S.key,
      entity: S.pl && S.pl.entity || S.cfg && S.cfg.entity || null,
      currency: 'USD',
      financials: {
        current:      projFig(c.cur),
        ytd:          projFig(c.ytd),
        comparative:  projFig(c.prev),
        comparativeBasis: c.compSrc,
        comparativeMonth: c.prevKey,
      },
      kpi: {
        clients:        c.clients,
        clientsFromPl:  c.clientsX,
        active:         c.active,
        activeBasis:    String((S.rec.kpi && S.rec.kpi.activeBasis) || ''),
        accountsActive: S.rec.kpi.accountsActive,
        accountsHeld:   S.rec.kpi.accountsHeld,
        jurisdictions:  c.jurisdictions,
        intlPct:        c.intlPct,
        avgRevPerClient: round2(c.avgRevPerClient),
      },
      transactions: {
        current: {
          inUsd:  c.metrics.inUsd,   outUsd:  c.metrics.outUsd,
          inCount: c.metrics.inCount, outCount: c.metrics.outCount,
          volMonth: round2(c.metrics.volMonth),
          volYtd:   round2(c.metrics.volYtd),
          volSinceInc: round2(c.metrics.volSinceInc),
        },
        sixMonth: txnSeries,
      },
      unitEconomics: {
        current: {
          gpMargin:     round2(c.metrics.gpMargin),
          revPerClient: round2(c.metrics.revPerClient),
          gpPerClient:  round2(c.metrics.gpPerClient),
          volPerClient: round2(c.metrics.volPerClient),
          txnPerClient: round2(c.metrics.txnPerClient),
        },
        sixMonth: ueSeries,
      },
      distributions: {
        juris:      (S.rec.juris      || []).map(x => ({ name: String(x.name || '').trim(), count: Number(x.count) || 0 })),
        industries: (S.rec.industries || []).map(x => ({ name: String(x.name || '').trim(), count: Number(x.count) || 0 })),
        jurTot: c.jurTot, indTot: c.indTot,
      },
      commentary,
      adjustments: JSON.parse(JSON.stringify(S.rec.adj || {})),
      overrides:   JSON.parse(JSON.stringify(S.rec.ov  || {})),
      compMode:    S.rec.compMode || null,
      confirmations: JSON.parse(JSON.stringify(S.rec.confirm || {})),
      reportStructure: {
        slideCount: slideEls.length,
        pages: pageOrder,
      },
      publishedHistoryKeys: Object.keys(S.hist || {}).sort(),
    };
  } catch (e) { return { error: String(e && e.stack || e) }; }
})()`;

// -----------------------------------------------------------------------------
// FILL_STATE_FN — populate manual fields from externalConfig. Does NOT write
// directly into S.hist[S.key] — saveNow() at the start of finalizeReport()
// handles that transition faithfully, matching the real operator flow.
// -----------------------------------------------------------------------------
function makeFillFn(cfg) {
  return `(() => {
    try {
      if (typeof S === 'undefined' || !S.rec) return { error: 'no S.rec' };
      const cfg = ${JSON.stringify(cfg)};
      // KPIs
      Object.assign(S.rec.kpi, cfg.kpi);
      // Distributions
      S.rec.juris      = JSON.parse(JSON.stringify(cfg.juris || []));
      S.rec.industries = JSON.parse(JSON.stringify(cfg.industries || []));
      // Commentary
      S.rec.text     = S.rec.text     || {};
      S.rec.noUpdate = S.rec.noUpdate || {};
      S.rec.review   = S.rec.review   || {};
      for (const [k, v] of Object.entries(cfg.commentary || {})) {
        S.rec.text[k]     = String(v.text || '');
        S.rec.noUpdate[k] = !!v.noUpdate;
        S.rec.review[k]   = !!v.review;
      }
      // Confirmations
      S.rec.confirm = Object.assign({}, S.rec.confirm || {}, cfg.confirmations || {});
      // Optional adjustments / overrides
      if (cfg.adjustments) Object.assign(S.rec.adj = S.rec.adj || {}, cfg.adjustments);
      if (cfg.overrides)   Object.assign(S.rec.ov  = S.rec.ov  || {}, cfg.overrides);
      // Apply this month's transaction figures — replicates the tool's own
      // #txnApply button (a user click today). Not a state shortcut; a
      // faithful proxy for that specific operator action.
      const tm = S.txn && S.txn.months && S.txn.months[S.key];
      if (tm) {
        S.rec.txn = { inCount: tm.inCount, outCount: tm.outCount, inUsd: tm.inUsd, outUsd: tm.outUsd };
        if (S.txn.ytd && S.txn.ytd.key === S.key) S.rec.kpi.volYtd = S.txn.ytd.usd / 1e6;
      }
      if (typeof renderAll === 'function') renderAll();
      return { ok: true };
    } catch (e) { return { error: String(e && e.stack || e) }; }
  })()`;
}

// Wrap renderSlidePngs to capture the EXACT images finalizeReport uses.
// Runs BEFORE finalisation is triggered.
const WRAP_RENDER_FN = `(() => {
  try {
    if (typeof renderSlidePngs !== 'function') return { error: 'renderSlidePngs not in scope' };
    if (window.__renderWrapped) return { ok: true, alreadyWrapped: true };
    const original = renderSlidePngs;
    // Redefine the global so finalizeReport() picks up the wrapper.
    // eslint-disable-next-line no-global-assign
    renderSlidePngs = async function(...args) {
      const imgs = await original.apply(this, args);
      window.__regressionFinalImages = imgs;
      return imgs;
    };
    window.__renderWrapped = true;
    return { ok: true };
  } catch (e) { return { error: String(e && e.stack || e) }; }
})()`;

// Extract finalSnapshot + intercepted images as base64.
const EXTRACT_FINAL_FN = `(async () => {
  try {
    if (typeof finalSnapshot === 'undefined' || !finalSnapshot) return { error: 'no finalSnapshot' };
    const asBase64 = (blob) => new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result.split(',')[1]);
      fr.readAsDataURL(blob);
    });
    return {
      month: finalSnapshot.month,
      pdf:  { name: finalSnapshot.pdf.name,  b64: await asBase64(finalSnapshot.pdf.blob)  },
      pptx: { name: finalSnapshot.pptx.name, b64: await asBase64(finalSnapshot.pptx.blob) },
      data: { name: finalSnapshot.data.name, b64: await asBase64(finalSnapshot.data.blob) },
      images: Array.isArray(window.__regressionFinalImages) ? window.__regressionFinalImages : null,
    };
  } catch (e) { return { error: String(e && e.stack || e) }; }
})()`;

// -----------------------------------------------------------------------------
// Byte inspectors — no external deps.
// -----------------------------------------------------------------------------
function countPdfPages(buf) {
  const s = buf.toString('binary');
  const re = /\/Type\s*\/Page(?!s)/g;
  return (s.match(re) || []).length;
}
function countPptxSlides(buf) {
  let i = buf.length - 22;
  const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  for (; i >= 0 && i >= buf.length - 65557; i--) {
    if (buf[i] === EOCD[0] && buf[i+1] === EOCD[1] && buf[i+2] === EOCD[2] && buf[i+3] === EOCD[3]) break;
  }
  if (i < 0) throw new Error('EOCD not found');
  const cdOffset = buf.readUInt32LE(i + 16);
  const cdSize   = buf.readUInt32LE(i + 12);
  const cd = buf.slice(cdOffset, cdOffset + cdSize);
  let slides = 0, off = 0;
  const SIG = 0x02014b50;
  while (off + 46 <= cd.length && cd.readUInt32LE(off) === SIG) {
    const nameLen  = cd.readUInt16LE(off + 28);
    const extraLen = cd.readUInt16LE(off + 30);
    const commLen  = cd.readUInt16LE(off + 32);
    const name = cd.slice(off + 46, off + 46 + nameLen).toString('utf8');
    if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) slides++;
    off += 46 + nameLen + extraLen + commLen;
  }
  return slides;
}
function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function run() {
  const server = await startServer(4173);
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
  page.on('console', (m) => { if (m.type() === 'error') console.log('  console.error:', m.text().slice(0, 400)); });
  page.on('pageerror', (e) => console.log('  PAGEERROR:', e.message));

  await page.goto('http://127.0.0.1:4173/managementreport/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { const g = document.getElementById('mrgate'); if (g) g.remove(); });
  await page.evaluate(() => document.fonts.ready);

  // Upload flow.
  await page.waitForSelector('#contFile', { state: 'attached', timeout: 10000 });
  await page.setInputFiles('#contFile', inputs.previous);
  // For synthetic pack the previous is Aug; for external, whatever the caller supplied.
  const previousMonthKey = MODE === 'external' ? (externalConfig.previousReportingMonth || null) : '2026-08';
  if (previousMonthKey) {
    await page.waitForFunction((k) =>
      (typeof S !== 'undefined') && S.hist && !!S.hist[k], previousMonthKey, { timeout: 10000 });
  }

  await page.setInputFiles('#file', [inputs.pl, inputs.txn]);
  await page.waitForFunction(() =>
    (typeof S !== 'undefined') && !!S.pl && !!S.txn && S.pl.months && S.pl.months.length >= 1,
    { timeout: 10000 });

  const fill = await page.evaluate(makeFillFn(externalConfig));
  if (!fill || fill.error) throw new Error('state fill failed: ' + (fill && fill.error));

  // Assert readiness signature — labels of each severity must match expectations exactly.
  const rdy = await page.evaluate(() => {
    try {
      if (typeof readiness !== 'function') return { error: 'readiness() not in scope' };
      const R = readiness();
      return { errors: R.errors, warns: R.warns,
               items: R.items.map(x => ({ lvl: x.lvl, label: x.label })) };
    } catch (e) { return { error: String(e && e.stack || e) }; }
  });
  if (!rdy || rdy.error) throw new Error('readiness eval failed: ' + (rdy && rdy.error));
  const blockerLabels = rdy.items.filter(x => x.lvl === 'e').map(x => x.label).sort();
  const warningLabels = rdy.items.filter(x => x.lvl === 'w').map(x => x.label).sort();
  const passLabels    = rdy.items.filter(x => x.lvl === 'o').map(x => x.label).sort();
  if (MODE !== 'external') {
    const exp = EXPECTED_READINESS_SIGNATURE;
    const expBlockers = exp.blockerLabels.slice().sort();
    const expWarns    = exp.warningLabels.slice().sort();
    const expPass     = exp.passLabels.slice().sort();
    const check = (a, e, name) => {
      if (JSON.stringify(a) !== JSON.stringify(e)) {
        throw new Error(name + ' set differs. expected=' + JSON.stringify(e) + ' actual=' + JSON.stringify(a));
      }
    };
    check(blockerLabels, expBlockers, 'readiness blockers');
    check(warningLabels, expWarns,    'readiness warnings');
    check(passLabels,    expPass,     'readiness pass labels');
    console.log(`  readiness signature MATCHED: 0/0/${passLabels.length} (blockers/warnings/pass)`);
  } else {
    console.log(`  readiness (external): ${blockerLabels.length} blockers, ${warningLabels.length} warnings, ${passLabels.length} passed`);
    if (blockerLabels.length) throw new Error('external readiness has blockers: ' + JSON.stringify(blockerLabels));
  }

  // Wrap renderSlidePngs BEFORE clicking finalise so the FIRST render — the
  // one finalizeReport actually feeds into the PDF and PPTX builders — is the
  // one we capture.
  const wrap = await page.evaluate(WRAP_RENDER_FN);
  if (!wrap || wrap.error) throw new Error('render wrap failed: ' + (wrap && wrap.error));

  await page.evaluate(() => document.getElementById('btnPdf').click());
  await page.waitForFunction(
    () => (typeof finalSnapshot !== 'undefined') && !!finalSnapshot,
    { timeout: 60000 });

  const final = await page.evaluate(EXTRACT_FINAL_FN);
  if (!final || final.error) throw new Error(final && final.error);
  if (!Array.isArray(final.images) || final.images.length !== 11) {
    throw new Error('expected 11 intercepted final images, got ' + (final.images && final.images.length));
  }
  const pdfBuf  = Buffer.from(final.pdf.b64, 'base64');
  const pptxBuf = Buffer.from(final.pptx.b64, 'base64');
  const dataBuf = Buffer.from(final.data.b64, 'base64');
  const dataObj = JSON.parse(dataBuf.toString('utf8'));

  const businessSnapshot = await page.evaluate(PROJECT_SNAPSHOT_FN);
  if (businessSnapshot && businessSnapshot.error) throw new Error('project failed: ' + businessSnapshot.error);

  const snapshot = {
    reportMonth: businessSnapshot.reportMonth,
    entity: businessSnapshot.entity,
    currency: businessSnapshot.currency,
    finalisedFor: final.month,
    financials:     businessSnapshot.financials,
    kpi:            businessSnapshot.kpi,
    transactions:   businessSnapshot.transactions,
    unitEconomics:  businessSnapshot.unitEconomics,
    distributions:  businessSnapshot.distributions,
    commentary:     businessSnapshot.commentary,
    adjustments:    businessSnapshot.adjustments,
    overrides:      businessSnapshot.overrides,
    compMode:       businessSnapshot.compMode,
    confirmations:  businessSnapshot.confirmations,
    reportStructure: businessSnapshot.reportStructure,
    publishedHistoryKeys: businessSnapshot.publishedHistoryKeys,
    outputs: {
      pdf:  { pageCount: countPdfPages(pdfBuf),   md5: md5(pdfBuf),  bytes: pdfBuf.length,  name: final.pdf.name },
      pptx: { slideCount: countPptxSlides(pptxBuf), md5: md5(pptxBuf), bytes: pptxBuf.length, name: final.pptx.name },
      continuation: {
        formatId: dataObj.formatId,
        schemaVersion: dataObj.schemaVersion,
        reportingMonth: dataObj.reportingMonth,
        checksum: dataObj.checksum,
        histMonthCount: dataObj.hist ? Object.keys(dataObj.hist).length : 0,
        histMonths: dataObj.hist ? Object.keys(dataObj.hist).sort() : [],
        name: final.data.name,
      },
    },
    pageHashes: final.images.map(u => md5(Buffer.from(u.split(',')[1], 'base64'))),
    pageCount: final.images.length,
    imageSource: 'intercepted from finalizeReport() before PDF/PPTX build',
    readinessSignature: {
      blockers: blockerLabels.length, warnings: warningLabels.length,
      blockerLabels, warningLabels, passLabels,
    },
  };

  const pagesOut = path.join(outputDir, 'pages');
  fs.mkdirSync(pagesOut, { recursive: true });
  final.images.forEach((dataUrl, i) => {
    fs.writeFileSync(path.join(pagesOut, `page-${String(i+1).padStart(2,'0')}.jpg`),
                     Buffer.from(dataUrl.split(',')[1], 'base64'));
  });
  fs.writeFileSync(path.join(outputDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2));

  const manifest = {
    capturedAt: new Date().toISOString(),
    mode: MODE,
    external: MODE === 'external',
    chromium: await browser.version(),
    playwright: require('playwright/package.json').version,
    viewport: '1280x720',
    deviceScaleFactor: 1,
    fontPack: 'fontsource@5.1.0 (Hanken Grotesk + Newsreader), per-weight WOFF2 served from local static server',
    inputs: MODE === 'external' ? { note: 'external paths intentionally not recorded here' } : {
      pl:   fs.statSync(inputs.pl).size,
      txn:  fs.statSync(inputs.txn).size,
      prev: fs.statSync(inputs.previous).size,
    },
  };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('  wrote:', outputDir);
  console.log('  pdf pages:', snapshot.outputs.pdf.pageCount, 'pptx slides:', snapshot.outputs.pptx.slideCount, 'page pngs:', final.images.length);

  await browser.close();
  server.close();

  // Compare mode: diff against synthetic baseline.
  if (MODE === 'compare') {
    const baseSnap = JSON.parse(fs.readFileSync(path.join(BASELINE, 'snapshot.json'), 'utf8'));
    const runSnap  = JSON.parse(fs.readFileSync(path.join(outputDir, 'snapshot.json'), 'utf8'));
    const scrub = (o) => {
      const c = JSON.parse(JSON.stringify(o));
      if (c.outputs) {
        if (c.outputs.pdf)  { delete c.outputs.pdf.md5;  delete c.outputs.pdf.bytes;  }
        if (c.outputs.pptx) { delete c.outputs.pptx.md5; delete c.outputs.pptx.bytes; }
        if (c.outputs.continuation) delete c.outputs.continuation.checksum;
      }
      return c;
    };
    const a = JSON.stringify(scrub(baseSnap));
    const b = JSON.stringify(scrub(runSnap));
    if (a !== b) {
      // Detailed diff to find the first differing top-level key.
      const [bo, ro] = [scrub(baseSnap), scrub(runSnap)];
      for (const k of Object.keys(bo)) {
        if (JSON.stringify(bo[k]) !== JSON.stringify(ro[k])) {
          console.error('  first differing top-level key:', k);
          console.error('    baseline:', JSON.stringify(bo[k]).slice(0, 300));
          console.error('    this run:', JSON.stringify(ro[k]).slice(0, 300));
          break;
        }
      }
      throw new Error('business snapshot mismatch');
    }
    for (let i = 1; i <= 11; i++) {
      const bp = path.join(BASELINE, 'pages', `page-${String(i).padStart(2,'0')}.jpg`);
      const rp = path.join(outputDir,   'pages', `page-${String(i).padStart(2,'0')}.jpg`);
      const bh = md5(fs.readFileSync(bp));
      const rh = md5(fs.readFileSync(rp));
      if (bh !== rh) throw new Error('page ' + i + ' MD5 differs (' + bh + ' vs ' + rh + ')');
    }
    console.log('  COMPARE PASS: 11 pages byte-identical, expanded business snapshot identical, PDF/PPTX structural match');
  }
}

run().then(() => { console.log('OK'); process.exit(0); },
          (err) => { console.error('FAIL:', err && err.stack || err); process.exit(1); });
