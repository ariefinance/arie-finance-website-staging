#!/usr/bin/env node
/*
 * parser-check.js — runs the production Management Report parsers against the
 * synthetic fixture pack and asserts the outputs match expected values.
 *
 * This does NOT render the report. Rendering determinism/comparison is a
 * separate harness (render-baseline.js). This harness alone verifies:
 *
 *   1. detectKind() classifies the synthetic P&L as 'pl' and BS as 'bs'.
 *   2. parsePL() returns the expected months, entity, period and line data.
 *   3. parseBS() returns the expected dates and lines.
 *   4. parseTxnSummary() returns the expected per-month in/out USD and counts.
 *   5. Continuation `.data` file parses as valid JSON with the fields the
 *      tool's loader expects.
 *
 * Fails non-zero on any mismatch, prints the specific field that failed.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const P = require('./parsers.js');
const XLSX = require(path.resolve(__dirname, '..', '..', 'vendor', 'xlsx.full.min.js'));

const F = path.resolve(__dirname, '..', 'fixtures');

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

// ---- P&L ----------------------------------------------------------------
console.log('P&L');
{
  const wb = readWorkbook('synthetic-pl.xlsx');
  const rows = P.sheetRows(wb);
  assertEq(P.detectKind(rows), 'pl', 'detectKind(pl) === "pl"');
  const pl = P.parsePL(rows);
  assertEq(pl.entity, 'Acme Holdings Ltd', 'pl.entity');
  assertEq(pl.months.length, 9, 'pl.months.length');
  assertEq(pl.months.map(m => m.key), [
    '2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'
  ], 'pl.months keys');
  assertEq(pl.key, '2026-01', 'pl.key (first month)');
  assertEq(pl.period && pl.period.n, 9, 'pl.period.n');
  assertEq(pl.clients, [3,3,3,3,3,3,3,3,3], 'pl.clients per month');
  // Verify a few lines survived the parse
  const opening = pl.lines.find(l => l.name === 'Account Opening Fees');
  assert(!!opening, 'pl line "Account Opening Fees" present');
  if (opening) {
    assertEq(opening.section, 'Trading Income', 'opening.section');
    assertEq(opening.vals, [1000,1000,1000,1000,1500,1500,2000,2000,2500], 'opening.vals');
    assertEq(opening.ytd, 13500, 'opening.ytd (sum of monthly vals)');
  }
  const ebitda = pl.lines.find(l => l.name === 'EBITDA');
  assert(!!ebitda, 'pl line "EBITDA" present');
  if (ebitda) {
    // Trading income sum minus opex sum, per month.
    const inc = [1900,1950,2000,2050,2700,2750,3400,3450,4100];
    const opex = [1500,1500,1500,1500,1500,1500,1500,1500,1500];
    const expected = inc.map((v,i) => v - opex[i]);
    assertEq(ebitda.vals, expected, 'ebitda.vals');
    assertEq(ebitda.isTotal, true, 'ebitda.isTotal');
  }
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
    const expectedKeys = [
      '2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'
    ];
    assertEq(Object.keys(txn.months).sort(), expectedKeys, 'txn.months keys');
    // Sept synthetic values: inUsd=100000+8*5000=140000, outUsd=90000+8*4500=126000, inCount=18, outCount=17
    assertEq(txn.months['2026-09'], { inUsd: 140000, outUsd: 126000, inCount: 18, outCount: 17 }, 'txn Sep 2026');
    // YTD row: sum of inUsd all months, sum of outUsd, sum of counts.
    // Derived from the synthetic constants (100000+5000i, 90000+4500i, 10+i, 9+i for i=0..8).
    const inArr = Array.from({length: 9}, (_, i) => 100000 + 5000 * i);
    const outArr = Array.from({length: 9}, (_, i) => 90000 + 4500 * i);
    const inCntArr = Array.from({length: 9}, (_, i) => 10 + i);
    const outCntArr = Array.from({length: 9}, (_, i) => 9 + i);
    const inYtd = inArr.reduce((a,b)=>a+b, 0);
    const outYtd = outArr.reduce((a,b)=>a+b, 0);
    const inCntYtd = inCntArr.reduce((a,b)=>a+b, 0);
    const outCntYtd = outCntArr.reduce((a,b)=>a+b, 0);
    assert(!!txn.ytd, 'txn.ytd non-null');
    if (txn.ytd) {
      assertEq(txn.ytd.key, '2026-09', 'txn.ytd.key');
      assertEq(txn.ytd.usd, inYtd + outYtd, 'txn.ytd.usd (in + out)');
      assertEq(txn.ytd.count, inCntYtd + outCntYtd, 'txn.ytd.count');
    }
  }
}

// ---- Continuation file ---------------------------------------------------
console.log('Previous Month File');
{
  const raw = fs.readFileSync(path.join(F, 'synthetic-previous.data'), 'utf8');
  const j = JSON.parse(raw);
  assertEq(j.v, 1, 'previous.v');
  assert(!!j.hist && !!j.hist['2026-07'], 'previous.hist["2026-07"] present');
  assertEq(j.cfg.reportMonth, '2026-07', 'previous.cfg.reportMonth');
  assertEq(j.cfg.entity, 'Acme Holdings Ltd', 'previous.cfg.entity');
  assertEq(j.cfg.currency, 'USD', 'previous.cfg.currency');
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll parser checks passed.');
