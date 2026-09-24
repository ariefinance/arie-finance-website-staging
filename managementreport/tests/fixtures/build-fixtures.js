#!/usr/bin/env node
/*
 * Build synthetic .xlsx / .data fixtures for the Management Report regression suite.
 *
 * Values are entirely fabricated. Do not adjust these to match any real ARIE month.
 *
 * Reads the vendored SheetJS (../vendor/xlsx.full.min.js) so we use exactly the
 * same parser build the production tool loads — no drift between production and
 * fixture generation.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Load the vendored SheetJS build via UMD (works in Node via require()).
const XLSX = require(path.resolve(__dirname, '..', '..', 'vendor', 'xlsx.full.min.js'));

if (!XLSX || !XLSX.utils) {
  console.error('Failed to load vendored SheetJS.');
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Synthetic constants — all values fabricated.
// -----------------------------------------------------------------------------
const ENTITY = 'Acme Holdings Ltd';
const YEAR = 2026;
const REPORT_MONTH_IDX = 8; // September (0-based)
const MONTHS_YTD = 9;
const MONTHS_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const MONTH_KEYS_YTD = Array.from({length: MONTHS_YTD}, (_, i) => `${YEAR}-${String(i+1).padStart(2,'0')}`);
const MONTH_LABELS_YTD = Array.from({length: MONTHS_YTD}, (_, i) => `${MONTHS_ABBR[i]} ${YEAR}`);

// Client counts (small positive numbers, plausible operator input) — synthetic.
const CLIENTS_PER_MONTH = [3, 3, 3, 3, 3, 3, 3, 3, 3];

// Simple synthetic P&L structure — SECTION heading followed by lines.
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

const YTD = (arr) => arr.reduce((s, x) => s + x, 0);

// -----------------------------------------------------------------------------
// Synthetic P&L workbook.
// -----------------------------------------------------------------------------
function buildPLRows() {
  const rows = [];
  // Preamble
  rows.push([ENTITY]);
  rows.push([`Profit and Loss`]);
  rows.push([`For the ${MONTHS_YTD} months ended ${MONTHS_LONG[REPORT_MONTH_IDX]} ${YEAR}`]);
  rows.push([]);
  // Client-count row (three rows above Account) — parser scans up to 4 rows above the header.
  const clientRow = ['Clients'];
  for (let i = 0; i < MONTHS_YTD; i++) clientRow.push(CLIENTS_PER_MONTH[i]);
  clientRow.push(''); // YTD column blank (client counts do not roll)
  rows.push(clientRow);
  // Header row: "Account", then months, then YTD
  const header = ['Account'];
  for (const label of MONTH_LABELS_YTD) header.push(label);
  header.push('YTD');
  rows.push(header);
  // Sections + lines
  for (const sec of PL_SECTIONS) {
    // Section heading: name in col 0, no numeric values in month cols
    rows.push([sec.section]);
    for (const line of sec.lines) {
      const r = [line.name, ...line.monthly, YTD(line.monthly)];
      rows.push(r);
    }
    // A section total (helps EBITDA-family lines be recognisable to the tool)
    const totals = new Array(MONTHS_YTD).fill(0);
    for (const line of sec.lines) for (let i = 0; i < MONTHS_YTD; i++) totals[i] += line.monthly[i];
    rows.push([`Total ${sec.section}`, ...totals, YTD(totals)]);
  }
  // Synthetic EBITDA line
  const inc = PL_SECTIONS[0].lines.reduce((acc, l) => acc.map((v,i)=> v + l.monthly[i]), new Array(MONTHS_YTD).fill(0));
  const ope = PL_SECTIONS[1].lines.reduce((acc, l) => acc.map((v,i)=> v + l.monthly[i]), new Array(MONTHS_YTD).fill(0));
  const ebitda = inc.map((v,i)=> v - ope[i]);
  rows.push(['EBITDA', ...ebitda, YTD(ebitda)]);
  return rows;
}

// -----------------------------------------------------------------------------
// Synthetic Transaction Summary workbook.
//
// Expected structure per month block (per the parser):
//   [ month-label ]                            <-- 1-2 rows above the "Row Labels" cell
//   [ 'Row Labels', 'Amount (USD)', 'Count' ]
//   [ 'In',        <usd>,           <cnt>   ]
//   [ 'Out',       <usd>,           <cnt>   ]
//   [ 'Grand Total', ...                    ]
//
// One block per month; blocks arranged left-to-right on one sheet.
// -----------------------------------------------------------------------------
function buildTxnRows() {
  const rows = [];
  const perMonth = MONTH_KEYS_YTD.map((_, i) => ({
    inUsd:  100000 + i * 5000,
    outUsd:  90000 + i * 4500,
    inCount: 10 + i,
    outCount: 9 + i,
  }));

  // 5 rows per block, 4 columns wide (with 1 col gap between blocks).
  const BLOCK_ROWS = 5;
  const BLOCK_COLS = 3;
  const GAP = 1;
  const grid = Array.from({length: BLOCK_ROWS}, () => []);

  perMonth.forEach((v, i) => {
    const base = i * (BLOCK_COLS + GAP);
    // Row 0: month label at col base
    grid[0][base] = MONTH_LABELS_YTD[i];
    // Row 1: header row
    grid[1][base]   = 'Row Labels';
    grid[1][base+1] = 'Amount (USD)';
    grid[1][base+2] = 'Count';
    // Row 2: In
    grid[2][base]   = 'In';
    grid[2][base+1] = v.inUsd;
    grid[2][base+2] = v.inCount;
    // Row 3: Out
    grid[3][base]   = 'Out';
    grid[3][base+1] = v.outUsd;
    grid[3][base+2] = v.outCount;
    // Row 4: Grand Total (parser stops there)
    grid[4][base]   = 'Grand Total';
    grid[4][base+1] = v.inUsd + v.outUsd;
    grid[4][base+2] = v.inCount + v.outCount;
  });

  // Ensure every row has same length
  const width = perMonth.length * (BLOCK_COLS + GAP);
  grid.forEach(r => { while (r.length < width) r.push(null); });

  // Then push YTD block underneath (parser format):
  //   [ 'YTD September 2026' ]
  //   [ 'Type', 'Amount (USD)', 'Count' ]
  //   [ 'In',   <ytdUsd>,        <ytdCnt> ]
  //   [ 'Out',  <ytdUsd>,        <ytdCnt> ]
  const ytdIn  = perMonth.reduce((s,m)=> s + m.inUsd, 0);
  const ytdOut = perMonth.reduce((s,m)=> s + m.outUsd, 0);
  const ytdInC = perMonth.reduce((s,m)=> s + m.inCount, 0);
  const ytdOutC= perMonth.reduce((s,m)=> s + m.outCount, 0);
  rows.push(...grid);
  rows.push(new Array(width).fill(null));
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
// Synthetic Balance Sheet workbook.
// -----------------------------------------------------------------------------
function buildBSRows() {
  const rows = [];
  rows.push([ENTITY]);
  rows.push(['Balance Sheet']);
  rows.push([`As at ${MONTHS_LONG[REPORT_MONTH_IDX]} ${YEAR}`]);
  rows.push([]);
  rows.push(['Account', MONTH_LABELS_YTD[MONTHS_YTD-2], MONTH_LABELS_YTD[MONTHS_YTD-1]]);
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
// Synthetic Previous Month File (`.data`).
// Represents a July 2026 finalise, so a September report is +2 months (adjacency
// check for August-adjacent Previous Month File will be a separate synthetic).
// -----------------------------------------------------------------------------
function buildPreviousData(monthKey) {
  const rec = { adj:{}, kpi:{}, txn:{}, text:{}, review:{}, confirm:{}, noUpdate:{}, juris:[], industries:[], status:'published', published:true };
  const hist = { [monthKey]: rec };
  const cfg  = { entity: ENTITY, currency: 'USD', reportMonth: monthKey };
  const payload = { v: 1, savedAt: new Date().toISOString(), rec, hist, cfg };
  // djb2 checksum (matches the tool's algorithm — see production `.data` handling).
  const json = JSON.stringify(payload);
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return { payload, checksum: String(h >>> 0), json };
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

writeXlsx(buildPLRows(),   'synthetic-pl.xlsx');
writeXlsx(buildTxnRows(),  'synthetic-txn.xlsx');
writeXlsx(buildBSRows(),   'synthetic-bs.xlsx');

const prev = buildPreviousData('2026-07');
fs.writeFileSync(path.join(__dirname, 'synthetic-previous.data'),
  JSON.stringify({ ...prev.payload, __checksum: prev.checksum }, null, 2));
console.log('wrote synthetic-previous.data');
