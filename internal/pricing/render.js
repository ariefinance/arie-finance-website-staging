// Renders document state to explicit A4 sheets (HTML strings).
//
// Pagination is height-based: blocks are rendered once into a hidden measuring sheet, their pixel
// heights read back, then packed onto pages. Every page carries the ARIE header and footer. Tables,
// bullet lists and fee lists may split between rows when a block does not fit; fee tiles and free
// text move whole. Nothing is left to the browser's own print fragmentation.
(function () {
  'use strict';
  const A = window.ARIE_ASSETS, D = window.ARIE_DEFAULTS;

  const PAGE_H = 1123;                 // A4 at 96 dpi
  const BODY_PAD = 32 + 16;            // .body padding top + bottom
  const SAFETY = 3;                    // px slack per page

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nl = (s) => esc(s).replace(/\n/g, '<br>');
  const ph = (v, fallback) => (v && String(v).trim()) ? esc(v) : '<span class="placeholder">' + esc(fallback) + '</span>';

  function header() {
    return '<div class="hdr"><img src="' + A.LOGO_WIDE + '" alt="ARIE Finance"><div class="reg"><div>' + esc(D.REGULATOR) + '</div><div>' + esc(D.LICENCE) + '</div></div></div><div class="hdr-rule"></div>';
  }
  function watermark() {
    return '<div class="wm" aria-hidden="true"><img class="a" src="' + A.MARK_A + '" alt=""><img class="b" src="' + A.MARK_B + '" alt=""></div>';
  }
  function footer(left, right) {
    const f = D.FOOTER;
    return '<div class="foot"><div class="pc">' + left + '</div>' + (right != null ? right :
      '<div class="contacts"><span>' + f.web + '</span><i></i><span>' + f.email + '</span><i></i><span>' + f.phone + '</span></div>') + '</div>';
  }
  const secH = (t) => '<div class="sec-h"><span>' + esc(t) + '</span><span></span></div>';
  const pageNo = (i, n) => n > 1 ? '<span class="pg">Page ' + i + ' of ' + n + '</span>' : '';

  // "USD 150 / month" -> ["USD 150", "month"]
  function splitUnit(v) { const i = (v || '').indexOf(' / '); return i < 0 ? [v || '', ''] : [v.slice(0, i), v.slice(i + 3)]; }

  // ---------- Fee schedule blocks ----------
  // Each renderer takes (block, from, to, continued) and renders rows [from, to). from/to are ignored by
  // non-splittable blocks. Splittable rows are wrapped in <div class="part"> / <tr class="part"> for measuring.

  const tileHtml = (f) => { const [big, unit] = splitUnit(f.value); return '<div><div class="tile-k">' + esc(f.label) + '</div><div class="tile-v">' + esc(big) + '</div>' + (unit ? '<div class="tile-u">per ' + esc(unit) + '</div>' : '') + '</div>'; };

  const BLOCKS = {
    feeGrid: {
      splittable: false,
      render(b) {
        const profiles = (b.profiles || []).filter(p => p && p.fees && p.fees.length);
        if (!profiles.length) return secH(b.title) + '<p class="note placeholder">No fees in this section — add a fee or remove the section.</p>';
        let h = secH(b.title);
        if (profiles.length === 1) {
          h += '<div class="tiles" style="grid-template-columns: repeat(' + profiles[0].fees.length + ', 1fr)">' + profiles[0].fees.map(tileHtml).join('') + '</div>';
        } else {
          h += '<div class="profiles" style="grid-template-columns: repeat(' + profiles.length + ', 1fr)">' + profiles.map(p =>
            '<div class="profile"><div class="p-label">' + esc(p.label) + '</div><div class="p-dash"></div>' + p.fees.map(f => { const [big, unit] = splitUnit(f.value); return '<div class="p-fee"><div class="tile-k">' + esc(f.label) + '</div><div class="tile-v">' + esc(big) + '</div>' + (unit ? '<div class="tile-u">per ' + esc(unit) + '</div>' : '') + '</div>'; }).join('') + '</div>').join('') + '</div>';
        }
        return h;
      }
    },
    table: {
      splittable: true, count: (b) => (b.rows || []).length,
      render(b, from, to, continued) {
        const cols = (b.columns && b.columns.length) ? b.columns : ['Item'];
        const rows = (b.rows || []).slice(from, to);
        const cell = (v, ci) => {
          const lines = String(v || '').split('\n');
          if (ci === 0 || lines.length === 1) return nl(v);
          return '<div class="l1">' + esc(lines[0]) + '</div>' + (lines[1] ? '<div class="l2">' + esc(lines[1]) + '</div>' : '') + (lines.length > 2 ? '<div class="l3">' + esc(lines.slice(2).join(' ')) + '</div>' : '');
        };
        const last = to >= (b.rows || []).length;
        return secH(b.title + (continued ? ' (continued)' : '')) + '<table class="grid"><thead><tr>' + cols.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr class="part">' + cols.map((c, ci) => '<td>' + cell(r[ci], ci) + '</td>').join('') + '</tr>').join('') + '</tbody></table>' +
          (last && b.note ? '<p class="note">' + nl(b.note) + '</p>' : '');
      }
    },
    feeList: {
      splittable: true, count: (b) => (b.rows || []).length,
      render(b, from, to, continued) {
        return secH(b.title + (continued ? ' (continued)' : '')) + (b.rows || []).slice(from, to).map(r => '<div class="fee-row part"><span>' + esc(r.label) + '</span><span>' + esc(r.fee) + '</span></div>').join('');
      }
    },
    bullets: {
      splittable: true, count: (b) => (b.items || []).filter(x => x && x.trim()).length,
      render(b, from, to, continued) {
        return secH(b.title + (continued ? ' (continued)' : '')) + (b.items || []).filter(x => x && x.trim()).slice(from, to).map(x => '<div class="bullet part"><i></i><span>' + esc(x) + '</span></div>').join('');
      }
    },
    text: {
      splittable: false,
      render(b) { return (b.title ? secH(b.title) : '') + '<p class="free">' + nl(b.text) + '</p>'; }
    }
  };
  const blockDef = (b) => BLOCKS[b.type] || BLOCKS.text;

  // ---------- Measuring ----------
  let measureEl = null, lastPack = null;
  function measurer() {
    if (!measureEl) {
      measureEl = document.createElement('div');
      measureEl.className = 'sheet measure';
      measureEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(measureEl);
    }
    return measureEl;
  }
  // Renders html inside a .body and returns the content height plus per-part heights.
  function measure(html, raw) {
    const m = measurer();
    // raw: measure outside the padded .body (used for the footer, which spans the full sheet width)
    m.innerHTML = raw ? '<div class="mwrap">' + html + '</div>' : '<div class="body"><div class="mwrap">' + html + '</div></div>';
    const wrap = m.querySelector('.mwrap');
    const parts = Array.from(m.querySelectorAll('.part')).map(p => p.getBoundingClientRect().height);
    return { height: wrap.getBoundingClientRect().height, parts };
  }

  // ---------- Generic packer ----------
  // items: [{ html, height, block?, from?, ... }] ; returns pages: [[item,...], ...]
  // A splittable block that does not fit is cut between rows when at least 2 rows fit on the current page.
  function packBlocks(blocks, availFirst, availCont) {
    const pages = [[]]; let remaining = availFirst - SAFETY;
    const newPage = () => { pages.push([]); remaining = availCont - SAFETY; };
    const queue = blocks.map(b => Object.assign({ from: 0, continued: false }, b));
    while (queue.length) {
      const it = queue.shift();
      const def = blockDef(it.block);
      const total = def.splittable ? def.count(it.block) : 0;
      const html = def.render(it.block, it.from, total, it.continued);
      const m = measure('<div class="blk">' + html + '</div>');
      if (m.height <= remaining) { pages[pages.length - 1].push({ html, height: m.height }); remaining -= m.height; continue; }
      if (def.splittable && total - it.from > 2) {
        const overhead = m.height - m.parts.reduce((a, b) => a + b, 0);
        let fit = 0, used = overhead;
        for (const ph_ of m.parts) { if (used + ph_ > remaining) break; used += ph_; fit++; }
        if (fit >= 2 && fit < m.parts.length) {
          const partHtml = def.render(it.block, it.from, it.from + fit, it.continued);
          pages[pages.length - 1].push({ html: partHtml, height: measure('<div class="blk">' + partHtml + '</div>').height });
          newPage();
          queue.unshift({ block: it.block, from: it.from + fit, continued: true });
          continue;
        }
      }
      if (pages[pages.length - 1].length) newPage();
      // Oversized single block: place it anyway; the page-level overflow check will flag it.
      pages[pages.length - 1].push({ html, height: m.height }); remaining -= m.height;
    }
    return pages;
  }

  // ---------- Fee schedule ----------
  function feeTop(doc) {
    const meta = doc.clientFields ? '<div class="meta"><div><div class="k">Prepared for</div><div class="v name">' + ph(doc.preparedFor, 'Client legal name') + '</div></div>' +
      '<div><div class="k">Reference</div><div class="v">' + ph(doc.reference, 'Reference') + '</div></div>' +
      '<div><div class="k">Issue Date</div><div class="v">' + ph(doc.date, 'DD Month YYYY') + '</div></div></div>' : '';
    return '<div class="title-block"><div class="bar"></div><div><div class="eyebrow">' + esc(doc.eyebrow) + '</div><div class="title">' + esc(doc.title) + '</div><div class="subtitle">' + esc(doc.subtitle) + '</div></div></div><div class="gold-dash"></div>' +
      meta + '<p class="intro">' + nl(doc.intro) + '</p><p class="note">' + nl(doc.note) + '</p>';
  }
  function feeContTop(doc) {
    return '<div class="cont-line"><span class="eyebrow">' + esc(doc.eyebrow) + '</span><span class="cont-title">' + esc(doc.title) + ' · continued' + (doc.clientFields && doc.preparedFor ? ' · ' + esc(doc.preparedFor) : '') + '</span></div>';
  }

  // Returns an array of sheet HTML strings.
  function feeSheets(doc) {
    const left = 'Private &amp; Confidential' + (doc.clientFields && doc.preparedFor ? ' · Prepared for ' + esc(doc.preparedFor) : '');
    // Header and top block are measured together so their stacking matches the real page exactly.
    const hdrH = measure(header()).height;
    const footH = measure(footer(left + pageNo(1, 2)), true).height;
    const topH = measure(header() + feeTop(doc)).height;
    const contTopH = measure(header() + feeContTop(doc)).height;
    const availFirst = PAGE_H - BODY_PAD - topH - footH;
    const availCont = PAGE_H - BODY_PAD - contTopH - footH;
    const pages = packBlocks((doc.blocks || []).map(b => ({ block: b })), availFirst, availCont);
    lastPack = { availFirst, availCont, hdrH, topH, contTopH, footH, pages: pages.map(p => p.map(i => Math.round(i.height))) };
    const n = pages.length;
    return pages.map((items, i) => '<div class="sheet" data-sheet="fee" data-page="' + (i + 1) + '">' + watermark() + '<div class="body">' + header() +
      (i === 0 ? feeTop(doc) : feeContTop(doc)) + items.map(it => '<div class="blk">' + it.html + '</div>').join('') + '</div>' +
      footer(left + pageNo(i + 1, n)) + '</div>');
  }

  // ---------- Welcome pack ----------
  function currencyList(accounts) {
    const c = accounts.map(a => a.currency).filter((x, i, arr) => x && arr.indexOf(x) === i); // unique, in order
    if (!c.length) return '';
    if (c.length === 1) return c[0];
    return c.slice(0, -1).join(', ') + ' and ' + c[c.length - 1];
  }

  function wpFooter(doc, pg) {
    const right = '<div class="ref-line">' + esc(doc.date || '') + (doc.cfsRef ? ' · ' + esc(doc.cfsRef) : '') + (doc.packRef ? '<br>' + esc(doc.packRef) : '') + '</div>';
    return footer('Private &amp; Confidential' + (pg || ''), right);
  }

  // ---------- funding field values (shared by the PDF sheets and the Word pack) ----------
  // One rule for every funding field, in one place, because the two outputs must say the same thing:
  // a field confirmed N/A prints "Not applicable" and its stored value is NEVER shown. Before v0.6.0 the
  // PDF printed the stale beneficiary bank and the DOCX printed the stale bank address after they had
  // been confirmed N/A — the exact class of wrong funding detail this tool exists to prevent.
  const NA_TEXT = 'Not applicable';
  function fieldValue(a, f) {
    if (a && a.na && a.na[f]) return { na: true, empty: false, text: NA_TEXT };
    const v = (a && a[f] != null ? String(a[f]) : '').trim();
    return { na: false, empty: !v, text: v };
  }
  // The correspondent SWIFT and account share one line in both outputs; when both are N/A the line
  // collapses to a single "Not applicable" instead of repeating it.
  function corrLine(a) {
    const s = fieldValue(a, 'corrSwift'), c = fieldValue(a, 'corrAccount');
    if (s.na && c.na) return { collapsed: true, text: NA_TEXT };
    return { collapsed: false, text: (s.text || '—') + ' · ' + (c.text || '—') };
  }

  function fundingBlock(a) {
    const v = (f, cls) => {
      const fv = fieldValue(a, f);
      if (fv.na) return '<div class="v na">' + esc(fv.text) + '</div>';
      return '<div class="v' + (cls ? ' ' + cls : '') + '">' + (fv.empty ? '<span class="placeholder">—</span>' : esc(fv.text)) + '</div>';
    };
    const addr = fieldValue(a, 'bankAddress');
    return '<div class="funding"><div class="f-h"><span class="cur">' + esc(a.currency || '???') + ' ACCOUNT</span><span class="cur-sub">Use with ' + esc(a.currency || '') + ' payments only</span></div><div class="f-rows">' +
      '<div class="full"><div class="k">Beneficiary name</div>' + v('beneficiaryName') + '</div>' +
      '<div><div class="k">Beneficiary account number</div>' + v('accountNo', 'mono') + '</div>' +
      '<div><div class="k">IBAN</div>' + v('iban', 'mono') + '</div>' +
      '<div><div class="k">Beneficiary bank</div>' + (fieldValue(a, 'bank').na ? '<div class="v na">' + esc(NA_TEXT) + '</div>' :
        '<div class="v">' + (fieldValue(a, 'bank').empty ? '<span class="placeholder">—</span>' : esc(fieldValue(a, 'bank').text)) + (addr.na || addr.empty ? '' : '<small>' + esc(addr.text) + '</small>') + '</div>') + '</div>' +
      '<div><div class="k">Beneficiary bank SWIFT / BIC</div>' + v('bankSwift', 'mono') + '</div>' +
      '<div><div class="k">Correspondent bank</div>' + v('corrBank') + '</div>' +
      '<div><div class="k">Correspondent SWIFT / BIC · account</div>' + (corrLine(a).collapsed ? '<div class="v na">' + esc(corrLine(a).text) + '</div>' :
        '<div class="v mono">' + esc(corrLine(a).text) + '</div>') + '</div>' +
      '</div></div>';
  }

  // The T&C line is derived from the attachment state; it can never claim "enclosed" without a file.
  // target: 'pdf' (the pack that actually carries the appended T&C pages) or 'docx'.
  // The Word pack never embeds the T&C PDF, so it always uses the "provided separately" wording —
  // a Word document must not claim something is enclosed that is not in the file.
  function tcLine(doc, ctx, target) {
    const attached = target !== 'docx' && doc.includeTc && ctx && ctx.tcPages && ctx.tcPages.length;
    return attached ? doc.tcLineEnclosed : doc.tcLineSeparate;
  }

  function welcomeSheets(doc, ctx) {
    // ctx: { clientDoc, feeDoc (restored from a DOCX upload), feePages: [dataURL], tcPages: [dataURL] }
    ctx = ctx || {};
    const sheets = [];
    const name = doc.clientName;
    const cl = currencyList(doc.accounts);
    const curLine = doc.coverCurrencyLine.replace('{currencies}', cl || '—');
    const open = (cls) => '<div class="sheet' + (cls ? ' ' + cls : '') + '" data-sheet="wp">' + watermark() + '<div class="body">' + header();
    const close = (pg) => '</div>' + wpFooter(doc, pg) + '</div>';

    // Cover
    sheets.push(open() + '<div class="cover-title">' + esc(doc.coverTitle) + '</div><div class="cover-client">' + ph(name, 'Client legal name') + '</div>' +
      '<div class="cover-ready">' + esc(doc.readyLine) + '</div><p class="cover-text">' + nl(doc.coverText) + '</p><p class="cover-text">' + esc(curLine) + '</p><p class="cover-text">' + nl(doc.coverClose) + '</p>' + close());

    // Funding pages: height-packed, whole blocks only
    const accts = doc.accounts.length ? doc.accounts : [D.account({ currency: '' })];
    const hdrH = 0, footH = measure(wpFooter(doc), true).height;
    const introH = measure(header() + '<div class="page-title">' + esc(doc.fundingTitle) + '</div><p class="intro">' + nl(doc.fundingIntro) + '</p>').height;
    const contH = measure(header() + '<div class="page-title">' + esc(doc.fundingTitle) + ' (continued)</div>').height;
    const calloutH = measure('<div class="callout"><b>!</b><span>' + nl(doc.fundingNote) + '</span></div>').height;
    const blocks = accts.map(a => ({ block: { type: 'text', text: '' }, custom: fundingBlock(a) }));
    // pack manually (not via BLOCKS): whole funding blocks, callout reserved on the last page
    // The callout is reserved on every page so it can never end up alone on a continuation page.
    const pages = [[]]; let remaining = PAGE_H - BODY_PAD - hdrH - introH - footH - calloutH - SAFETY;
    for (const b of blocks) {
      const h = measure('<div class="blk">' + b.custom + '</div>').height;
      if (h > remaining && pages[pages.length - 1].length) { pages.push([]); remaining = PAGE_H - BODY_PAD - hdrH - contH - footH - calloutH - SAFETY; }
      pages[pages.length - 1].push(b.custom); remaining -= h;
    }
    pages.forEach((items, i) => {
      sheets.push(open() + '<div class="page-title">' + esc(doc.fundingTitle) + (i > 0 ? ' <span class="cont">(continued)</span>' : '') + '</div>' +
        (i === 0 ? '<p class="intro">' + nl(doc.fundingIntro) + '</p>' : '') + items.map(x => '<div class="blk">' + x + '</div>').join('') +
        (i === pages.length - 1 ? '<div class="callout"><b>!</b><span>' + nl(doc.fundingNote) + '</span></div>' : '') + close());
    });

    // Getting started
    const tc = tcLine(doc, ctx, 'pdf');
    sheets.push(open() + '<div class="page-title">' + esc(doc.stepsTitle) + '</div>' + doc.steps.map((s, i) => {
      const isCare = /assist|care|contact/i.test(s.title) && i === doc.steps.length - 1;
      const lines = (s.body || '').split('\n');
      const body = isCare ? '<div class="care"><div class="k">' + esc(lines[0]) + '</div><div class="v">' + esc(lines.slice(1).join('\n')) + '</div></div>' : '<div class="b">' + esc(s.body) + '</div>';
      return '<div class="step"><div class="n">' + String(i + 1).padStart(2, '0') + '</div><div><div class="t">' + esc(s.title) + '</div>' + body + '</div></div>';
    }).join('') +
      '<div class="governs"><div class="k">' + esc(doc.governsTitle) + '</div>' + doc.governs.filter(g => g.trim()).map(g => '<p>' + esc(g) + '</p>').join('') + (tc ? '<p class="tc">' + esc(tc) + '</p>' : '') + '</div>' + close());

    // Client Fee Schedule
    const feeDoc = doc.feeSource === 'current' ? ctx.clientDoc : (doc.feeSource === 'upload' ? ctx.feeDoc : null);
    if (feeDoc) feeSheets(feeDoc).forEach(s => sheets.push(s));
    else if (doc.feeSource === 'upload' && ctx.feePages) ctx.feePages.forEach(p => sheets.push('<div class="sheet image-page" data-sheet="img"><img src="' + p + '" alt="Client Fee Schedule page"></div>'));

    // Terms & Conditions
    if (doc.includeTc && ctx.tcPages) ctx.tcPages.forEach(p => sheets.push('<div class="sheet image-page" data-sheet="img"><img src="' + p + '" alt="Terms and Conditions page"></div>'));
    return sheets;
  }

  window.ARIE_RENDER = { fieldValue, corrLine, NA_TEXT, fundingBlock, lastPack: () => lastPack, feeSheets, welcomeSheets, currencyList, tcLine, esc, splitUnit, PAGE_H };
})();
