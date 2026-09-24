// Wiring-detail extraction: deterministic parsing of bank "Wiring Details" PDFs.
//
// Pipeline:  PDF -> pdf.js text items (with x/y) -> lines -> FORMATS[n].parse -> account fields -> validate
//
// Adding a bank format = adding one entry to FORMATS below with its label patterns
// (or a custom parse function). Unknown formats fall through to manual entry.
(function () {
  'use strict';

  const pdfjs = window.pdfjsLib;
  if (pdfjs) pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  // SECURITY — every PDF this tool opens arrives from outside ARIE (a bank, a client, a counterparty).
  // PDF.js up to 4.1.392 compiles font programs with `new Function` unless `isEvalSupported` is false,
  // which CVE-2024-4367 turns into arbitrary script execution from a crafted PDF. Mozilla documents this
  // flag as the mitigation for v3 deployments, and v4+ is ESM-only (it cannot be loaded from file://,
  // which this app must support), so the version stays put and eval stays off.
  //
  // This is the ONLY place a PDF may be opened. tests/e2e.js fails the build if another
  // getDocument call appears, or if this one stops passing isEvalSupported: false.
  function openPdf(data) {
    return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  }

  // ---------- Text extraction ----------

  // Returns { lines: [{y, x, text, items:[{x,y,str}]}], items: [...] } for every page, top to bottom.
  async function extractText(arrayBuffer) {
    const doc = await openPdf(arrayBuffer);
    try {
      const allItems = [];
      let pageOffset = 0;
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        for (const it of content.items) {
          if (!it.str || !it.str.trim()) continue;
          // y grows upwards in PDF space; convert to "distance from top" so sorting is natural.
          const y = pageOffset + (vp.height - it.transform[5]);
          allItems.push({ x: it.transform[4], y, str: it.str.trim(), w: it.width || 0, h: it.height || 10, page: p });
        }
        pageOffset += vp.height;
      }
      const lines = groupLines(allItems, 4);
      return { items: allItems, lines, pages: doc.numPages };
    } finally { await doc.destroy(); }
  }

  function groupLines(items, tol) {
    tol = tol || 3;
    const sorted = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const it of sorted) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) <= tol) { last.items.push(it); }
      else lines.push({ y: it.y, items: [it] });
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      l.x = l.items[0].x;
      let t = '';
      for (let i = 0; i < l.items.length; i++) {
        const it = l.items[i];
        if (i) { const prev = l.items[i - 1]; const gap = it.x - (prev.x + prev.w); t += (prev.w && gap < 1.0) ? '' : ' '; }
        t += it.str;
      }
      l.text = t.replace(/\s+/g, ' ').trim();
    }
    return lines;
  }

  async function pageCount(arrayBuffer) {
    const doc = await openPdf(arrayBuffer);
    try { return doc.numPages; } finally { await doc.destroy(); }
  }

  // Render page 1..n to PNG data URLs (used to append an uploaded PDF inside the printed pack).
  // Rendering is bounded twice over: the document proxy is always destroyed, and a page with an unusual
  // MediaBox is scaled down so no canvas can exceed MAX_PX_SIDE on a side or MAX_MEGAPIXELS in total.
  // A normal A4 or Letter page at scale 2.5 is well inside both, so ordinary output is unchanged.
  const MAX_PX_SIDE = 2800, MAX_MEGAPIXELS = 6;
  function boundedScale(page, scale) {
    const base = page.getViewport({ scale: 1 });
    const w = base.width || 1, h = base.height || 1;
    let s = scale || 2.5;
    s = Math.min(s, MAX_PX_SIDE / Math.max(w, h));
    s = Math.min(s, Math.sqrt((MAX_MEGAPIXELS * 1e6) / (w * h)));
    return Math.max(s, 0.05);
  }
  async function renderPages(arrayBuffer, scale) {
    const doc = await openPdf(arrayBuffer);
    try {
      const out = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: boundedScale(page, scale) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        out.push(canvas.toDataURL('image/jpeg', 0.92));
        canvas.width = canvas.height = 0;   // release the backing store immediately
      }
      return out;
    } finally { await doc.destroy(); }
  }

  // ---------- Field definitions ----------

  const FIELDS = ['beneficiaryName', 'accountNo', 'iban', 'bank', 'bankAddress', 'bankSwift', 'corrBank', 'corrSwift', 'corrAccount'];
  const FIELD_LABELS = {
    currency: 'Currency', beneficiaryName: 'Beneficiary name', accountNo: 'Beneficiary account no.', iban: 'IBAN',
    bank: 'Beneficiary bank', bankAddress: 'Bank address', bankSwift: 'Beneficiary bank SWIFT/BIC',
    corrBank: 'Correspondent bank', corrSwift: 'Correspondent SWIFT/BIC', corrAccount: 'Correspondent account no.'
  };
  // Fields that a legitimate account can be without (warning, never an error).
  const OPTIONAL = { corrBank: true, corrSwift: true, corrAccount: true, bankAddress: true };

  // ---------- Formats ----------
  // Order matters: the first format whose `detect` returns true is used.

  const FORMATS = [
    {
      id: 'maubank-word',
      name: 'MauBank "Wiring Details" (Word export)',
      // MauBank IBANs end with the currency code and embed the beneficiary account number; these two
      // cross-checks are only meaningful for this format and are not applied to other banks or manual entries.
      ibanCrossChecks: true,
      // Layout alone ("Wiring Details" + "Beneficiary Name") is not enough: the document must identify
      // MauBank itself (bank name or its BIC), otherwise it falls through to the generic parser.
      detect: (lines) => lines.some(l => /wiring\s*details/i.test(l.text)) && lines.some(l => /beneficiary\s*name/i.test(l.text)) && lines.some(l => /mau\s*bank|MPCBMUMU/i.test(l.text)),
      labels: {
        beneficiaryName: /^beneficiaryname/i,
        accountNo: /^beneficiaryaccount(no\.?|number)?/i,
        iban: /^iban(no\.?|number)?/i,
        bank: /^beneficiarybank(name)?/i,
        bankAddress: /^bankaddress/i,
        bankSwift: /^swift(code)?ofbeneficiar[^:]*?bank/i,
        corrBank: /^correspondentbank(name)?/i,
        corrSwift: /^swift(code)?ofcorrespondent(bank)?/i,
        corrAccount: /^correspondentaccount(no\.?|number)?/i
      },
      currency: (lines, filename) => {
        const t = lines.map(l => l.text).find(t => /wiring\s*details/i.test(t)) || '';
        const m = t.match(/\b([A-Z]{3})\b\s*account/i) || t.match(/[-–]\s*([A-Z]{3})\b/);
        return m ? m[1].toUpperCase() : '';
      }
    },
    {
      // Generic "Label : Value" fallback for any text PDF with recognisable labels.
      id: 'generic-label-value',
      name: 'Generic label : value',
      detect: (lines) => lines.some(l => /iban/i.test(l.text)) || lines.some(l => /swift|bic/i.test(l.text)),
      // Matched on whitespace-stripped line text; the longest matching label wins, so
      // "BankAddress" beats "Bank" and "SwiftCodeofCorrespondentBank" beats "SwiftCode".
      labels: {
        beneficiaryName: /^(beneficiary|account|payee)name/i,
        accountNo: /^(beneficiary)?account(no\.?|number)/i,
        iban: /^iban(no\.?|number)?/i,
        bank: /^(beneficiary)?bank(name)?/i,
        bankAddress: /^(bank)?address/i,
        bankSwift: /^(swift|bic)(code)?(\/bic)?(ofbeneficiar[^:]*?bank)?/i,
        corrBank: /^(correspondent|intermediary)bank(name)?/i,
        corrSwift: /^((swift|bic)(code)?of(correspondent|intermediary)(bank)?|(correspondent|intermediary)(bank)?(swift|bic)(code)?)/i,
        corrAccount: /^(correspondent|intermediary)account(no\.?|number)?/i
      },
      currency: () => ''
    }
  ];

  // ---------- Parsing ----------

  // Line-based parsing. Each y-line is either a LABEL line ("Beneficiary Bank : MauBank Ltd") or a
  // CONTINUATION line (a wrapped value). Labels are matched on the line text with whitespace removed,
  // because pdf.js splits words unpredictably ("I" "BAN" "No ."). A continuation line is attached to the
  // vertically nearest label line, before or after it, which is how wrapped values appear in Word exports.
  function parseWithLabels(lines, labelPatterns) {
    const labelled = [];
    for (const l of lines) {
      const compact = l.text.replace(/\s+/g, '');
      const map = []; for (let i = 0; i < l.text.length; i++) if (!/\s/.test(l.text[i])) map.push(i);
      let hit = null;
      for (const f of Object.keys(labelPatterns)) { const m = compact.match(labelPatterns[f]); if (m && (!hit || m[0].length > hit.len)) hit = { field: f, len: m[0].length }; }
      if (hit) { const rest = l.text.slice(map[hit.len - 1] + 1); labelled.push({ field: hit.field, y: l.y, value: rest.replace(/^[\s:.]+/, '').trim(), before: [], after: [] }); }
      else labelled.push({ field: null, y: l.y, text: l.text });
    }
    const labels = labelled.filter(x => x.field);
    if (!labels.length) return { fields: {} };
    const gap = median(labels.slice(1).map((l, i) => l.y - labels[i].y)) || 20;
    for (const c of labelled) {
      if (c.field || /^[\s:]*$/.test(c.text)) continue;
      let best = null, bestD = Infinity;
      for (const l of labels) { const d = Math.abs(l.y - c.y); if (d < bestD) { bestD = d; best = l; } }
      if (!best || bestD > gap * 0.9) continue; // title, footer or unrelated line
      (c.y < best.y ? best.before : best.after).push(c.text.replace(/^[\s:]+/, ''));
    }
    const fields = {};
    for (const l of labels) {
      const v = [...l.before, l.value, ...l.after].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (v && !fields[l.field]) fields[l.field] = v;
    }
    return { fields };
  }

  function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

  // ISO 4217 active currency codes.
  const ISO4217 = new Set('AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWG'.split(' '));
  function currencyFromIban(iban) {
    const m = (iban || '').replace(/\s/g, '').toUpperCase().match(/([A-Z]{3})$/);
    return m && ISO4217.has(m[1]) ? m[1] : '';
  }
  // Only a STANDALONE three-letter token counts. The old rule scanned every three-letter run, so
  // "MURRAY HOLDINGS Wiring.pdf" silently became MUR and "CADENCE LTD" became CAD — a wrong currency on
  // a funding instruction. A token is standalone when it is bounded by a separator, the string edge or a
  // case change, which still recognises Wiring_Details_USD.pdf, Account-EUR.pdf and "GBP account.pdf".
  function currencyFromFilename(name) {
    const base = (name || '').replace(/\.[a-z0-9]+$/i, '');
    const tokens = base.split(/[^A-Za-z]+/).filter(Boolean);
    for (const t of tokens) {
      if (t.length === 3 && ISO4217.has(t.toUpperCase())) return t.toUpperCase();
    }
    return '';
  }

  // Main entry: file (File/Blob) -> account object + diagnostics.
  // `buf` is the file's bytes, already read by the caller. The wiring drop path reads each file exactly
  // once and passes the same buffer to the size/page guard and to this parser.
  async function parseWiringFile(file, buf) {
    const { items, lines } = await extractText(buf ? buf.slice(0) : await file.arrayBuffer());
    const fmt = FORMATS.find(f => f.detect(lines)) || null;
    const sourceText = lines.map(l => l.text).join('\n');
    const acct = window.ARIE_DEFAULTS.account({ sourceName: file.name, sourceText, parsedBy: fmt ? fmt.id : 'none' });
    if (fmt) {
      const { fields } = parseWithLabels(lines, fmt.labels);
      for (const f of FIELDS) if (fields[f]) acct[f] = fields[f];
      acct.iban = (acct.iban || '').replace(/\s/g, '').toUpperCase();
      acct.bankSwift = (acct.bankSwift || '').replace(/\s/g, '').toUpperCase();
      acct.corrSwift = (acct.corrSwift || '').replace(/\s/g, '').toUpperCase();
      // The IBAN currency suffix is a MauBank convention, not an IBAN rule — a generic IBAN that happens
      // to end in three letters must not set the currency. Other banks fall back to an explicit filename
      // token, and otherwise the field is left blank for staff to complete (validateAccount flags it).
      acct.currency = fmt.currency(lines, file.name)
        || (fmt.ibanCrossChecks ? currencyFromIban(acct.iban) : '')
        || currencyFromFilename(file.name);
    } else {
      acct.currency = currencyFromFilename(file.name);
    }
    acct.checks = validateAccount(acct);
    return acct;
  }

  // ---------- Validation ----------

  function ibanChecksumOk(iban) {
    const s = (iban || '').replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    const rearranged = s.slice(4) + s.slice(0, 4);
    let rem = 0;
    for (const ch of rearranged) {
      const v = ch >= 'A' ? (ch.charCodeAt(0) - 55).toString() : ch;
      for (const d of v) rem = (rem * 10 + (+d)) % 97;
    }
    return rem === 1;
  }
  const swiftOk = (s) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test((s || '').toUpperCase());

  // Returns { field: {level:'ok'|'warn'|'error', msg} } for every field plus cross-checks.
  function validateAccount(a) {
    const c = {};
    const set = (f, level, msg) => { c[f] = { level, msg }; };
    if (!a.currency) set('currency', 'error', 'Currency not detected — enter it.');
    else if (!ISO4217.has(String(a.currency).toUpperCase())) set('currency', 'error', '"' + a.currency + '" is not an ISO 4217 currency code.');
    for (const f of FIELDS) {
      const v = (a[f] || '').trim();
      if (a.na && a.na[f]) { set(f, 'ok', 'Confirmed not applicable'); continue; }
      if (!v) { set(f, OPTIONAL[f] ? 'warn' : 'error', 'Missing — edit or confirm N/A'); continue; }
      set(f, 'ok', '');
    }
    const fmt = FORMATS.find(f => f.id === a.parsedBy);
    const crossChecks = !!(fmt && fmt.ibanCrossChecks);
    if (a.iban && !(a.na && a.na.iban)) {
      if (!ibanChecksumOk(a.iban)) set('iban', 'error', 'IBAN checksum fails — check for a transcription error');
      else if (crossChecks) {
        const cur = currencyFromIban(a.iban);
        if (cur && a.currency && cur !== a.currency) set('iban', 'warn', 'IBAN currency suffix (' + cur + ') differs from the detected currency (' + a.currency + ')');
        if (a.accountNo && a.iban.indexOf(a.accountNo.replace(/\s/g, '')) < 0) set('accountNo', 'warn', 'Account number not found inside the IBAN — check both');
      }
    }
    if (a.bankSwift && !(a.na && a.na.bankSwift) && !swiftOk(a.bankSwift)) set('bankSwift', 'error', 'Does not look like a SWIFT/BIC (8 or 11 characters)');
    if (a.corrSwift && !(a.na && a.na.corrSwift) && !swiftOk(a.corrSwift)) set('corrSwift', 'error', 'Does not look like a SWIFT/BIC (8 or 11 characters)');
    if (a.parsedBy === 'none') set('_format', 'warn', 'Unrecognised document format — fields left for manual entry');
    return c;
  }

  function worstLevel(checks) {
    let w = 'ok';
    for (const k of Object.keys(checks || {})) { const l = checks[k].level; if (l === 'error') return 'error'; if (l === 'warn') w = 'warn'; }
    return w;
  }

  // ---------- Fee-schedule PDF metadata (for an uploaded Client Fee Schedule) ----------
  async function readFeeScheduleMeta(arrayBuffer) {
    const { lines } = await extractText(arrayBuffer);
    const meta = { name: '', reference: '', date: '', docType: 'unknown' };
    // Document type from the title area: an Indicative Fee Schedule or a Welcome Pack must not be
    // attached as a Client Fee Schedule. Anything without a recognisable title stays 'unknown' and
    // keeps the confirmable verification warning.
    // Whitespace is stripped before matching: branded titles are letter-spaced, so the text layer
    // reads "WE L C O M E PAC K". A Welcome Pack is tested first — it also contains the words
    // "Client Fee Schedule" further down.
    const head = lines.slice(0, 40).map(l => l.text).join(' ').replace(/\s+/g, '');
    if (/welcomepack/i.test(head)) meta.docType = 'welcome';
    else if (/indicativefeeschedule/i.test(head)) meta.docType = 'indicative';
    else if (/clientfeeschedule/i.test(head)) meta.docType = 'client';
    for (const l of lines) {
      const m = l.text.match(/\b(ARIE-FS-[A-Z0-9-]+)\b/i);
      if (m && !meta.reference) {
        meta.reference = m[1];
        const before = l.text.slice(0, l.text.indexOf(m[1])).trim();
        if (before && !meta.name) meta.name = before;
        const d = l.text.slice(l.text.indexOf(m[1]) + m[1].length).match(/\d{1,2}\s+[A-Za-z]+\s+\d{4}/);
        if (d) meta.date = d[0];
      }
    }
    if (!meta.name) { const f = lines.map(l => l.text).find(t => /prepared\s*for\s+/i.test(t)); if (f) meta.name = f.replace(/.*prepared\s*for\s+/i, '').replace(/\s*www\..*$/, '').trim(); }
    return meta;
  }

  window.ARIE_WIRING = { openPdf, boundedScale, currencyFromFilename, extractText, renderPages, pageCount, ISO4217, parseWiringFile, validateAccount, worstLevel, FIELDS, FIELD_LABELS, OPTIONAL, FORMATS, ibanChecksumOk, swiftOk, readFeeScheduleMeta, currencyFromIban };
})();
