// Exports: PDF (browser print of the rendered sheets) and DOCX (docx.js, structured & editable).
// No PDF-writing library is loaded: the optional pdf-lib merge utility was removed in v0.6.0 because
// copyPages carried page-level /AA and annotation JavaScript actions from an uploaded PDF into the
// merged output, and the utility was not part of the workflow.
(function () {
  'use strict';
  const D = window.ARIE_DEFAULTS, R = window.ARIE_RENDER;

  // ---------- helpers ----------
  // Filename component: keeps letters and digits of any script (so a client name in Arabic, Chinese or
  // accented Latin survives) and replaces everything else — including every character Windows forbids in
  // a filename — with an underscore.
  const safe = (x) => String(x == null ? '' : x).normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  function download(blob, filename) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function b64ToBytes(dataUrl) { const b = atob(dataUrl.split(',')[1]); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

  // ---------- PDF via print ----------
  function printPdf(title) {
    document.title = title;
    const go = () => window.print();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => setTimeout(go, 120)); else setTimeout(go, 120);
  }

  // ---------- DOCX ----------
  const NAVY = '06113A', GOLD = 'C99B3F', SAND = '9A9078', SLATE = '3A4256', RULE = 'E4D8BE', HEAD_FILL = 'F1E7CE', TILE_FILL = 'FDFBF6';
  const SANS = 'Arial', SERIF = 'Georgia'; // Word substitutes; brand fonts are not assumed on staff machines.

  function lib() { return window.docx; }

  function run(text, o) { const d = lib(); return new d.TextRun(Object.assign({ text, font: SANS, size: 20, color: SLATE }, o || {})); }
  function para(children, o) { const d = lib(); return new d.Paragraph(Object.assign({ children: Array.isArray(children) ? children : [children], spacing: { after: 120 } }, o || {})); }
  function ptext(text, o, po) { return para(run(text, o), po); }
  function label(text) { return ptext(text.toUpperCase(), { size: 16, bold: true, color: SAND, characterSpacing: 40 }, { spacing: { after: 40 } }); }
  function sectionHeading(text) {
    const d = lib();
    return new d.Paragraph({ children: [run(text.toUpperCase(), { size: 19, bold: true, color: NAVY, characterSpacing: 60 })], spacing: { before: 260, after: 120 }, keepNext: true, keepLines: true, border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: 'DBCBA0', space: 4 } } });
  }
  function multi(text, o) { // "a\nb" -> runs with breaks
    const d = lib(); const lines = String(text || '').split('\n'); const out = [];
    lines.forEach((l, i) => { if (i) out.push(new d.TextRun({ break: 1 })); out.push(run(l, o)); });
    return out;
  }
  const border = (color) => ({ style: lib().BorderStyle.SINGLE, size: 6, color: color || RULE });
  const borders = (c) => ({ top: border(c), bottom: border(c), left: border(c), right: border(c) });
  function cell(children, o) {
    const d = lib();
    return new d.TableCell(Object.assign({ children: Array.isArray(children) ? children : [children], borders: borders(), margins: { top: 120, bottom: 120, left: 160, right: 160 }, verticalAlign: d.VerticalAlign.CENTER }, o || {}));
  }
  function table(rows, widths) {
    const d = lib();
    return new d.Table({ rows, width: { size: 100, type: d.WidthType.PERCENTAGE }, columnWidths: widths, layout: d.TableLayoutType.FIXED });
  }
  const W_TOTAL = 9640; // usable width in twips at 2cm margins

  function brandHeader(extra) {
    const d = lib();
    const logo = new d.ImageRun({ type: 'png', data: b64ToBytes(window.ARIE_ASSETS.LOGO_WIDE), transformation: { width: 150, height: 36 } });
    return new d.Header({ children: (extra || []).length ? [headerTable(d, logo)].concat(extra) : [headerTable(d, logo)] });
  }
  function headerTable(d, logo) {
    return (
      new d.Table({ width: { size: 100, type: d.WidthType.PERCENTAGE }, columnWidths: [4000, 5640], layout: d.TableLayoutType.FIXED, borders: { top: { style: d.BorderStyle.NONE }, bottom: { style: d.BorderStyle.SINGLE, size: 6, color: GOLD }, left: { style: d.BorderStyle.NONE }, right: { style: d.BorderStyle.NONE }, insideVertical: { style: d.BorderStyle.NONE }, insideHorizontal: { style: d.BorderStyle.NONE } },
        rows: [new d.TableRow({ children: [
          new d.TableCell({ children: [new d.Paragraph({ children: [logo] })], borders: borders('FFFFFF'), margins: { bottom: 120 } }),
          new d.TableCell({ children: [
            new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [run(D.REGULATOR.toUpperCase(), { size: 14, bold: true, color: SLATE, characterSpacing: 30 })] }),
            new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [run(D.LICENCE.toUpperCase(), { size: 14, bold: true, color: SAND, characterSpacing: 30 })] })
          ], borders: borders('FFFFFF'), margins: { bottom: 120 } })
        ] })] })
    );
  }
  // Footer: confidentiality line, optional document identifiers (right), contacts, "Page n of m".
  function brandFooter(left, ids) {
    const d = lib(); const f = D.FOOTER;
    const pageRun = [run('Page ', { size: 14, color: SAND }), new d.TextRun({ children: [d.PageNumber.CURRENT], font: SANS, size: 14, color: SAND }), run(' of ', { size: 14, color: SAND }), new d.TextRun({ children: [d.PageNumber.TOTAL_PAGES], font: SANS, size: 14, color: SAND })];
    return new d.Footer({ children: [
      new d.Paragraph({ children: [run((left || 'Private & Confidential').toUpperCase(), { size: 14, bold: true, color: SAND, characterSpacing: 40 })].concat(ids ? [new d.TextRun({ children: [new d.Tab()] }), run(ids, { size: 14, bold: true, color: SAND })] : []), tabStops: [{ type: d.TabStopType.RIGHT, position: 9640 }], border: { top: { style: d.BorderStyle.SINGLE, size: 6, color: 'E0D3B4', space: 6 } }, spacing: { after: 40 } }),
      new d.Paragraph({ children: [run(f.web + '   ·   ' + f.email + '   ·   ' + f.phone, { size: 16, color: SLATE }), new d.TextRun({ children: [new d.Tab()] })].concat(pageRun), tabStops: [{ type: d.TabStopType.RIGHT, position: 9640 }] })
    ] });
  }
  const PAGE = { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1134, right: 1134 } } };
  function sectionProps(left, ids) {
    return { properties: PAGE, headers: { default: brandHeader() }, footers: { default: brandFooter(left, ids) } };
  }
  // Fee-schedule sections: the first page carries the brand header only; every later page adds a
  // "CLIENT FEE SCHEDULE · CONTINUED · <client>" line so continuation pages keep their context.
  function feeSectionProps(doc, left, ids) {
    const d = lib();
    const cont = (doc.title + ' · continued' + (doc.clientFields && doc.preparedFor ? ' · ' + doc.preparedFor : '')).toUpperCase();
    const contHeader = brandHeader([new d.Paragraph({ children: [run(cont, { size: 14, bold: true, color: SAND, characterSpacing: 40 })], spacing: { before: 80, after: 120 } })]);
    return { properties: Object.assign({ titlePage: true }, PAGE), headers: { first: brandHeader(), default: contHeader }, footers: { first: brandFooter(left, ids), default: brandFooter(left, ids) } };
  }

  // Fee-schedule body (also reused inside the Welcome Pack)
  function feeBody(doc) {
    const d = lib(); const out = [];
    out.push(ptext(doc.eyebrow, { size: 18, bold: true, color: 'B88A32', characterSpacing: 120 }, { spacing: { before: 200, after: 60 } }));
    out.push(ptext(doc.title, { size: 60, font: SERIF, color: NAVY }, { spacing: { after: 80 } }));
    out.push(ptext(doc.subtitle.toUpperCase(), { size: 17, bold: true, color: SAND, characterSpacing: 80 }, { spacing: { after: 200 } }));
    if (doc.clientFields) {
      out.push(table([new d.TableRow({ children: [
        cell([label('Prepared for'), ptext(doc.preparedFor || '', { size: 24, font: SERIF, bold: true, color: NAVY })]),
        cell([label('Reference'), ptext(doc.reference || '', { size: 20, bold: true, color: NAVY })]),
        cell([label('Issue date'), ptext(doc.date || '', { size: 20, bold: true, color: NAVY })])
      ] })], [4820, 2410, 2410]));
    }
    out.push(ptext(doc.intro, { size: 22 }, { spacing: { before: 200, after: 120 } }));
    out.push(ptext(doc.note, { size: 19 }));
    for (const b of doc.blocks) {
      if (b.type === 'feeGrid') {
        out.push(sectionHeading(b.title));
        const profiles = (b.profiles || []).filter(p => p && p.fees && p.fees.length);
        if (!profiles.length) { out.push(ptext('No fees in this section.', { size: 18, italics: true })); continue; }
        if (profiles.length === 1) {
          const fees = profiles[0].fees; const w = Math.floor(W_TOTAL / fees.length);
          out.push(table([new d.TableRow({ children: fees.map(f => { const [big, unit] = R.splitUnit(f.value); return cell([label(f.label), ptext(big, { size: 34, bold: true, color: NAVY }, { spacing: { after: 20 } }), ...(unit ? [ptext('per ' + unit.toUpperCase(), { size: 15, bold: true, color: SAND })] : [])], { shading: { fill: TILE_FILL, type: d.ShadingType.CLEAR, color: 'auto' } }); }) })], fees.map(() => w)));
        } else {
          const w = Math.floor(W_TOTAL / profiles.length);
          out.push(table([new d.TableRow({ children: profiles.map(p => cell([ptext(p.label.toUpperCase(), { size: 17, bold: true, color: NAVY, characterSpacing: 60 }, { spacing: { after: 160 } }), ...p.fees.flatMap(f => { const [big, unit] = R.splitUnit(f.value); return [label(f.label), ptext(big + (unit ? '  ' + 'per ' + unit : ''), { size: 28, bold: true, color: NAVY }, { spacing: { after: 140 } })]; })], { shading: { fill: TILE_FILL, type: d.ShadingType.CLEAR, color: 'auto' } })) })], profiles.map(() => w)));
        }
      } else if (b.type === 'table') {
        out.push(sectionHeading(b.title));
        const cols = (b.columns && b.columns.length) ? b.columns : ['Item'];
        const w = Math.floor(W_TOTAL / cols.length);
        const rows = [new d.TableRow({ tableHeader: true, children: cols.map(c => cell(ptext(c.toUpperCase(), { size: 16, bold: true, color: NAVY, characterSpacing: 40 }, { spacing: { after: 0 } }), { shading: { fill: HEAD_FILL, type: d.ShadingType.CLEAR, color: 'auto' } })) })];
        for (const r of (b.rows || [])) rows.push(new d.TableRow({ children: cols.map((c, i) => cell(para(multi(r[i] || '', i === 0 ? { color: NAVY, bold: true } : {}), { spacing: { after: 0 } }))) }));
        out.push(table(rows, cols.map(() => w)));
        if (b.note) out.push(ptext(b.note, { size: 18 }, { spacing: { before: 120 } }));
      } else if (b.type === 'feeList') {
        out.push(sectionHeading(b.title));
        if (!(b.rows || []).length) continue;
        out.push(table(b.rows.map(r => new d.TableRow({ children: [cell(ptext(r.label, {}, { spacing: { after: 0 } }), { shading: { fill: TILE_FILL, type: d.ShadingType.CLEAR, color: 'auto' } }), cell(new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [run(r.fee, { size: 26, bold: true, color: NAVY })], spacing: { after: 0 } }), { shading: { fill: TILE_FILL, type: d.ShadingType.CLEAR, color: 'auto' } })] })), [7230, 2410]));
      } else if (b.type === 'bullets') {
        out.push(sectionHeading(b.title));
        (b.items || []).filter(x => x && x.trim()).forEach(x => out.push(new d.Paragraph({ children: [run(x, { size: 19 })], bullet: { level: 0 }, spacing: { after: 80 } })));
      } else if (b.type === 'text') {
        if (b.title) out.push(sectionHeading(b.title));
        out.push(para(multi(b.text, { size: 19 })));
      }
    }
    return out;
  }

  async function feeDocx(doc) {
    const d = lib(), IO = window.ARIE_DOCXIO;
    const left = 'Private & Confidential' + (doc.clientFields && doc.preparedFor ? ' · Prepared for ' + doc.preparedFor : '');
    const build = (props) => new d.Document({ creator: 'ARIE Document Builder', title: doc.title, styles: { default: { document: { run: { font: SANS, size: 20 } } } },
      customProperties: props, sections: [Object.assign(feeSectionProps(doc, left), { children: feeBody(doc) })] });
    // Pass 1: build once to fingerprint the visible body text. Pass 2: embed state + fingerprint.
    // (Custom properties live outside word/document.xml, so the body is byte-identical between passes.)
    const first = await d.Packer.toBlob(build([]));
    const fp = IO.fingerprint(await IO.bodyText(await first.arrayBuffer()));
    return await d.Packer.toBlob(build(IO.toChunks(doc).concat([{ name: 'ARIE_FP', value: fp }])));
  }

  // Welcome pack
  function kv(k, v, mono) { return [label(k), ptext(v || '—', { size: 20, bold: true, color: NAVY, font: mono ? 'Consolas' : SANS }, { spacing: { after: 0 } })]; }
  function fundingTable(a) {
    const d = lib();
    // Same helper as the PDF sheets: a field confirmed N/A prints "Not applicable" and never its value.
    const na = (f) => { const fv = R.fieldValue(a, f); return fv.empty ? '—' : fv.text; };
    const addr = R.fieldValue(a, 'bankAddress');
    const head = new d.TableRow({ children: [cell(ptext((a.currency || '') + ' ACCOUNT', { size: 19, bold: true, color: NAVY, characterSpacing: 80 }, { spacing: { after: 0 } }), { columnSpan: 2, shading: { fill: HEAD_FILL, type: d.ShadingType.CLEAR, color: 'auto' } })] });
    const row = (l, r) => new d.TableRow({ cantSplit: true, children: [cell(l, { shading: { fill: TILE_FILL, type: d.ShadingType.CLEAR, color: 'auto' } }), cell(r, { shading: { fill: TILE_FILL, type: d.ShadingType.CLEAR, color: 'auto' } })] });
    return table([head,
      new d.TableRow({ children: [cell(kv('Beneficiary name', na('beneficiaryName')), { columnSpan: 2, shading: { fill: TILE_FILL, type: d.ShadingType.CLEAR, color: 'auto' } })] }),
      row(kv('Beneficiary account number', na('accountNo'), true), kv('IBAN', na('iban'), true)),
      row([...kv('Beneficiary bank', na('bank')), ...(addr.na || addr.empty ? [] : [ptext(addr.text, { size: 17 }, { spacing: { after: 0 } })])], kv('Beneficiary bank SWIFT / BIC', na('bankSwift'), true)),
      row(kv('Correspondent bank', na('corrBank')), kv('Correspondent SWIFT / BIC · account', R.corrLine(a).text, true))
    ], [4820, 4820]);
  }

  async function welcomeDocx(doc, ctx) {
    const d = lib();
    const cl = R.currencyList(doc.accounts);
    const cover = [
      ptext(doc.coverTitle.toUpperCase(), { size: 30, font: SERIF, color: 'B88A32', characterSpacing: 200 }, { spacing: { before: 2400, after: 300 } }),
      ptext(doc.clientName || '', { size: 64, font: SERIF, color: NAVY }, { spacing: { after: 200 } }),
      ptext(doc.readyLine.toUpperCase(), { size: 18, bold: true, color: SAND, characterSpacing: 80 }, { spacing: { after: 300 } }),
      para(multi(doc.coverText, { size: 23 })),
      ptext(doc.coverCurrencyLine.replace('{currencies}', cl || '—'), { size: 23 }),
      para(multi(doc.coverClose, { size: 23 }))
    ];
    const funding = [ptext(doc.fundingTitle.toUpperCase(), { size: 40, font: SERIF, color: NAVY, characterSpacing: 80 }, { spacing: { before: 200, after: 160 } }), ptext(doc.fundingIntro, { size: 21 })];
    doc.accounts.forEach(a => { funding.push(fundingTable(a)); funding.push(ptext('', {}, { spacing: { after: 160 } })); });
    funding.push(ptext('!  ' + doc.fundingNote, { size: 19, bold: true, color: 'B88A32' }));
    const steps = [ptext(doc.stepsTitle.toUpperCase(), { size: 40, font: SERIF, color: NAVY, characterSpacing: 80 }, { spacing: { before: 200, after: 160 } })];
    doc.steps.forEach((s, i) => {
      steps.push(para([run(String(i + 1).padStart(2, '0') + '   ', { size: 32, font: SERIF, color: 'B88A32' }), run(s.title, { size: 24, bold: true, color: NAVY })], { spacing: { before: 200, after: 80 }, keepNext: true, keepLines: true }));
      steps.push(para(multi(s.body, { size: 19 })));
    });
    steps.push(sectionHeading(doc.governsTitle));
    doc.governs.filter(g => g.trim()).forEach(g => steps.push(ptext(g, { size: 19 })));
    const tc = R.tcLine(doc, ctx, 'docx');   // never 'enclosed': the DOCX carries no T&C pages
    if (tc) steps.push(ptext(tc, { size: 19, bold: true, color: NAVY }));

    let fee = [];
    const feeDoc = doc.feeSource === 'current' ? ctx.clientDoc : (doc.feeSource === 'upload' ? ctx.feeDoc : null);
    if (feeDoc) fee = feeBody(feeDoc);
    else if (doc.feeSource === 'upload') fee = [ptext('Client Fee Schedule', { size: 40, font: SERIF, color: NAVY }, { spacing: { before: 200, after: 160 } }),
      ptext('The Client Fee Schedule for this client was attached as an existing PDF (' + (ctx.feeName || 'file') + ') and is included in the PDF version of this Welcome Pack. It is not reproduced in this Word version; open the original PDF alongside this document if it needs to be amended.', { size: 19 })];

    // One Word section per part of the pack, so each starts on a new page with the branded header/footer.
    const ids = [doc.date, doc.cfsRef, doc.packRef].filter(Boolean).join(' · ');
    const left = 'Private & Confidential' + (doc.clientName ? ' · ' + doc.clientName : '');
    const docx = new d.Document({ creator: 'ARIE Document Builder', title: 'Welcome Pack – ' + (doc.clientName || ''), styles: { default: { document: { run: { font: SANS, size: 20 } } } },
      sections: [
        Object.assign(sectionProps(left, ids), { children: cover }),
        Object.assign(sectionProps(left, ids), { children: funding }),
        Object.assign(sectionProps(left, ids), { children: steps }),
        ...(fee.length ? [Object.assign(feeDoc ? feeSectionProps(feeDoc, 'Private & Confidential' + (doc.clientName ? ' · Prepared for ' + doc.clientName : ''), ids) : sectionProps(left, ids), { children: fee })] : [])
      ] });
    return await d.Packer.toBlob(docx);
  }

  window.ARIE_EXPORT = { printPdf, feeDocx, welcomeDocx, download, safe };
})();
