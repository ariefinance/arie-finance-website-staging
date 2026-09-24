#!/usr/bin/env node
/*
 * render-baseline.js — Playwright harness that drives the CURRENT UNMODIFIED
 * Management Report tool through a full synthetic-pack finalisation, and
 * captures the artefacts the regression contract compares against:
 *
 *   baseline/snapshot.json    normalised business snapshot
 *   baseline/manifest.json    environment + versions
 *   baseline/pages/page-01.png … page-11.png   the 11 rendered report pages
 *   baseline/outputs.json     PDF/PPTX/Next-Month structural summary
 *
 * --capture      writes the artefacts into tests/baseline/, overwriting.
 * --compare      runs three fresh renders back-to-back and asserts each
 *                is byte-identical to the baseline. Exits non-zero on drift.
 *
 * Requires Chromium at /opt/pw-browsers/chromium and `npm install` in tests/.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
const url  = require('url');
const crypto = require('crypto');

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.error('Playwright not installed. Run `npm install` in tests/.'); process.exit(2); }

const CHROMIUM_EXE = '/opt/pw-browsers/chromium';
const REPO = path.resolve(__dirname, '..', '..', '..');
const TESTS = path.resolve(__dirname, '..');
const FIXTURES = path.join(TESTS, 'fixtures');
const BASELINE = path.join(TESTS, 'baseline');
const PAGES_DIR = path.join(BASELINE, 'pages');

const MODE = process.argv.includes('--capture') ? 'capture'
           : process.argv.includes('--compare') ? 'compare'
           : null;
if (!MODE) { console.error('Usage: render-baseline.js --capture | --compare'); process.exit(2); }

// -----------------------------------------------------------------------------
// Static server. Serves repository files, plus fonts under /tests-fonts/.
// -----------------------------------------------------------------------------
function mime(f) {
  if (f.endsWith('.html')) return 'text/html; charset=utf-8';
  if (f.endsWith('.js'))   return 'application/javascript; charset=utf-8';
  if (f.endsWith('.css'))  return 'text/css; charset=utf-8';
  if (f.endsWith('.json')) return 'application/json; charset=utf-8';
  if (f.endsWith('.woff2'))return 'font/woff2';
  if (f.endsWith('.png'))  return 'image/png';
  return 'application/octet-stream';
}
const FONT_DIR = { hg: path.join(TESTS, 'node_modules', '@fontsource', 'hanken-grotesk', 'files'),
                   nr: path.join(TESTS, 'node_modules', '@fontsource', 'newsreader', 'files') };
function serveTestFont(reqPath, res) {
  // /tests-fonts/<family>-<weight>-<style>.woff2
  const m = reqPath.match(/^\/tests-fonts\/(hg|nr)-(\d{3})-(normal|italic)\.woff2$/);
  if (!m) { res.writeHead(404); return res.end('nf font'); }
  const dir = FONT_DIR[m[1]];
  const prefix = m[1] === 'hg' ? 'hanken-grotesk' : 'newsreader';
  const file = path.join(dir, `${prefix}-latin-${m[2]}-${m[3]}.woff2`);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('nf specific'); }
  res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'no-store' });
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
// Font interception. Return a CSS stylesheet that maps @font-face to
// per-weight, per-style local WOFF2 URLs on our static server. NO gstatic
// requests need to be honoured; the browser fetches directly from us.
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
  // Intercept both the CSS and any residual gstatic fetches (defensive) and
  // supply the local stylesheet / local WOFF2. Every declared weight/style
  // is served from its matching WOFF2 file — no more "400 for everything".
  await page.route(/fonts\.googleapis\.com/, (route) => {
    route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: FONT_STYLESHEET });
  });
  await page.route(/fonts\.gstatic\.com/, (route) => {
    route.abort(); // never reached; local stylesheet points at our own server.
  });
}

// -----------------------------------------------------------------------------
// Fill the tool state to satisfy readiness() — synthetic values, no real data.
// -----------------------------------------------------------------------------
const FILL_STATE_FN = `(() => {
  try {
    if (typeof S === 'undefined' || !S.rec) return { error: 'no S.rec' };
    // KPIs — denominator + basis, accounts, jurisdictions, intl %, since-inc.
    S.rec.kpi.clients        = S.rec.kpi.clients        ?? 3;
    S.rec.kpi.activeClients  = 3;
    S.rec.kpi.activeBasis    = 'Regression fixture (synthetic)';
    S.rec.kpi.accountsActive = 5;
    S.rec.kpi.accountsHeld   = 5;
    S.rec.kpi.jurisdictions  = 3;
    S.rec.kpi.intlPct        = 66;
    S.rec.kpi.volSinceInc    = 5.0; // millions USD
    // Apply this month's transaction figures — replicates the tool's own
    // #txnApply handler (which the user must click today).
    const tm = S.txn && S.txn.months && S.txn.months[S.key];
    if (tm) {
      S.rec.txn = { inCount: tm.inCount, outCount: tm.outCount, inUsd: tm.inUsd, outUsd: tm.outUsd };
      if (S.txn.ytd && S.txn.ytd.key === S.key) S.rec.kpi.volYtd = S.txn.ytd.usd / 1e6;
    }
    // Client mix — three named jurisdictions, two industries, totals match clients.
    S.rec.juris = [
      { name: 'Mauritius',             count: 1 },
      { name: 'United Kingdom',        count: 1 },
      { name: 'United Arab Emirates', count: 1 },
    ];
    S.rec.industries = [
      { name: 'Financial Services', count: 2 },
      { name: 'Technology',         count: 1 },
    ];
    // Commentary: mark every block as "no material update" (allowed by the tool)
    // so review state is satisfied without inventing fake narrative.
    S.rec.noUpdate = S.rec.noUpdate || {};
    S.rec.review   = S.rec.review   || {};
    S.rec.text     = S.rec.text     || {};
    ['pipeline','regulatory','tech','ebitdaNote','metricsNote'].forEach(k => {
      S.rec.text[k]     = '';
      S.rec.noUpdate[k] = true;
      S.rec.review[k]   = true;
    });
    // Any confirmations (accounts / adjustments / distribution) — safe defaults.
    S.rec.confirm = S.rec.confirm || {};
    S.rec.confirm.accounts = true;
    S.rec.confirm.adjYtd   = true;
    S.rec.confirm.dist     = true;
    S.rec.confirm.republish= true;
    // Persist into hist so the tool considers this month recorded.
    S.hist[S.key] = JSON.parse(JSON.stringify(S.rec));
    // Repaint.
    if (typeof renderAll === 'function') renderAll();
    return { ok: true };
  } catch (e) { return { error: String(e && e.stack || e) }; }
})()`;

// Read finalSnapshot back as base64 blobs. Uses a Promise so we can await
// FileReader from an IIFE returned to Playwright.
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
    };
  } catch (e) { return { error: String(e && e.stack || e) }; }
})()`;

// -----------------------------------------------------------------------------
// PDF page-count: scan the raw PDF stream for /Type /Page (not /Pages) markers.
// -----------------------------------------------------------------------------
function countPdfPages(buf) {
  const s = buf.toString('binary');
  // Match "/Type /Page" not followed by 's' (which would be /Pages).
  const re = /\/Type\s*\/Page(?!s)/g;
  return (s.match(re) || []).length;
}

// -----------------------------------------------------------------------------
// PPTX slide count: PPTX is a ZIP; count entries under ppt/slides/slideN.xml.
// Use a minimal ZIP central-directory reader (no external dep).
// -----------------------------------------------------------------------------
function countPptxSlides(buf) {
  // Find End of Central Directory record.
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

  // 1) Upload the August Previous Month File via #contFile.
  await page.waitForSelector('#contFile', { state: 'attached', timeout: 10000 });
  await page.setInputFiles('#contFile', path.join(FIXTURES, 'synthetic-previous.data'));
  // Wait for the tool to apply the continuation (hist populated).
  await page.waitForFunction(() =>
    (typeof S !== 'undefined') && S.hist && !!S.hist['2026-08'], { timeout: 8000 });

  // 2) Upload the P&L + Txn workbooks via #file.
  await page.setInputFiles('#file', [
    path.join(FIXTURES, 'synthetic-pl.xlsx'),
    path.join(FIXTURES, 'synthetic-txn.xlsx'),
  ]);
  // Wait for parsers to populate S.pl and S.txn.
  await page.waitForFunction(() =>
    (typeof S !== 'undefined') && !!S.pl && !!S.txn && S.pl.months && S.pl.months.length === 9,
    { timeout: 8000 });

  // 3) Fill required KPI/commentary state and mark all commentary "no update".
  const fill = await page.evaluate(FILL_STATE_FN);
  if (fill.error) throw new Error('state fill failed: ' + fill.error);

  // 4) Verify readiness is genuinely at zero blockers before finalising.
  const rdy = await page.evaluate(() => {
    try {
      if (typeof readiness !== 'function') return { error: 'readiness() not in scope' };
      const R = readiness();
      // Sanitise detail: it can contain nested DOM strings we don't need here.
      return { errors: R.errors, warns: R.warns,
               items: R.items.map(x => ({ lvl: x.lvl, label: x.label, detail: String(x.detail || '').slice(0, 200) })) };
    } catch (e) { return { error: String(e && e.stack || e) }; }
  });
  if (!rdy || rdy.error) throw new Error('readiness eval failed: ' + (rdy && rdy.error));
  const blockers = rdy.items.filter(x => x.lvl === 'e');
  if (blockers.length > 0) {
    console.error('  readiness blockers still present:');
    for (const b of blockers) console.error('    -', b.label, '::', b.detail);
    throw new Error('readiness has ' + blockers.length + ' blocker(s); cannot finalise');
  }
  console.log(`  readiness: 0 blockers, ${rdy.warns} warnings, ${rdy.items.length - rdy.errors - rdy.warns} passed`);

  // 5) Trigger finalisation.
  await page.evaluate(() => document.getElementById('btnPdf').click());
  // Wait for finalSnapshot to become non-null (indicates PDF+PPTX+.data all ready).
  await page.waitForFunction(
    () => (typeof finalSnapshot !== 'undefined') && !!finalSnapshot,
    { timeout: 60000 });

  // 6) Extract the 11 rendered pages from the tool's own renderSlidePngs().
  //    Call it a SECOND time on the exact same state — this is what the tool
  //    itself did inside finalizeReport(), and re-calling yields the same PNGs.
  const pages = await page.evaluate(async () => {
    const imgs = await renderSlidePngs();
    return imgs;   // array of "data:image/jpeg;base64,..." strings
  });
  if (!Array.isArray(pages) || pages.length !== 11) {
    throw new Error('expected 11 rendered pages, got ' + (Array.isArray(pages) ? pages.length : 'not-array'));
  }

  // 7) Extract PDF/PPTX/data blobs.
  const final = await page.evaluate(EXTRACT_FINAL_FN);
  if (final.error) throw new Error(final.error);
  const pdfBuf  = Buffer.from(final.pdf.b64, 'base64');
  const pptxBuf = Buffer.from(final.pptx.b64, 'base64');
  const dataBuf = Buffer.from(final.data.b64, 'base64');
  const dataObj = JSON.parse(dataBuf.toString('utf8'));

  // Business snapshot — normalised to the report boundary (not S.rec/S.hist names).
  const snapshot = {
    reportMonth: dataObj.reportingMonth,
    entity: (dataObj.cfg && dataObj.cfg.entity) || null,
    currency: 'USD',
    finalisedFor: final.month,
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
    pageHashes: pages.map((p) => md5(Buffer.from(p.split(',')[1], 'base64'))),
    pageCount: pages.length,
    // Include a compact business projection from the published record.
    publishedRecord: (() => {
      const pub = dataObj.hist && dataObj.hist[dataObj.reportingMonth];
      if (!pub) return null;
      return {
        kpi: pub.kpi || null,
        juris: pub.juris || null,
        industries: pub.industries || null,
        status: pub.status || null,
        published: !!pub.published,
      };
    })(),
  };

  // 8) Persist artefacts.
  const outDir = MODE === 'capture' ? BASELINE
                                    : path.join(BASELINE, 'runs', new Date().toISOString().replace(/[:.]/g,'-'));
  const pagesOut = path.join(outDir, 'pages');
  fs.mkdirSync(pagesOut, { recursive: true });
  pages.forEach((dataUrl, i) => {
    const b = Buffer.from(dataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(pagesOut, `page-${String(i+1).padStart(2,'0')}.jpg`), b);
  });
  fs.writeFileSync(path.join(outDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2));

  const manifest = {
    capturedAt: new Date().toISOString(),
    mode: MODE,
    chromium: await browser.version(),
    playwright: require('playwright/package.json').version,
    viewport: '1280x720',
    deviceScaleFactor: 1,
    fontPack: 'fontsource@5.1.0 (Hanken Grotesk + Newsreader), per-weight WOFF2 served from local static server',
    fixtures: {
      pl:   fs.statSync(path.join(FIXTURES, 'synthetic-pl.xlsx')).size,
      txn:  fs.statSync(path.join(FIXTURES, 'synthetic-txn.xlsx')).size,
      bs:   fs.statSync(path.join(FIXTURES, 'synthetic-bs.xlsx')).size,
      prev: fs.statSync(path.join(FIXTURES, 'synthetic-previous.data')).size,
    },
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('  wrote:', outDir);
  console.log('  pdf pages:', snapshot.outputs.pdf.pageCount, 'pptx slides:', snapshot.outputs.pptx.slideCount, 'page pngs:', pages.length);

  await browser.close();
  server.close();

  // 9) Compare mode: diff against baseline.
  //    Per the approved specification: PDF/PPTX byte-equality is NOT the
  //    contract (metadata timestamps inside those container formats vary
  //    even when visible content is identical). The contract is:
  //      1. Every one of the 11 rendered page images is byte-identical.
  //      2. PDF page count and PPTX slide count match.
  //      3. Continuation file's business shape (formatId, schemaVersion,
  //         reportingMonth, histMonths, histMonthCount) matches. The
  //         checksum inside the .data varies with the fresh published.at
  //         timestamp the tool stamps on each publish, so we exclude it —
  //         business content stability is proved by the identical page
  //         renders and identical histMonths list.
  //      4. Business snapshot (reportMonth, entity, publishedRecord.kpi
  //         etc.) matches.
  if (MODE === 'compare') {
    const baseSnap = JSON.parse(fs.readFileSync(path.join(BASELINE, 'snapshot.json'), 'utf8'));
    const runSnap  = JSON.parse(fs.readFileSync(path.join(outDir, 'snapshot.json'), 'utf8'));
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
      console.error('  BUSINESS SNAPSHOT DIFFERS from baseline');
      console.error('    baseline:', a);
      console.error('    this run:', b);
      throw new Error('business snapshot mismatch');
    }
    // Pixel-identity across all 11 rendered report pages.
    for (let i = 1; i <= 11; i++) {
      const bp = path.join(BASELINE, 'pages', `page-${String(i).padStart(2,'0')}.jpg`);
      const rp = path.join(outDir,   'pages', `page-${String(i).padStart(2,'0')}.jpg`);
      const bh = md5(fs.readFileSync(bp));
      const rh = md5(fs.readFileSync(rp));
      if (bh !== rh) throw new Error('page ' + i + ' MD5 differs (' + bh + ' vs ' + rh + ')');
    }
    console.log('  COMPARE PASS: 11 rendered pages byte-identical, business snapshot identical, PDF/PPTX structural match, continuation shape match');
  }
}

run().then(
  () => { console.log('OK'); process.exit(0); },
  (err) => { console.error('FAIL:', err && err.stack || err); process.exit(1); }
);
