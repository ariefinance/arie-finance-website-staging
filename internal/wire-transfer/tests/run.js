#!/usr/bin/env node
/* Regression tests for the wire-transfer engine + app-render policy.
   Uses SYNTHETIC fixtures only — real customer .msg content is never
   committed. Validation against the real .msg is done manually via
   the Preview per the UAT. */

'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const cleanup = require('../cleanup.js');
const words   = require('../words.js');
const parser  = require('../parser.js');
const extract = require('../extract.js');
const req     = require('../require.js');
const st      = require('../state.js');
const pdfFill = require('../pdf-fill.js');

let ok = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { ok++;     console.log('  ✓', name); },
    e  => { failed++; console.log('  ✗', name, '—', e.message); }
  );
}

/* Small factory: a fully-populated valid transaction. Tests copy this
   and blank individual fields to prove each required rule. */
function completeTxn(over) {
  return Object.assign({
    id: 't1', source: 'sample.msg',
    applicationDate: '25/09/2026',
    client: 'ARIE Finance Limited', address: '1 X Rd, City',
    address2: '', contact: '+230 000 0000', debitAccount: '00000016',
    currency: 'USD', amount: '1.0', valueDate: '01/10/2026',
    amountWords: 'ONE', purpose: 'Computer services', charges: 'Applicant',
    beneficiaryBank: 'Emirates NBD', bankAddress: 'Dubai', swift: 'EBILAEAD',
    beneficiaryName: 'Aisha Sudally',
    beneficiaryAddress: '3rd Floor, KPMG Building, Ebene, 124324',
    accountNumber: '001015435042701', iban: 'AE970260001015435042701',
    sortCode: '', intermediaryBank: '',
    signatories: ['Rajesh Shibdeen', 'Avinash Rucktooa']
  }, over || {});
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
  await test('blank txn reports many missing fields including Application Date', () => {
    const empty = { signatories: [] };
    const m = req.missingFields(empty);
    assert.ok(m.includes('Application Date'));
    assert.ok(m.includes('Account Number'));
    assert.ok(m.includes('IBAN'));
    assert.ok(m.includes('Two authorised signatories'));
  });
  await test('fully populated txn: no missing fields', () => {
    assert.deepStrictEqual(req.missingFields(completeTxn()), []);
  });
  await test('Application Date required (blank blocks)', () => {
    assert.deepStrictEqual(req.missingFields(completeTxn({ applicationDate: '' })), ['Application Date']);
  });
  await test('Account Number required (blank blocks even when IBAN present)', () => {
    assert.deepStrictEqual(req.missingFields(completeTxn({ accountNumber: '' })), ['Account Number']);
  });
  await test('IBAN required (blank blocks even when Account Number present)', () => {
    assert.deepStrictEqual(req.missingFields(completeTxn({ iban: '' })), ['IBAN']);
  });
  await test('Sort Code optional (blank does NOT block)', () => {
    assert.deepStrictEqual(req.missingFields(completeTxn({ sortCode: '' })), []);
  });
  await test('Intermediary Bank optional (blank does NOT block)', () => {
    assert.deepStrictEqual(req.missingFields(completeTxn({ intermediaryBank: '' })), []);
  });
  await test('Address line 2 optional (blank does NOT block)', () => {
    assert.deepStrictEqual(req.missingFields(completeTxn({ address2: '' })), []);
  });

  console.log('state (optional / batch / dedupe)');
  await test('isOptional flags conditional fields', () => {
    assert.strictEqual(st.isOptional('sortCode'), true);
    assert.strictEqual(st.isOptional('intermediaryBank'), true);
    assert.strictEqual(st.isOptional('address2'), true);
    assert.strictEqual(st.isOptional('accountNumber'), false);
    assert.strictEqual(st.isOptional('iban'), false);
  });
  await test('batchReadiness: two complete txns -> ready', () => {
    const r = st.batchReadiness([completeTxn({id:'a'}), completeTxn({id:'b'})], req);
    assert.strictEqual(r.ready, true);
    assert.strictEqual(r.incomplete.length, 0);
  });
  await test('batchReadiness: one incomplete -> not ready, offender named', () => {
    const r = st.batchReadiness([completeTxn({id:'a'}), completeTxn({id:'b', valueDate:''})], req);
    assert.strictEqual(r.ready, false);
    assert.strictEqual(r.incomplete.length, 1);
    assert.strictEqual(r.incomplete[0].id, 'b');
    assert.ok(r.incomplete[0].missing.includes('Value Date'));
  });
  await test('batchReadiness: empty list -> not ready', () => {
    const r = st.batchReadiness([], req);
    assert.strictEqual(r.ready, false);
  });
  await test('dedupeName: unique passes through', () => {
    const used = new Set();
    assert.strictEqual(st.dedupeName('a.pdf', used), 'a.pdf');
    assert.strictEqual(st.dedupeName('b.pdf', used), 'b.pdf');
  });
  await test('dedupeName: duplicates get _2, _3 (extension preserved)', () => {
    const used = new Set();
    assert.strictEqual(st.dedupeName('MauBank-TT_X_2026-09-25.pdf', used), 'MauBank-TT_X_2026-09-25.pdf');
    assert.strictEqual(st.dedupeName('MauBank-TT_X_2026-09-25.pdf', used), 'MauBank-TT_X_2026-09-25_2.pdf');
    assert.strictEqual(st.dedupeName('MauBank-TT_X_2026-09-25.pdf', used), 'MauBank-TT_X_2026-09-25_3.pdf');
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
    assert.strictEqual(s, '25/09/2026');
  });
  await test('PDF_MAP wires both remitter address widgets', () => {
    assert.strictEqual(pdfFill.PDF_MAP.address,  'undefined_2');
    assert.strictEqual(pdfFill.PDF_MAP.address2, 'Address');
  });

  const PDFLib = (() => {
    try { return require('pdf-lib'); }
    catch (_) { return require(process.env.PDF_LIB_PATH || 'pdf-lib'); }
  })();
  global.self = global.self || global;
  global.self.PDFLib = PDFLib;

  const templatePath = path.join(__dirname, '..', 'assets', 'maubank-tt-dd.pdf');
  const templateBytes = new Uint8Array(fs.readFileSync(templatePath));

  await test('fillMaubankPdf: page count == 2; page 2 has no widgets', async () => {
    const filled = await pdfFill.fillMaubankPdf(completeTxn({
      address:  '1 X Rd, City',
      address2: 'Ebene, 1234'
    }), { templateBytes });
    const out = await PDFLib.PDFDocument.load(filled);
    assert.strictEqual(out.getPageCount(), 2);
    const page2 = out.getPage(1);
    const annots = page2.node.Annots();
    const arr = annots ? annots.asArray() : [];
    const widgetCount = arr.filter(a => String(a.lookup(PDFLib.PDFName.of('Subtype'))) === '/Widget').length;
    assert.strictEqual(widgetCount, 0);
  });

  await test('fillMaubankPdf: BOTH remitter address widgets populated', async () => {
    const filled = await pdfFill.fillMaubankPdf(completeTxn({
      address:  '1 X Rd, City',
      address2: 'Ebene, 1234'
    }), { templateBytes });
    const out = await PDFLib.PDFDocument.load(filled);
    const form = out.getForm();
    assert.strictEqual(form.getTextField('undefined_2').getText(), '1 X Rd, City');
    assert.strictEqual(form.getTextField('Address').getText(),      'Ebene, 1234');
  });

  await test('fillMaubankPdf: line 2 blank leaves "Address" widget empty', async () => {
    const filled = await pdfFill.fillMaubankPdf(completeTxn({
      address: '1 X Rd, City', address2: ''
    }), { templateBytes });
    const out = await PDFLib.PDFDocument.load(filled);
    const form = out.getForm();
    assert.strictEqual(form.getTextField('undefined_2').getText(), '1 X Rd, City');
    const v = form.getTextField('Address').getText();
    assert.ok(v == null || v === '', 'expected empty Address widget, got ' + JSON.stringify(v));
  });

  console.log('app (input-focus regression + generation blocks)');
  const appHarness = loadAppInVm();

  await test('setField updates state without re-rendering the detail card', () => {
    const { app, docStub } = appHarness;
    const t = completeTxn();
    app._debug.state.transactions.push(t);
    app._debug.state.currentId = t.id;
    app._debug.renderDetail();
    const stamp0 = app._debug.state.detailRenderStamp;
    const htmlBefore = docStub.getElement('detailCard').innerHTML;

    app.setField('address', 'typed by hand');

    assert.strictEqual(app._debug.state.detailRenderStamp, stamp0, 'detailRenderStamp bumped — full re-render happened');
    assert.strictEqual(docStub.getElement('detailCard').innerHTML, htmlBefore, 'detailCard.innerHTML rewritten during typing');
    assert.strictEqual(t.address, 'typed by hand');
  });

  await test('setSig updates state without re-rendering the detail card', () => {
    const { app, docStub } = appHarness;
    const t = app._debug.currentTxn();
    const stamp0 = app._debug.state.detailRenderStamp;
    const htmlBefore = docStub.getElement('detailCard').innerHTML;
    app.setSig(0, 'Renamed Signatory');
    assert.strictEqual(app._debug.state.detailRenderStamp, stamp0);
    assert.strictEqual(docStub.getElement('detailCard').innerHTML, htmlBefore);
    assert.strictEqual(t.signatories[0], 'Renamed Signatory');
  });

  await test('addSig performs a structural re-render (stamp increments)', () => {
    const { app } = appHarness;
    const stamp0 = app._debug.state.detailRenderStamp;
    app.addSig();
    assert.strictEqual(app._debug.state.detailRenderStamp, stamp0 + 1);
  });

  await test('generateAll: incomplete batch blocked (no ZIP created)', async () => {
    const { app } = appHarness;
    app._debug.state.transactions.length = 0;
    app._debug.state.transactions.push(completeTxn({ id: 'a' }));
    app._debug.state.transactions.push(completeTxn({ id: 'b', valueDate: '' })); // incomplete
    app._debug.state.currentId = 'a';
    let alerted = '';
    global.alert = (m) => { alerted = m; };
    appHarness.setAlert(m => { alerted = m; });
    let zipCreated = false;
    appHarness.setJSZip(function () { zipCreated = true; return { file: () => {}, generateAsync: async () => 'blob' }; });
    await app.generateAll();
    assert.ok(alerted.includes('incomplete'), 'expected "incomplete" alert, got: ' + alerted);
    assert.strictEqual(zipCreated, false, 'ZIP should not be created for an incomplete batch');
  });

  await test('generateAll: complete batch allowed (ZIP created, filenames deduped)', async () => {
    const { app } = appHarness;
    app._debug.state.transactions.length = 0;
    app._debug.state.transactions.push(completeTxn({ id: 'a' }));
    app._debug.state.transactions.push(completeTxn({ id: 'b' })); // same beneficiary/date
    app._debug.state.currentId = 'a';
    const entries = [];
    appHarness.setJSZip(function () {
      return {
        file(name /*, bytes */) { entries.push(name); },
        generateAsync: async () => new Uint8Array([1, 2, 3])
      };
    });
    appHarness.setDownload(() => {});
    appHarness.setTemplateReady(templateBytes);
    await app.generateAll();
    assert.strictEqual(entries.length, 2);
    assert.notStrictEqual(entries[0], entries[1], 'ZIP entries must have unique names: ' + entries.join(', '));
    assert.ok(entries[1].endsWith('_2.pdf'), 'expected suffix _2.pdf, got ' + entries[1]);
  });

  console.log('\nResult: ' + ok + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

/* ---------- app harness (loads app.js in a vm with a stub DOM) ---------- */
function loadAppInVm() {
  const elements = {};
  function mkEl(id) {
    return {
      id, _cls: new Set(), innerHTML: '', textContent: '', value: '', disabled: false,
      onclick: null, onchange: null, oninput: null,
      classList: {
        add(c)    { elements[id]._cls.add(c); },
        remove(c) { elements[id]._cls.delete(c); },
        toggle(c, on) {
          if (on === undefined) on = !elements[id]._cls.has(c);
          if (on) elements[id]._cls.add(c); else elements[id]._cls.delete(c);
        }
      },
      appendChild() {}, addEventListener() {}, click() {},
      setAttribute() {}, getAttribute() { return null; }
    };
  }
  ['drop','dropCard','detailCard','txList','fileInput','btnGenerateAll','btnClearAll','btnSignOut']
    .forEach(id => elements[id] = mkEl(id));

  const sandbox = {};
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.Promise = Promise;
  sandbox.Set = Set;
  sandbox.Map = Map;
  sandbox.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
  sandbox.Blob = function () {};
  sandbox.console = console;
  sandbox.alert = () => {};
  sandbox.confirm = () => true;
  sandbox.fetch = async () => { throw new Error('no fetch'); };
  sandbox.JSZip = null;
  sandbox.MsgReader = null;
  sandbox.PDFLib = null;
  sandbox.document = {
    _pendingDCL: null,
    addEventListener(evt, fn) { if (evt === 'DOMContentLoaded') this._pendingDCL = fn; },
    getElementById(id) { return elements[id] || null; },
    createElement() { return mkEl('anon'); },
    body: { appendChild() {}, removeChild() {} },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  vm.createContext(sandbox);
  const mods = ['cleanup.js','words.js','require.js','state.js','extract.js','parser.js','pdf-fill.js','app.js'];
  for (const m of mods) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', m), 'utf8'), sandbox, { filename: m });
  }
  const app = sandbox.ARIE_app;
  return {
    app,
    sandbox,
    docStub: { getElement: id => elements[id] },
    setAlert(fn) { sandbox.alert = fn; },
    setJSZip(ctor) { sandbox.JSZip = ctor; },
    setDownload(_) { /* Blob download is a no-op in the sandbox */ },
    setTemplateReady(bytes) {
      sandbox.self.MAUBANK_TEMPLATE_BYTES = bytes;
      app._debug.state.templateBytes = bytes;
      sandbox.PDFLib = PDFLib;
      sandbox.self.PDFLib = PDFLib;
      sandbox.Uint8Array = Uint8Array;
    }
  };
}

run();
