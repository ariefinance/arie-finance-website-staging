#!/usr/bin/env node
/*
 * Build synthetic .xlsx / .data fixtures for the Management Report regression
 * suite. Values are entirely fabricated. Do not adjust these to match any
 * real ARIE month.
 *
 * The valid September pack is:
 *   - synthetic-pl.xlsx      Xero-shaped P&L, months newest-first (Sep..Jan)
 *   - synthetic-txn.xlsx     Transaction Summary, per-month blocks Jan..Sep
 *   - synthetic-bs.xlsx      Balance Sheet, Aug + Sep columns
 *   - synthetic-previous.data  August 2026 continuation (adjacent, valid)
 *
 * Additional negative fixture for adjacency testing:
 *   - synthetic-previous-jul-invalid.data  July 2026 (non-adjacent to Sept)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require(path.resolve(__dirname, '..', '..', 'vendor', 'xlsx.full.min.js'));

// -----------------------------------------------------------------------------
// Synthetic constants — all values fabricated.
// -----------------------------------------------------------------------------
const ENTITY = 'Acme Holdings Ltd';
const YEAR = 2026;
const REPORT_MONTH_IDX = 8; // September (0-based)
const MONTHS_YTD = 9;
const MONTHS_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Newest-first month order (Sep..Jan) — matches real Xero export shape and
// satisfies the tool's readiness() month-column-order check.
const MONTH_IDX_DESC = Array.from({length: MONTHS_YTD}, (_, i) => REPORT_MONTH_IDX - i);
const MONTH_KEYS_DESC   = MONTH_IDX_DESC.map(i => `${YEAR}-${String(i+1).padStart(2,'0')}`);
const MONTH_LABELS_DESC = MONTH_IDX_DESC.map(i => `${MONTHS_ABBR[i]} ${YEAR}`);

// Ascending helpers (still needed for Transaction Summary block layout).
const MONTH_IDX_ASC     = Array.from({length: MONTHS_YTD}, (_, i) => i);
const MONTH_KEYS_ASC    = MONTH_IDX_ASC.map(i => `${YEAR}-${String(i+1).padStart(2,'0')}`);
const MONTH_LABELS_ASC  = MONTH_IDX_ASC.map(i => `${MONTHS_ABBR[i]} ${YEAR}`);

// Client counts — one per month, in the SAME newest-first order as the P&L columns.
const CLIENTS_PER_MONTH_DESC = [3, 3, 3, 3, 3, 3, 3, 3, 3];

// Line values are defined ascending (Jan..Sep) — natural to read — then
// reversed when emitted so column order matches the P&L header.
const PL_SECTIONS = [
  { section: 'Trading Income', lines: [
      { name: 'Account Opening Fees',    monthly: [1000, 1000, 1000, 1000, 1500, 1500, 2000, 2000, 2500] },
      { name: 'Subscription Fees',       monthly: [ 500,  500,  500,  500,  600,  600,  700,  700,  800] },
      { name: 'Transaction Fees',        monthly: [ 400,  450,  500,  550,  600,  650,  700,  750,  800] },
  ] },
  { section: 'Operating Expenses', lines: [
      { name: 'Payroll',                 monthly: [1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200] },
      { name: 'Software & Cloud',        monthly: [ 200,  200,  200,  200,  200,  200,  200,  200,  200] },
      { name: 'Professional Fees',       monthly: [ 100,  100,  100,  100,  100,  100,  100,  100,  100] },
  ] },
];

const YTD  = (arr) => arr.reduce((s, x) => s + x, 0);
const REV  = (arr) => arr.slice().reverse();

// -----------------------------------------------------------------------------
// P&L workbook — Xero-shaped, months newest-first.
// -----------------------------------------------------------------------------
function buildPLRows() {
  const rows = [];
  rows.push([ENTITY]);
  rows.push([`Profit and Loss`]);
  rows.push([`For the ${MONTHS_YTD} months ended ${MONTHS_LONG[REPORT_MONTH_IDX]} ${YEAR}`]);
  rows.push([]);
  // Client counts row (parser scans up to 4 rows above the Account header).
  rows.push(['Clients', ...CLIENTS_PER_MONTH_DESC, '']);
  // Header row: Account, then months newest-first, then YTD.
  rows.push(['Account', ...MONTH_LABELS_DESC, 'YTD']);
  for (const sec of PL_SECTIONS) {
    rows.push([sec.section]);
    for (const line of sec.lines) {
      const asc  = line.monthly;
      const desc = REV(asc);
      rows.push([line.name, ...desc, YTD(asc)]);
    }
    const asc = new Array(MONTHS_YTD).fill(0);
    for (const line of sec.lines) for (let i = 0; i < MONTHS_YTD; i++) asc[i] += line.monthly[i];
    rows.push([`Total ${sec.section}`, ...REV(asc), YTD(asc)]);
  }
  const inc = PL_SECTIONS[0].lines.reduce((acc, l) => acc.map((v,i)=> v + l.monthly[i]), new Array(MONTHS_YTD).fill(0));
  const ope = PL_SECTIONS[1].lines.reduce((acc, l) => acc.map((v,i)=> v + l.monthly[i]), new Array(MONTHS_YTD).fill(0));
  const ebitdaAsc = inc.map((v,i)=> v - ope[i]);
  rows.push(['EBITDA', ...REV(ebitdaAsc), YTD(ebitdaAsc)]);
  return rows;
}

// -----------------------------------------------------------------------------
// Transaction Summary workbook.
//
// Per-month block (Jan..Sep, left-to-right — the tool scans all worksheets):
//   [ month-label ]                             1-2 rows above the "Row Labels" cell
//   [ 'Row Labels', 'Amount (USD)', 'Count' ]
//   [ 'In',        <usd>,           <cnt>   ]
//   [ 'Out',       <usd>,           <cnt>   ]
//   [ 'Grand Total', ...                    ]
// -----------------------------------------------------------------------------
const TXN_PER_MONTH = MONTH_KEYS_ASC.map((_, i) => ({
  inUsd:  100000 + i * 5000,
  outUsd:  90000 + i * 4500,
  inCount: 10 + i,
  outCount: 9 + i,
}));

function buildTxnRows() {
  const rows = [];
  const BLOCK_ROWS = 5, BLOCK_COLS = 3, GAP = 1;
  const grid = Array.from({length: BLOCK_ROWS}, () => []);
  TXN_PER_MONTH.forEach((v, i) => {
    const base = i * (BLOCK_COLS + GAP);
    grid[0][base]   = MONTH_LABELS_ASC[i];
    grid[1][base]   = 'Row Labels';
    grid[1][base+1] = 'Amount (USD)';
    grid[1][base+2] = 'Count';
    grid[2][base]   = 'In';   grid[2][base+1] = v.inUsd;  grid[2][base+2] = v.inCount;
    grid[3][base]   = 'Out';  grid[3][base+1] = v.outUsd; grid[3][base+2] = v.outCount;
    grid[4][base]   = 'Grand Total';
    grid[4][base+1] = v.inUsd + v.outUsd;
    grid[4][base+2] = v.inCount + v.outCount;
  });
  const width = TXN_PER_MONTH.length * (BLOCK_COLS + GAP);
  grid.forEach(r => { while (r.length < width) r.push(null); });
  rows.push(...grid);
  rows.push(new Array(width).fill(null));
  const ytdIn  = TXN_PER_MONTH.reduce((s,m)=> s + m.inUsd, 0);
  const ytdOut = TXN_PER_MONTH.reduce((s,m)=> s + m.outUsd, 0);
  const ytdInC = TXN_PER_MONTH.reduce((s,m)=> s + m.inCount, 0);
  const ytdOutC= TXN_PER_MONTH.reduce((s,m)=> s + m.outCount, 0);
  const ytdBlock = [
    [`YTD ${MONTHS_LONG[REPORT_MONTH_IDX]} ${YEAR}`],
    ['Type', 'Amount (USD)', 'Count'],
    ['In',  ytdIn,  ytdInC],
    ['Out', ytdOut, ytdOutC],
  ];
  for (const r of ytdBlock) rows.push([...r, ...new Array(Math.max(0, width - r.length)).fill(null)]);
  return rows;
}

// -----------------------------------------------------------------------------
// Balance Sheet workbook.
// -----------------------------------------------------------------------------
function buildBSRows() {
  const rows = [];
  rows.push([ENTITY]);
  rows.push(['Balance Sheet']);
  rows.push([`As at ${MONTHS_LONG[REPORT_MONTH_IDX]} ${YEAR}`]);
  rows.push([]);
  rows.push(['Account', MONTH_LABELS_DESC[1], MONTH_LABELS_DESC[0]]);   // Aug, Sep
  rows.push(['Assets', null, null]);
  rows.push(['Bank Balances', 50000, 55000]);
  rows.push(['Receivables',  10000, 12000]);
  rows.push(['Total Assets', 60000, 67000]);
  rows.push(['Liabilities', null, null]);
  rows.push(['Payables',     8000,  9000]);
  rows.push(['Total Liabilities', 8000, 9000]);
  rows.push(['Equity', null, null]);
  rows.push(['Retained Earnings', 52000, 58000]);
  rows.push(['Total Equity',      52000, 58000]);
  return rows;
}

// -----------------------------------------------------------------------------
// Continuation `.data` (Previous Month File).
//
// MUST match the production tool's continuation format exactly (see the
// `buildContinuation`, `contChecksum`, `stableStringify` and
// `validateContinuation` functions in managementreport/index.html).
// -----------------------------------------------------------------------------
const CONT_FORMAT = 'arie-management-report-continuation';
const CONT_SCHEMA = 1;
const BUILD_TAG   = '2026-09-stateless-1';

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
function contChecksum(core) {
  const s = stableStringify(core);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return ('0000000' + h.toString(16)).slice(-8);
}

// Build a hist[] with the 6 months preceding the reportingMonth, each carrying
// a synthetic published record with the txn + metrics values the tool's
// history checks require. The `published` shape is what `metricFor()` reads.
function synthHist(reportingMonthKey) {
  const [ry, rm] = reportingMonthKey.split('-').map(Number);
  const hist = {};
  for (let back = 5; back >= 0; back--) {
    const idx = rm - 1 - back;
    // Handle year underflow (not needed for our fixture but keep safe).
    const y = idx < 0 ? ry - 1 : ry;
    const m = ((idx % 12) + 12) % 12;
    const key = `${y}-${String(m+1).padStart(2,'0')}`;
    // Synthetic per-month metrics: constants that make the 6-month history
    // completeness check pass. Values are fabricated.
    const metrics = {
      inUsd:      100000 + back * 5000,
      outUsd:      90000 + back * 4500,
      inCount:    10 + back,
      outCount:    9 + back,
      volMonth:   (100000 + back * 5000 + 90000 + back * 4500) / 1e6,
      volYtd:      2.0 + back * 0.1,
      volSinceInc: 5.0 + back * 0.1,
      gpMargin:    0.6,
      revPerClient: 0.5,
      gpPerClient:  0.3,
      volPerClient: 0.5,
      txnPerClient: 5,
    };
    hist[key] = {
      key, status: 'published', published: { at: `${y}-${String(m+1).padStart(2,'0')}-15T09:00:00Z`, metrics },
      kpi: { clients: 3, accountsActive: 5, accountsHeld: 5, jurisdictions: 3, intlPct: 66,
             volMonth: metrics.volMonth, volYtd: metrics.volYtd, volSinceInc: metrics.volSinceInc },
      adj: {}, txn: { inUsd: metrics.inUsd, outUsd: metrics.outUsd, inCount: metrics.inCount, outCount: metrics.outCount },
      text: { pipeline: '', regulatory: '', tech: '', ebitdaNote: '', metricsNote: '' },
      review: { pipeline: true, regulatory: true, tech: true, ebitdaNote: true, metricsNote: true },
      confirm: {}, noUpdate: { pipeline: true, regulatory: true, tech: true, ebitdaNote: true, metricsNote: true },
      juris: [{ name: 'Mauritius', count: 1 }, { name: 'United Kingdom', count: 1 }, { name: 'United Arab Emirates', count: 1 }],
      industries: [{ name: 'Financial Services', count: 2 }, { name: 'Technology', count: 1 }],
    };
  }
  return hist;
}

function buildContinuation(reportingMonthKey) {
  const hist = synthHist(reportingMonthKey);
  const cfg  = {
    map: {}, directCosts: [], yearVolumes: [],
    includeFinPos: false,
    company: 'ARIE FINANCE (regression fixture)',
    entity: ENTITY,
    domestic: 'Mauritius',
    knownAccounts: null,
  };
  const core = { hist, cfg };
  const checksum = contChecksum(core);
  return {
    formatId: CONT_FORMAT,
    schemaVersion: CONT_SCHEMA,
    reportingMonth: reportingMonthKey,
    generatedAt: '2026-09-01T00:00:00.000Z',   // fixed for determinism
    builderVersion: BUILD_TAG,
    hist, cfg, checksum,
  };
}

// -----------------------------------------------------------------------------
// Emit
// -----------------------------------------------------------------------------
function writeXlsx(rows, filename) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(path.join(__dirname, filename), buf);
  console.log('wrote', filename, buf.length, 'bytes');
}
function writeJson(obj, filename) {
  fs.writeFileSync(path.join(__dirname, filename), JSON.stringify(obj, null, 1));
  console.log('wrote', filename);
}

writeXlsx(buildPLRows(),  'synthetic-pl.xlsx');
writeXlsx(buildTxnRows(), 'synthetic-txn.xlsx');
writeXlsx(buildBSRows(),  'synthetic-bs.xlsx');

// Valid: August (adjacent to September report).
writeJson(buildContinuation('2026-08'), 'synthetic-previous.data');

// Negative fixture: July (non-adjacent to September). Kept for future adjacency tests.
writeJson(buildContinuation('2026-07'), 'synthetic-previous-jul-nonadjacent.data');

// Export a machine-readable expected snapshot fragment for the parser check.
const expected = {
  entity: ENTITY,
  reportMonthKey: MONTH_KEYS_DESC[0],       // '2026-09' — first parsed = newest
  plMonthKeys: MONTH_KEYS_DESC,             // Sep..Jan
  clientsPerMonth: CLIENTS_PER_MONTH_DESC,  // per-column, matching P&L header order
  txnMonthKeys: MONTH_KEYS_ASC,             // parser stores by month key regardless of block order
  txnPerMonth: Object.fromEntries(MONTH_KEYS_ASC.map((k, i) => [k, TXN_PER_MONTH[i]])),
  ytd: {
    key: MONTH_KEYS_ASC[MONTH_KEYS_ASC.length - 1],
    usd: TXN_PER_MONTH.reduce((s,m)=> s + m.inUsd + m.outUsd, 0),
    count: TXN_PER_MONTH.reduce((s,m)=> s + m.inCount + m.outCount, 0),
  },
  previousMonthKey: '2026-08',
};
writeJson(expected, 'expected.json');
