#!/usr/bin/env node
/*
 * parser-check.js — runs the production Management Report parsers against the
 * synthetic fixture pack and asserts the outputs match expected values.
 *
 * Verifies:
 *   1. detectKind() classifies the synthetic P&L as 'pl' and BS as 'bs'.
 *   2. parsePL() returns the expected months, entity, period and line data,
 *      with columns newest-first and the report month = September 2026.
 *   3. parseBS() returns the expected dates and lines.
 *   4. parseTxnSummary() returns the expected per-month in/out USD and counts.
 *   5. Continuation `.data` file passes validateContinuation() semantics —
 *      valid formatId, schemaVersion, hist/cfg present, valid reportingMonth,
 *      and its djb2 checksum matches contChecksum({hist, cfg}).
 *
 * Fails non-zero on any mismatch, prints the specific field that failed.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const P = require('./parsers.js');
const XLSX = require(path.resolve(__dirname, '..', '..', 'vendor', 'xlsx.full.min.js'));

const F = path.resolve(__dirname, '..', 'fixtures');
const EXPECTED = JSON.parse(fs.readFileSync(path.join(F, 'expected.json'), 'utf8'));

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error('  FAIL:', msg, '\n    expected', e, '\n    got     ', a); }
}
function readWorkbook(name) {
  const buf = fs.readFileSync(path.join(F, name));
  return XLSX.read(buf, { type: 'buffer' });
}

// Mirror of production's stableStringify + contChecksum (see managementreport/index.html).
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

// ---- P&L ----------------------------------------------------------------
console.log('P&L');
{
  const wb = readWorkbook('synthetic-pl.xlsx');
  const rows = P.sheetRows(wb);
  assertEq(P.detectKind(rows), 'pl', 'detectKind(pl) === "pl"');
  const pl = P.parsePL(rows);
  assertEq(pl.entity, EXPECTED.entity, 'pl.entity');
  assertEq(pl.months.map(m => m.key), EXPECTED.plMonthKeys, 'pl.months keys (newest first)');
  assertEq(pl.key, EXPECTED.reportMonthKey, 'pl.key (first parsed month = report month)');
  assertEq(pl.period && pl.period.n, 9, 'pl.period.n');
  assertEq(pl.period && pl.period.key, EXPECTED.reportMonthKey, 'pl.period.key');
  assertEq(pl.clients, EXPECTED.clientsPerMonth, 'pl.clients per month (matches column order)');
  // Opening: monthly line values were defined Jan..Sep; column order is Sep..Jan → reversed.
  const opening = pl.lines.find(l => l.name === 'Account Opening Fees');
  assert(!!opening, 'pl line "Account Opening Fees" present');
  if (opening) {
    assertEq(opening.section, 'Trading Income', 'opening.section');
    assertEq(opening.vals, [2500,2000,2000,1500,1500,1000,1000,1000,1000], 'opening.vals (Sep..Jan)');
    assertEq(opening.ytd, 13500, 'opening.ytd (sum)');
  }
  const ebitda = pl.lines.find(l => l.name === 'EBITDA');
  assert(!!ebitda, 'pl line "EBITDA" present');
  if (ebitda) {
    const incAsc  = [1900,1950,2000,2050,2700,2750,3400,3450,4100];
    const opexAsc = [1500,1500,1500,1500,1500,1500,1500,1500,1500];
    const ebitdaAsc = incAsc.map((v,i) => v - opexAsc[i]);
    assertEq(ebitda.vals, ebitdaAsc.slice().reverse(), 'ebitda.vals (Sep..Jan)');
    assertEq(ebitda.isTotal, true, 'ebitda.isTotal');
  }
  // Month columns must be newest-first — the exact check readiness() runs.
  const desc = pl.months.every((m, i) => i === 0 || m.key < pl.months[i-1].key);
  assert(desc, 'pl.months descending (readiness() month-order check would pass)');
}

// ---- Balance Sheet ------------------------------------------------------
console.log('BS');
{
  const wb = readWorkbook('synthetic-bs.xlsx');
  const rows = P.sheetRows(wb);
  assertEq(P.detectKind(rows), 'bs', 'detectKind(bs) === "bs"');
  const bs = P.parseBS(rows);
  assertEq(bs.dates.map(d => d.key), ['2026-08', '2026-09'], 'bs.dates keys');
  const bank = bs.lines.find(l => l.name === 'Bank Balances');
  assert(!!bank, 'bs line "Bank Balances" present');
  if (bank) assertEq(bank.vals, [50000, 55000], 'bank.vals');
}

// ---- Transaction Summary -----------------------------------------------
console.log('Txn');
{
  const wb = readWorkbook('synthetic-txn.xlsx');
  const txn = P.parseTxnSummary(wb);
  assert(!!txn, 'parseTxnSummary returned non-null');
  if (txn) {
    assertEq(Object.keys(txn.months).sort(), EXPECTED.txnMonthKeys.slice().sort(), 'txn.months keys');
    for (const k of EXPECTED.txnMonthKeys) {
      assertEq(txn.months[k], EXPECTED.txnPerMonth[k], 'txn month ' + k);
    }
    assert(!!txn.ytd, 'txn.ytd non-null');
    if (txn.ytd) {
      assertEq(txn.ytd.key, EXPECTED.ytd.key, 'txn.ytd.key');
      assertEq(txn.ytd.usd, EXPECTED.ytd.usd, 'txn.ytd.usd');
      assertEq(txn.ytd.count, EXPECTED.ytd.count, 'txn.ytd.count');
    }
  }
}

// ---- Continuation file (valid) ------------------------------------------
console.log('Previous Month File (August, valid)');
{
  const raw = fs.readFileSync(path.join(F, 'synthetic-previous.data'), 'utf8');
  const j = JSON.parse(raw);
  assertEq(j.formatId, 'arie-management-report-continuation', 'previous.formatId');
  assertEq(j.schemaVersion, 1, 'previous.schemaVersion');
  assertEq(j.reportingMonth, EXPECTED.previousMonthKey, 'previous.reportingMonth (August)');
  assert(!!j.hist && !!j.cfg, 'previous.hist and .cfg present');
  assertEq(j.checksum, contChecksum({ hist: j.hist, cfg: j.cfg }), 'previous.checksum matches contChecksum({hist,cfg})');
  // History must contain the reporting month and enough prior months for the
  // last-6 unit-economics history check to have material for the September run.
  const histKeys = Object.keys(j.hist).sort();
  assert(histKeys.includes('2026-08'), 'previous.hist contains 2026-08');
  assert(histKeys.filter(k => k <= '2026-08').length >= 6, 'previous.hist has at least 6 published months up to Aug');
  // Every hist entry must carry a `published.metrics` block with the five UE fields.
  const UE = ['gpMargin','revPerClient','gpPerClient','volPerClient','txnPerClient'];
  for (const k of histKeys) {
    const m = j.hist[k] && j.hist[k].published && j.hist[k].published.metrics;
    assert(!!m, 'previous.hist[' + k + '].published.metrics present');
    if (m) for (const f of UE) assert(typeof m[f] === 'number', 'previous.hist[' + k + '].published.metrics.' + f + ' is numeric');
  }
}

// ---- Continuation file (negative fixture, July non-adjacent) ------------
console.log('Previous Month File (July, non-adjacent negative fixture)');
{
  const raw = fs.readFileSync(path.join(F, 'synthetic-previous-jul-nonadjacent.data'), 'utf8');
  const j = JSON.parse(raw);
  assertEq(j.reportingMonth, '2026-07', 'jul-negative.reportingMonth');
  // The file itself must be internally valid — the "non-adjacent" quality is a
  // higher-level Phase A rule; this fixture exists so future adjacency-rule
  // tests have a well-formed but non-adjacent Previous Month File to reject.
  assertEq(j.checksum, contChecksum({ hist: j.hist, cfg: j.cfg }), 'jul-negative.checksum valid');
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll parser checks passed.');
