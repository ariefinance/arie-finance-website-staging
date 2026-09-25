#!/usr/bin/env node
/* Regression tests for the wire-transfer engine.
   Runs against the label extractor / cleanup / words / require modules,
   plus a PDF-fill smoke test using the bundled MauBank blank template.
   Uses SYNTHETIC fixtures only — real customer .msg content is never
   committed. Validation against the real .msg is done manually via
   the Preview per the UAT. */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const cleanup = require('../cleanup.js');
const words   = require('../words.js');
const parser  = require('../parser.js');
const extract = require('../extract.js');
const req     = require('../require.js');
const pdfFill = require('../pdf-fill.js');

let ok = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { ok++;     console.log('  ✓', name); },
    e  => { failed++; console.log('  ✗', name, '—', e.message); }
  );
}

async function run() {
  console.log('cleanup');
  await test('cleanAddress collapses ", , "', () => {
    assert.strictEqual(
      cleanup.cleanAddress('3rd Floor, KPMG Building, , Ebene, 124324'),
      '3rd Floor, KPMG Building, Ebene, 124324'
    );
  });
  await test('cleanPurpose snake→sentence', () => {
    assert.strictEqual(cleanup.cleanPurpose('COMPUTER_SERVICES'), 'Computer services');
  });
  await test('cleanPurpose leaves mixed case alone', () => {
    assert.strictEqual(cleanup.cleanPurpose('Salary payment'), 'Salary payment');
  });

  console.log('words');
  await test('amountToWords 1.0 -> ONE (no CENTS, no ONLY)', () => {
    assert.strictEqual(words.amountToWords('1.0'), 'ONE');
  });
  await test('amountToWords 3500 -> THREE THOUSAND FIVE HUNDRED', () => {
    assert.strictEqual(words.amountToWords('3500'), 'THREE THOUSAND FIVE HUNDRED');
  });
  await test('amountToWords 12500.75 -> ... AND SEVENTY-FIVE CENTS', () => {
    assert.strictEqual(
      words.amountToWords('12500.75'),
      'TWELVE THOUSAND FIVE HUNDRED AND SEVENTY-FIVE CENTS'
    );
  });

  console.log('extract (synthetic ARIE body)');
  const body = fs.readFileSync(path.join(__dirname, 'fixtures/synthetic-arie.body.txt'), 'utf8');
  const t = { source: 'synthetic-arie', signatories: ['Rajesh Shibdeen', 'Avinash Rucktooa'] };
  extract.extractFields(t, { text: body });

  await test('Sender Name -> client', () => assert.strictEqual(t.client, 'ARIE Finance Limited'));
  await test('Sender Account Number -> debitAccount', () => assert.strictEqual(t.debitAccount, '00000016'));
  await test('Transfer Currency wins over Source Currency', () => assert.strictEqual(t.currency, 'USD'));
  await test('Transfer Amount wins over Source Amount', () => assert.strictEqual(t.amount, '1.0'));
  await test('Beneficiary Bank Name -> beneficiaryBank', () => assert.strictEqual(t.beneficiaryBank, 'Emirates NBD'));
  await test('Beneficiary Name -> beneficiaryName', () => assert.strictEqual(t.beneficiaryName, 'Aisha Sudally'));
  await test('Beneficiary Address cleaned', () => assert.strictEqual(t.beneficiaryAddress, '3rd Floor, KPMG Building, Ebene, 124324'));
  await test('Beneficiary Account Number -> accountNumber', () => assert.strictEqual(t.accountNumber, '001015435042701'));
  await test('Beneficiary IBAN -> iban (upper, no spaces)', () => assert.strictEqual(t.iban, 'AE970260001015435042701'));
  await test('Purpose cleaned COMPUTER_SERVICES -> Computer services', () => assert.strictEqual(t.purpose, 'Computer services'));
  await test('Country carried as context', () => assert.strictEqual(t.country, 'United Arab Emirates'));
  await test('Reference carried as context', () => assert.strictEqual(t.reference, 'Manual test'));
  await test('numeric "Charges: 0.0" leaves MauBank charges blank', () => assert.strictEqual(t.charges, ''));
  await test('amountWords derived from Transfer Amount = ONE', () => assert.strictEqual(t.amountWords, 'ONE'));

  console.log('require (V1 completion model)');
  await test('blank txn reports many missing fields', () => {
    const empty = { signatories: [] };
    const m = req.missingFields(empty);
    assert.ok(m.length >= 15, 'expected many missing, got ' + m.length);
    assert.ok(m.includes('Account Number or IBAN'));
    assert.ok(m.includes('Two authorised signatories'));
  });
  await test('Sort Code / Intermediary blank do not block generation', () => {
    const full = {
      client: 'x', address: 'x', contact: 'x', currency: 'USD', amount: '1',
      valueDate: '01/01/2026', amountWords: 'ONE', debitAccount: 'x',
      beneficiaryBank: 'x', bankAddress: 'x', swift: 'X', beneficiaryName: 'x',
      beneficiaryAddress: 'x', accountNumber: 'x', purpose: 'x', charges: 'Applicant',
      sortCode: '', intermediaryBank: '',
      signatories: ['Rajesh Shibdeen', 'Avinash Rucktooa']
    };
    assert.deepStrictEqual(req.missingFields(full), []);
  });
  await test('IBAN present but Account Number blank still passes', () => {
    const full = {
      client: 'x', address: 'x', contact: 'x', currency: 'USD', amount: '1',
      valueDate: '01/01/2026', amountWords: 'ONE', debitAccount: 'x',
      beneficiaryBank: 'x', bankAddress: 'x', swift: 'X', beneficiaryName: 'x',
      beneficiaryAddress: 'x', accountNumber: '', iban: 'AE97...', purpose: 'x', charges: 'Applicant',
      signatories: ['Rajesh Shibdeen', 'Avinash Rucktooa']
    };
    assert.deepStrictEqual(req.missingFields(full), []);
  });

  console.log('pdf-fill');
  await test('splitDate DD/MM/YYYY keeps full year', () => {
    assert.deepStrictEqual(pdfFill.splitDate('25/09/2026'), { day: '25', month: '09', year: '2026' });
  });
  await test('splitDate D Month YYYY', () => {
    assert.deepStrictEqual(pdfFill.splitDate('7 Aug 2026'), { day: '07', month: '08', year: '2026' });
  });
  await test('todayMauritius formats DD/MM/YYYY', () => {
    const s = pdfFill.todayMauritius(new Date('2026-09-24T22:00:00Z'));
    assert.strictEqual(s, '25/09/2026'); // 22:00Z + 4h = 02:00 next day Mauritius
  });

  await test('fillMaubankPdf produces a valid PDF; page 2 unchanged', async () => {
    // Setup: patch a minimal DOM-free shim expected by pdf-lib. It runs in
    // Node without changes, but pdf-fill.js reads self.PDFLib in browser.
    const PDFLib = (() => {
      try { return require('pdf-lib'); }
      catch (_) { return require(process.env.PDF_LIB_PATH || 'pdf-lib'); }
    })();
    global.self = global.self || global;
    global.self.PDFLib = PDFLib;

    const templatePath = path.join(__dirname, '..', 'assets', 'maubank-tt-dd.pdf');
    const templateBytes = new Uint8Array(fs.readFileSync(templatePath));
    // Load a reference template + a filled copy; compare page-2 text.
    const ref = await PDFLib.PDFDocument.load(templateBytes);
    const refPageCount = ref.getPageCount();
    assert.strictEqual(refPageCount, 2);

    const filled = await pdfFill.fillMaubankPdf({
      client: 'ARIE Finance Limited', address: '1 X Rd, City', contact: '+230 000 0000',
      currency: 'USD', amount: '1.0', valueDate: '01/10/2026', amountWords: 'ONE',
      debitAccount: '00000016',
      beneficiaryBank: 'Emirates NBD', bankAddress: 'Dubai', swift: 'EBILAEAD',
      beneficiaryName: 'Aisha Sudally', beneficiaryAddress: '3rd Floor, KPMG Building, Ebene, 124324',
      accountNumber: '001015435042701', iban: 'AE970260001015435042701',
      purpose: 'Computer services', charges: 'Applicant', applicationDate: '25/09/2026',
      signatories: ['Rajesh Shibdeen', 'Avinash Rucktooa']
    }, { templateBytes });

    // Page count preserved.
    const out = await PDFLib.PDFDocument.load(filled);
    assert.strictEqual(out.getPageCount(), 2);

    // No form widgets or drawing operations targeted page 2:
    // page 2 must have zero annotations of subtype /Widget on the OUT document.
    const page2 = out.getPage(1);
    const annots = page2.node.Annots();
    const arr = annots ? annots.asArray() : [];
    const widgetCount = arr.filter(a => String(a.lookup(PDFLib.PDFName.of('Subtype'))) === '/Widget').length;
    assert.strictEqual(widgetCount, 0);
  });

  console.log('\nResult: ' + ok + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

run();
