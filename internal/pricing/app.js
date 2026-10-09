// ARIE Document Builder — application shell: state, controls, desk, preflight, exports.
//
// The app is disposable by design: state lives in sessionStorage (reload/crash recovery for this tab only)
// and "Start New Client" wipes everything. Uploaded PDFs/DOCX are held in memory and never stored.
(function () {
  'use strict';
  const D = window.ARIE_DEFAULTS, R = window.ARIE_RENDER, W = window.ARIE_WIRING, X = window.ARIE_EXPORT, IO = window.ARIE_DOCXIO;
  const esc = R.esc;
  // Per-brand sessionStorage so switching entity does NOT destroy the other brand's in-progress work.
  // Each brand keeps its own state (and its own 'files' snapshot is reset in memory on switch because
  // uploaded PDFs are never persisted anyway — same as before).
  const STORE_KEY = (brandId) => 'arie_docbuilder_session_v2_' + (brandId || D.activeBrand);
  const MODE_NAMES = { indicative: 'Indicative Fee Schedule', client: 'Client Fee Schedule', welcome: 'Welcome Pack' };

  // ---------- State ----------
  const todayStr = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  // A fresh state only includes modes the active brand supports. Date fields default to today.
  function freshState() {
    const modes = D.brand().modes;
    const docs = {};
    if (modes.indexOf('indicative') >= 0) docs.indicative = D.indicative();
    if (modes.indexOf('client') >= 0) { docs.client = D.client(); docs.client.date = todayStr(); }
    if (modes.indexOf('welcome') >= 0 && D.welcome()) { docs.welcome = D.welcome(); docs.welcome.date = todayStr(); }
    const mode = modes[0] || 'indicative';
    return { mode, docs };
  }
  let state = freshState();
  // Memory only, never persisted: uploaded files and their derived data. These do NOT survive a
  // brand switch — same guarantee the tool has always had across page reloads.
  //   fee:    { name, kind:'pdf'|'docx', buf, pages?:[dataURL], meta?:{name,reference,date}, feeDoc?:state }
  //   tc:     { name, buf, pages }
  //   wiring: { [accountId]: { name, buf } }
  let files = { fee: null, tc: null, wiring: {} };
  let openAccount = null;

  // Temporary session recovery is stamped with a schema version. State written by an older build is
  // discarded rather than migrated: it is a few minutes of unsaved work, never the record of anything.
  // State is keyed per brand, so loading never touches another brand's record.
  function load() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(STORE_KEY()) || 'null');
      if (raw && raw.schemaVersion === D.SCHEMA_VERSION && raw.state && raw.state.docs) {
        // Guard: a stored mode the current brand does not support (shouldn't happen, but a safety net)
        // falls back to the brand's first mode.
        const modes = D.brand().modes;
        if (modes.indexOf(raw.state.mode) < 0) raw.state.mode = modes[0] || 'indicative';
        state = raw.state; return;
      }
      if (raw) sessionStorage.removeItem(STORE_KEY());
    } catch (e) { /* storage unavailable: run from defaults */ }
  }
  function persist() { try { sessionStorage.setItem(STORE_KEY(), JSON.stringify({ schemaVersion: D.SCHEMA_VERSION, appVersion: D.VERSION, brand: D.activeBrand, state })); } catch (e) { /* ignore */ } }

  // Switches the active entity. Each brand owns its own sessionStorage slot, so switching to the other
  // entity restores whatever work was in progress for that brand and leaves this brand's work untouched.
  // In-memory uploads (wiring PDFs, attached T&C, attached fee schedule) are dropped on switch, same as
  // on reload — they are not persisted and must be re-attached. The access gate / session cookie is
  // unaffected (brand selection is a UI choice, not an authentication boundary).
  function switchBrand(brandId) {
    if (!D.BRANDS[brandId] || brandId === D.activeBrand) return;
    persist();                       // save current brand's work to its slot
    D.setBrand(brandId);
    files = { fee: null, tc: null, wiring: {} };
    openAccount = null;
    state = freshState();            // seed defaults for the new brand before load() restores if present
    load();
    renderAll();
    toast('Switched to ' + D.brand().label + '.', 'info');
  }

  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  function setPath(obj, path, value) {
    const ks = path.split('.'); let o = obj;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = value;
  }
  const doc = () => state.docs[state.mode];
  const w = () => state.docs.welcome;

  // ---------- Coherence ----------
  // Unicode-aware: accents are folded (SOCIÉTÉ === SOCIETE), curly quotes normalised, every other
  // letter or digit preserved in any script; case, punctuation and repeated whitespace ignored.
  const normName = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // "ARIE FINANCE LTD (CLIENT ACCOUNT -EXAMPLE CO LTD)" -> "EXAMPLE CO LTD"
  // Nested parentheses in the client name ("… (MAURITIUS) LIMITED)") are kept; only the wrapper's closing bracket is dropped.
  function clientFromBeneficiary(b) {
    const m = String(b || '').match(/CLIENT\s*ACCOUNT\s*[-–:]?\s*(.+)$/i);
    if (!m) return normName(b);
    let rest = m[1].trim();
    const opens = (rest.match(/\(/g) || []).length, closes = (rest.match(/\)/g) || []).length;
    if (closes > opens && rest.endsWith(')')) rest = rest.slice(0, -1);
    return normName(rest);
  }
  // Exact identity after normalisation (case, whitespace, punctuation). No substring matching:
  // "ABC LTD" must not pass as "ABC LTD HOLDINGS". Genuine differences need the explicit override.
  const sameClient = (a, b) => { a = normName(a); b = normName(b); return !!a && !!b && a === b; };

  // Returns [{ level:'error'|'warn', msg }] describing cross-document mismatches for the Welcome Pack.
  // A mismatch is an error unless staff have explicitly confirmed exactly this set of differences
  // (mismatchAck holds the confirmed message list; any change to the names invalidates it).
  function coherence() {
    const raw = coherenceRaw();
    const key = raw.map(i => i.msg).join('\n');
    if (raw.length && w().mismatchAck === key) return raw.map(i => ({ level: 'warn', msg: i.msg + ' (confirmed as intentional)' }));
    return raw;
  }
  function coherenceRaw() {
    const d = w(), issues = [];
    if (!d.clientName.trim()) return issues; // reported by preflight as a missing field
    if (d.feeSource === 'current') {
      const c = state.docs.client;
      if (c.preparedFor.trim() && !sameClient(c.preparedFor, d.clientName)) issues.push({ level: 'error', msg: 'The current Client Fee Schedule is prepared for "' + c.preparedFor + '" but this pack is for "' + d.clientName + '".' });
      if (c.reference.trim() && d.cfsRef.trim() && normName(c.reference) !== normName(d.cfsRef)) issues.push({ level: 'error', msg: 'Fee schedule reference differs: pack says "' + d.cfsRef + '", the Client Fee Schedule says "' + c.reference + '".' });
    } else if (d.feeSource === 'upload' && files.fee) {
      const m = files.fee.meta || {};
      if (m.name && !sameClient(m.name, d.clientName)) issues.push({ level: 'error', msg: 'The attached fee schedule (' + files.fee.name + ') is prepared for "' + m.name + '" but this pack is for "' + d.clientName + '".' });
      if (m.reference && d.cfsRef.trim() && normName(m.reference) !== normName(d.cfsRef)) issues.push({ level: 'error', msg: 'Fee schedule reference differs: pack says "' + d.cfsRef + '", the attached schedule says "' + m.reference + '".' });
    }
    d.accounts.forEach(a => {
      if (!a.beneficiaryName || (a.na && a.na.beneficiaryName)) return;
      const who = clientFromBeneficiary(a.beneficiaryName);
      if (who && !sameClient(who, d.clientName)) issues.push({ level: 'error', msg: (a.currency || 'A') + ' funding account belongs to "' + who + '" (beneficiary: ' + a.beneficiaryName + '), not to "' + d.clientName + '".' });
    });
    return issues;
  }

  function attachmentIssues() {
    const d = w(), issues = [];
    if (d.feeSource === 'upload' && !files.fee) issues.push({ level: 'error', msg: 'Re-attach required: the Client Fee Schedule file is no longer attached (attachments are not kept across reloads).' });
    if (d.includeTc && !files.tc) issues.push({ level: 'error', msg: 'Re-attach required: the Terms & Conditions PDF is no longer attached.' });
    // tcLineSeparate is printed whenever the T&C are not physically in the file — always in Word, and in
    // the PDF when nothing is attached — so it must never claim they are enclosed.
    if (/enclos/i.test(d.tcLineSeparate)) issues.push({ level: 'error', msg: 'The "provided separately" Terms & Conditions wording claims they are enclosed. That wording is printed whenever the T&C are not in the file (always in the Word pack), so it must not say "enclosed".' });
    return issues;
  }

  // ---------- Preflight (shared by PDF and Word) ----------
  // Errors and warnings for one fee-schedule document — the current Client tab, the Indicative tab, or a
  // schedule reconstructed from an attached .docx. The Welcome Pack reuses it so that no check the
  // standalone export would run is skipped when the schedule is issued inside a pack.
  function feeDocIssues(d, clientFields) {
    const errors = [], warnings = [];
    if (clientFields) {
      if (!String(d.preparedFor || '').trim()) errors.push('Client legal name is required.');
      if (!String(d.reference || '').trim()) errors.push('Reference is required.');
      if (!String(d.date || '').trim()) errors.push('Issue date is required.');
      const mismatch = refBrandMismatch(d.reference);
      if (mismatch) errors.push(mismatch);
    }
    if (!Array.isArray(d.blocks) || !d.blocks.length) errors.push('The document has no sections.');
    (d.blocks || []).forEach(b => {
      if (b.type === 'feeGrid' && !(b.profiles || []).some(p => p && p.fees && p.fees.length)) warnings.push('Section "' + b.title + '" has no fees and will print a placeholder.');
      if (b.type === 'table' && !(b.rows || []).length) warnings.push('Table "' + b.title + '" has no rows.');
    });
    return { errors, warnings };
  }

  function preflight(mode) {
    const errors = [], warnings = [];
    const d = state.docs[mode];
    if (mode === 'indicative' || mode === 'client') {
      const r = feeDocIssues(d, mode === 'client');
      r.errors.forEach(e => errors.push(e)); r.warnings.forEach(x => warnings.push(x));
    }
    if (mode === 'welcome') {
      if (!d.clientName.trim()) errors.push('Client legal name is required.');
      if (!d.accounts.length) errors.push('At least one funding account is required.');
      const cfsMismatch = refBrandMismatch(d.cfsRef);
      if (cfsMismatch) errors.push('Fee schedule reference: ' + cfsMismatch);
      if (d.feeSource === 'current') {
        const r = feeDocIssues(state.docs.client, true);
        r.errors.forEach(e => errors.push('Current Client Fee Schedule: ' + e));
        r.warnings.forEach(x => warnings.push('Current Client Fee Schedule: ' + x));
      }
      if (d.feeSource === 'upload' && files.fee && files.fee.kind === 'docx' && files.fee.feeDoc) {
        const r = feeDocIssues(files.fee.feeDoc, true);
        r.errors.forEach(e => errors.push('Attached Client Fee Schedule: ' + e));
        r.warnings.forEach(x => warnings.push('Attached Client Fee Schedule: ' + x));
      }
      if (d.feeSource === 'none') warnings.push('The Welcome Pack will be generated without a Client Fee Schedule (exception).');
      if (d.feeSource === 'upload' && files.fee && files.fee.kind === 'pdf') {
        warnings.push('The attached fee schedule is a PDF: it is appended to the PDF pack, but the Word pack will only reference it (attach the .docx exported by this tool for an editable schedule in Word).');
        const m = files.fee.meta || {};
        if (!m.name || !m.reference) warnings.push('The client name and/or reference could not be verified from this Fee Schedule (' + files.fee.name + '). Confirm that the correct document is attached.');
      }
      attachmentIssues().forEach(i => (i.level === 'error' ? errors : warnings).push(i.msg));
      coherence().forEach(i => (i.level === 'error' ? errors : warnings).push(i.msg));
      d.accounts.forEach((a, i) => {
        const c = a.checks || {};
        Object.keys(c).forEach(f => {
          if (c[f].level === 'error') errors.push((a.currency || 'Account ' + (i + 1)) + ': ' + (W.FIELD_LABELS[f] || f) + ' — ' + c[f].msg);
          else if (c[f].level === 'warn') warnings.push((a.currency || 'Account ' + (i + 1)) + ': ' + (f === '_duplicate' || f === '_format' ? '' : (W.FIELD_LABELS[f] || f) + ' — ') + c[f].msg);
        });
      });
    }
    if (mode === state.mode) {
      const over = document.querySelectorAll('#desk .sheet.overflow').length;
      if (over) errors.push(over + ' page(s) do not fit A4 (outlined in red): ' +
        [overflowInfo.tall ? overflowInfo.tall + ' too tall' : '', overflowInfo.wide ? overflowInfo.wide + ' too wide' : ''].filter(Boolean).join(' and ') +
        '. Shorten text, remove rows, or remove a column.');
    }
    return { errors, warnings };
  }

  // ---------- Modal ----------
  function showModal(o) {
    closeModal();
    const bg = document.createElement('div'); bg.className = 'modal-bg no-print'; bg.id = 'modal';
    const list = (arr, cls) => arr.length ? '<ul>' + arr.map(x => '<li class="' + cls + '">' + esc(x) + '</li>').join('') + '</ul>' : '';
    bg.innerHTML = '<div class="modal" role="dialog"><div class="m-h">' + esc(o.title) + '</div><div class="m-b">' + (o.text ? '<p>' + o.text + '</p>' : '') +
      (o.errors && o.errors.length ? '<p><b>Must be fixed before export:</b></p>' + list(o.errors, 'error') : '') +
      (o.warnings && o.warnings.length ? '<p><b>Please confirm:</b></p>' + list(o.warnings, 'warn') : '') + '</div><div class="m-f">' +
      (o.onContinue ? '<button data-m="cancel">Cancel</button><button class="primary" data-m="continue">' + esc(o.continueLabel || 'Continue') + '</button>' : '<button class="primary" data-m="cancel">Close</button>') + '</div></div>';
    bg.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; const act = b.dataset.m; closeModal(); if (act === 'continue' && o.onContinue) o.onContinue(); });
    document.body.appendChild(bg);
  }
  function closeModal() { const m = document.getElementById('modal'); if (m) m.remove(); }

  // Runs preflight; calls go() when clean or after the user confirms warnings.
  function guardedExport(go) {
    const { errors, warnings } = preflight(state.mode);
    if (!errors.length && !warnings.length) return go();
    showModal({ title: errors.length ? 'Cannot export yet' : 'Check before exporting', errors, warnings, onContinue: errors.length ? null : go, continueLabel: 'Export anyway' });
  }

  // ---------- Desk ----------
  let deskTimer = null;
  function renderDesk() {
    const desk = document.getElementById('desk');
    let sheets;
    if (state.mode === 'welcome') sheets = R.welcomeSheets(w(), welcomeCtx());
    else sheets = R.feeSheets(doc());
    desk.innerHTML = sheets.join('');
    checkOverflow();
  }
  function welcomeCtx() {
    return { clientDoc: state.docs.client, feeDoc: files.fee && files.fee.feeDoc, feePages: files.fee && files.fee.pages, tcPages: files.tc && files.tc.pages, feeName: files.fee && files.fee.name };
  }
  function scheduleDesk() { clearTimeout(deskTimer); deskTimer = setTimeout(renderDesk, 60); }
  // A page can fail to fit in either direction: too tall (rows/text) or too wide (a section with more
  // columns than the sheet can carry). Both outline the page and block export.
  let overflowInfo = { tall: 0, wide: 0 };
  function checkOverflow() {
    overflowInfo = { tall: 0, wide: 0 };
    document.querySelectorAll('#desk .sheet:not(.image-page)').forEach(s => {
      // A section that overflows the sheet widens it; one that overflows a rounded container is
      // clipped there instead (overflow:hidden), so those containers are measured too — otherwise a
      // too-wide fee grid or table would be silently cut off in the PDF.
      const clipped = Array.from(s.querySelectorAll('.tiles, .profiles, .profile, table.grid, .funding, .blk'));
      const tall = s.scrollHeight > R.PAGE_H + 1;
      const wide = s.scrollWidth > s.clientWidth + 1 || clipped.some(el => el.scrollWidth > el.clientWidth + 1);
      s.classList.toggle('overflow', tall || wide);
      if (tall) overflowInfo.tall++; if (wide) overflowInfo.wide++;
    });
    const t = document.getElementById('overflow-toast');
    t.hidden = !(overflowInfo.tall || overflowInfo.wide);
    t.textContent = overflowInfo.wide
      ? 'Content is wider than the page (outlined in red) — remove a column or shorten its values. Export is blocked until this is fixed.'
      : 'A page exceeds A4 (outlined in red) — shorten text or remove rows. Export is blocked until this is fixed.';
  }

  // ---------- Controls ----------
  const inp = (path, val, ph, extra) => '<input class="in" id="f_' + path.replace(/\./g, '_') + '" data-path="' + path + '" value="' + esc(val) + '" placeholder="' + esc(ph || '') + '"' + (extra || '') + '>';
  const ta = (path, val, ph, h) => '<textarea class="in" id="f_' + path.replace(/\./g, '_') + '" data-path="' + path + '" placeholder="' + esc(ph || '') + '"' + (h ? ' style="min-height:' + h + 'px"' : '') + '>' + esc(val) + '</textarea>';
  const taLines = (path, arr, ph, h) => '<textarea class="in" id="f_' + path.replace(/\./g, '_') + '" data-path="' + path + '" data-lines="1" placeholder="' + esc(ph || '') + '"' + (h ? ' style="min-height:' + h + 'px"' : '') + '>' + esc((arr || []).join('\n')) + '</textarea>';
  const fld = (labelText, control) => '<div class="field">' + (labelText ? '<label>' + esc(labelText) + '</label>' : '') + control + '</div>';
  const secH = (t, tools) => '<div class="section-h"><span>' + esc(t) + '</span>' + (tools ? '<span class="tools">' + tools + '</span>' : '') + '</div>';
  const blockTools = (i, n) => '<button data-act="moveBlock" data-i="' + i + '" data-d="-1" title="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button><button data-act="moveBlock" data-i="' + i + '" data-d="1" title="Move down"' + (i === n - 1 ? ' disabled' : '') + '>↓</button><button class="rm" data-act="removeBlock" data-i="' + i + '" title="Remove section">✕</button>';
  const notice = (level, html) => '<div class="notice ' + level + '">' + html + '</div>';

  const BLOCK_EDITORS = {
    feeGrid(b, p) {
      let h = fld('Section title', inp(p + '.title', b.title));
      b.profiles.forEach((pr, pi) => {
        h += '<div class="card"><div class="card-h"><span>' + (b.profiles.length > 1 ? 'Profile ' + (pi + 1) : 'Fees') + '</span>' + (b.profiles.length > 1 ? '<button class="link-btn" data-act="removeProfile" data-i="' + p + '" data-pi="' + pi + '">Remove profile</button>' : '') + '</div>';
        if (b.profiles.length > 1) h += fld('Profile label', inp(p + '.profiles.' + pi + '.label', pr.label, 'e.g. Standard Profile'));
        pr.fees.forEach((f, fi) => {
          h += '<div class="row" style="margin-bottom:6px">' + inp(p + '.profiles.' + pi + '.fees.' + fi + '.label', f.label, 'Fee label') + inp(p + '.profiles.' + pi + '.fees.' + fi + '.value', f.value, 'e.g. USD 150 / month') + (pr.fees.length > 1 ? '<button class="link-btn" style="flex:0 0 auto" data-act="removeFee" data-i="' + p + '" data-pi="' + pi + '" data-fi="' + fi + '" title="Remove fee">×</button>' : '') + '</div>';
        });
        h += '<button class="add-btn" style="margin:4px 0 0" data-act="addFee" data-i="' + p + '" data-pi="' + pi + '">+ Add fee</button></div>';
      });
      h += '<button class="add-btn" data-act="addProfile" data-i="' + p + '">+ Add profile column</button>';
      return h + '<p class="hint">Write a unit after " / " to show it under the amount, e.g. "USD 40 / payment". A section keeps at least one fee; remove the section instead.</p>';
    },
    table(b, p) {
      let h = fld('Section title', inp(p + '.title', b.title));
      h += '<div class="card"><div class="card-h"><span>Columns</span><button class="link-btn quiet" data-act="addCol" data-i="' + p + '">+ Column</button></div><div class="row">' +
        b.columns.map((c, ci) => '<div style="display:flex;gap:4px">' + inp(p + '.columns.' + ci, c, 'Column') + (b.columns.length > 1 ? '<button class="link-btn" data-act="removeCol" data-i="' + p + '" data-ci="' + ci + '">×</button>' : '') + '</div>').join('') + '</div></div>';
      b.rows.forEach((r, ri) => {
        h += '<div class="card"><div class="card-h"><span>Row ' + (ri + 1) + '</span>' + (b.rows.length > 1 ? '<button class="link-btn" data-act="removeRow" data-i="' + p + '" data-ri="' + ri + '">Remove</button>' : '') + '</div>' +
          b.columns.map((c, ci) => '<div class="field">' + ta(p + '.rows.' + ri + '.' + ci, r[ci] || '', c + (ci > 0 ? ' (new line = smaller second line)' : ''), 44) + '</div>').join('') + '</div>';
      });
      h += '<button class="add-btn" data-act="addRow" data-i="' + p + '">+ Add row</button>';
      h += fld('Supporting note', ta(p + '.note', b.note || '', 'Optional note under the table', 60));
      return h;
    },
    feeList(b, p) {
      let h = fld('Section title', inp(p + '.title', b.title));
      b.rows.forEach((r, ri) => { h += '<div class="row" style="margin-bottom:6px">' + inp(p + '.rows.' + ri + '.label', r.label, 'Label') + inp(p + '.rows.' + ri + '.fee', r.fee, 'Fee', ' style="max-width:120px"') + (b.rows.length > 1 ? '<button class="link-btn" style="flex:0 0 auto" data-act="removeRow" data-i="' + p + '" data-ri="' + ri + '">×</button>' : '') + '</div>'; });
      return h + '<button class="add-btn" data-act="addRow" data-i="' + p + '">+ Add fee</button>';
    },
    bullets(b, p) { return fld('Section title', inp(p + '.title', b.title)) + fld('Items (one per line)', taLines(p + '.items', b.items, 'One condition per line', 120)); },
    text(b, p) { return fld('Section title (optional)', inp(p + '.title', b.title || '')) + fld('Text', ta(p + '.text', b.text, 'Bespoke wording', 100)); }
  };

  function feeControls(d, key) {
    const p = 'docs.' + key;
    let h = secH('Document');
    // ACBM has a single document mode. The user may want to export it either as a Client Fee
    // Schedule (with Prepared For / Reference / Issue Date) or as an Indicative Fee Schedule
    // (no client-specific details). This toggle flips d.clientFields; when turned off, the
    // meta row and the Generate Reference button disappear and preflight stops requiring those
    // fields. ARIE already has separate 'indicative' and 'client' modes so the toggle isn't
    // exposed there.
    if (D.activeBrand === 'acbm' && key === 'client') {
      h += '<label class="check" style="margin:4px 0 12px"><input type="checkbox" data-act="toggleClientFields"' + (d.clientFields ? ' checked' : '') + '> Client-specific document (show Prepared For / Reference / Issue Date). Uncheck to generate an Indicative Fee Schedule without client details.</label>';
    }
    if (d.clientFields) {
      h += notice('error', 'Client legal name, reference and issue date are required before export.');
      // Auto-allocation is wired for both ARIE and ACBM Client Fee Schedules — one shared
      // sequential counter spans both entities, the brand only decides the prefix (ARIE-FS /
      // ACBM-FS). Server picks the next number from the pool regardless of entity.
      const canAutoAllocate = (D.activeBrand === 'arie' || D.activeBrand === 'acbm') && state.mode === 'client';
      // Lock-on-allocation: an auto-allocated reference (allocationKey present + reference set)
      // locks BOTH the reference and the client legal name. This prevents the register entry
      // ending up associated with a different client than the document carries. To work on a new
      // client, staff click Start New Client. Historical / manually-typed references (no
      // allocationKey) stay fully editable so legacy ARIE documents are unaffected.
      const locked = canAutoAllocate && !!d.allocationKey && !!d.reference;
      const nameInput = locked
        ? '<input class="in locked" id="f_' + (p + '.preparedFor').replace(/\./g, '_') + '" value="' + esc(d.preparedFor) + '" readonly aria-readonly="true" title="Locked to the allocated reference. Click Start New Client to change.">'
        : inp(p + '.preparedFor', d.preparedFor, 'Client legal name (required)');
      h += fld('Client legal name', nameInput);
      // Brand-aware placeholder — ARIE docs use ARIE-FS-…, ACBM docs use ACBM-FS-….
      const refPlaceholder = 'e.g. ' + D.brand().filenamePrefix + '-FS-2026-XXX';
      // Live cross-brand reference warning: if staff type a reference whose prefix belongs to
      // another brand, flag it immediately. Preflight also blocks export on the same condition.
      const refMismatch = refBrandMismatch(d.reference);
      if (canAutoAllocate) {
        const genLabel = locked ? 'Allocated' : 'Generate Reference';
        const genTitle = locked ? 'Locked to this client. Click Start New Client to allocate a reference for a different client.' : 'Allocate the next official reference from the shared register.';
        const genDisabled = locked || !!d.reference ? ' disabled title="' + esc(genTitle) + '"' : '';
        const refInput = locked
          ? '<input class="in locked" id="f_' + (p + '.reference').replace(/\./g, '_') + '" value="' + esc(d.reference) + '" readonly aria-readonly="true" title="' + esc(genTitle) + '">'
          : inp(p + '.reference', d.reference, locked ? refPlaceholder : 'Click Generate to allocate');
        h += '<div class="row">' +
          '<div class="field"><label>Reference</label><div style="display:flex;gap:6px">' +
            refInput +
            '<button type="button" class="link-btn gen-ref" data-act="generateRef"' + genDisabled + '>' + genLabel + '</button>' +
          '</div></div>' +
          fld('Issue date', inp(p + '.date', d.date, 'DD Month YYYY')) +
          '</div>';
        if (refMismatch) h += notice('error', refMismatch);
        if (locked) {
          h += '<p class="hint"><b>Reference and client name are locked</b> to <code>' + esc(d.reference) + '</code> &middot; ' + esc(d.preparedFor) + '. To allocate a reference for a different client, click <b>Start New Client</b>.</p>';
        } else {
          h += '<p class="hint">Click Generate Reference to allocate the next official number from the shared register. Once allocated the reference and client name become locked to each other and are preserved across edits, re-exports and reloads.</p>';
        }
      } else {
        h += '<div class="row">' + fld('Reference', inp(p + '.reference', d.reference, refPlaceholder)) + fld('Issue date', inp(p + '.date', d.date, 'DD Month YYYY')) + '</div>';
        if (refMismatch) h += notice('error', refMismatch);
      }
    }
    h += '<div class="row">' + fld('Eyebrow', inp(p + '.eyebrow', d.eyebrow)) + fld('Title', inp(p + '.title', d.title)) + '</div>' + fld('Subtitle', inp(p + '.subtitle', d.subtitle)) +
      fld('Introduction', ta(p + '.intro', d.intro, '', 70)) + fld('Pricing note', ta(p + '.note', d.note, '', 80));
    d.blocks.forEach((b, i) => { h += secH(b.title || (b.type + ' section'), blockTools(i, d.blocks.length)) + BLOCK_EDITORS[b.type](b, p + '.blocks.' + i); });
    h += secH('Add a section') + '<div class="add-menu"><button data-act="addBlock" data-type="text">Text</button><button data-act="addBlock" data-type="bullets">Bullet list</button><button data-act="addBlock" data-type="table">Table</button><button data-act="addBlock" data-type="feeList">Fee list</button><button data-act="addBlock" data-type="feeGrid">Fee tiles</button></div>';
    return h;
  }

  function accountEditor(a, i) {
    const p = 'docs.welcome.accounts.' + i;
    const c = a.checks || {};
    const fieldRow = (f, mono) => {
      const ck = c[f] || { level: 'ok', msg: '' }; const isNa = a.na && a.na[f];
      return '<div class="fld"><div class="lbl"><span>' + esc(W.FIELD_LABELS[f]) + '</span><span class="msg ' + ck.level + '">' + esc(ck.msg) + '</span></div><div style="display:flex;align-items:center">' +
        '<input class="in ' + (isNa ? 'na' : ck.level) + '" id="f_' + (p + '.' + f).replace(/\./g, '_') + '" data-path="' + p + '.' + f + '" data-acct="1" value="' + esc(isNa ? 'Not applicable' : a[f]) + '"' + (isNa ? ' disabled' : '') + (mono ? ' style="font-family:ui-monospace,Menlo,monospace"' : '') + '>' +
        (W.OPTIONAL[f] || ck.level !== 'ok' || isNa ? '<button class="na-btn' + (isNa ? ' on' : '') + '" data-act="toggleNa" data-i="' + i + '" data-f="' + f + '" title="Confirm this field is not applicable">N/A</button>' : '') + '</div></div>';
    };
    const src = files.wiring[a.id];
    return '<div class="acct-edit">' +
      (c._duplicate ? notice('warn', esc(c._duplicate.msg)) : '') + (c._format ? notice('warn', esc(c._format.msg)) : '') +
      '<div class="fld"><div class="lbl"><span>Currency</span><span class="msg ' + ((c.currency || {}).level || 'ok') + '">' + esc((c.currency || {}).msg || '') + '</span></div>' + inp(p + '.currency', a.currency, 'USD', ' data-acct="1" style="max-width:100px;text-transform:uppercase"') + '</div>' +
      fieldRow('beneficiaryName') + fieldRow('accountNo', true) + fieldRow('iban', true) + fieldRow('bank') + fieldRow('bankAddress') + fieldRow('bankSwift', true) + fieldRow('corrBank') + fieldRow('corrSwift', true) + fieldRow('corrAccount', true) +
      (a.sourceName ? '<div style="display:flex;gap:10px;align-items:center;margin-top:6px">' + (src ? '<button class="na-btn" data-act="viewSource" data-id="' + a.id + '">View source PDF</button>' : '<span class="hint" style="margin:0">Source PDF not available after reload — re-drop the file to view it.</span>') + '<details style="flex:1"><summary>Extracted text</summary><div class="src-text">' + esc(a.sourceText) + '</div></details></div>' : '<p class="hint">Entered manually.</p>') +
      '<div style="display:flex;justify-content:space-between;margin-top:10px"><button class="link-btn quiet" data-act="moveAcct" data-i="' + i + '" data-d="-1">↑ Move up</button><button class="link-btn quiet" data-act="moveAcct" data-i="' + i + '" data-d="1">Move down ↓</button><button class="link-btn" data-act="removeAcct" data-i="' + i + '">Remove account</button></div></div>';
  }

  function welcomeControls(d) {
    const p = 'docs.welcome';
    let h = '';
    const att = attachmentIssues(), coh = coherence();
    const blocking = att.concat(coh.filter(i => i.level === 'error'));
    if (blocking.length) h += notice('error', '<b>Resolve before export</b><ul style="margin:6px 0 0;padding-left:16px">' + blocking.map(i => '<li>' + esc(i.msg) + '</li>').join('') + '</ul>' +
      (coh.some(i => i.level === 'error') ? '<label class="check" style="margin:10px 0 0"><input type="checkbox" data-act="ackMismatch"> Confirm this difference is intentional (recorded as a warning on export)</label>' : ''));
    else if (coh.length) h += notice('warn', '<b>Client-name difference confirmed as intentional</b><ul style="margin:6px 0 0;padding-left:16px">' + coh.map(i => '<li>' + esc(i.msg.replace(' (confirmed as intentional)', '')) + '</li>').join('') + '</ul><button class="link-btn quiet" data-act="unackMismatch">Withdraw confirmation</button>');
    h += secH('Client') + fld('Client legal name', inp(p + '.clientName', d.clientName, 'Client legal name')) +
      '<div class="row">' + fld('Fee schedule reference', inp(p + '.cfsRef', d.cfsRef, 'e.g. ARIE-FS-2026-XXX')) + fld('Welcome pack reference (optional)', inp(p + '.packRef', d.packRef, 'e.g. WP/…')) + '</div>' + fld('Pack date', inp(p + '.date', d.date, 'DD Month YYYY'));

    // Fee schedule source
    h += secH('Client Fee Schedule');
    const radio = (v, l) => '<label class="check"><input type="radio" name="feeSource" value="' + v + '"' + (d.feeSource === v ? ' checked' : '') + ' data-act="feeSource"> ' + l + '</label>';
    h += radio('current', 'Use current Client Fee Schedule (from the Client Fee Schedule tab)') + radio('upload', 'Attach Builder-generated Word (.docx) or final PDF') + radio('none', 'Do not include Client Fee Schedule — exception');
    if (d.feeSource === 'none') h += notice('warn', 'Exception: the pack will be generated without a Client Fee Schedule. Export asks for confirmation.');
    if (d.feeSource === 'current') {
      const c = state.docs.client;
      h += notice(c.preparedFor ? 'ok' : 'warn', (c.preparedFor ? 'Using the schedule prepared for <b>' + esc(c.preparedFor) + '</b> (' + esc(c.reference || 'no reference') + ', ' + esc(c.date || 'no date') + '). ' : 'The Client Fee Schedule tab has no client name yet. ') + '<button class="link-btn quiet" data-act="pullFromClient">Copy name / reference into this pack</button>');
    } else if (d.feeSource === 'upload') {
      h += '<div class="drop" data-drop="fee"><input type="file" accept=".pdf,.docx,application/pdf" data-file="fee"><span>' + (files.fee ? '<strong>' + esc(files.fee.name) + '</strong> · ' + (files.fee.kind === 'docx' ? 'unchanged Word export — schedule reconstructed natively in the PDF and Word packs' : files.fee.pages.length + ' page(s) · appended to the PDF pack; referenced in the Word pack') + '. Drop another to replace.' : 'Drop the final Client Fee Schedule here or <strong>click to choose</strong>') + '</span></div>';
      h += '<details class="help"><summary>How this works</summary><ul class="hint" style="padding-left:16px"><li><b>.docx generated by this tool, unchanged</b> → the schedule is rebuilt as editable content in both the PDF and the Word pack.</li><li><b>.docx generated by this tool but edited in Word afterwards</b> → detected and refused, so the amendments are not silently lost. Attach its final PDF instead.</li><li><b>Any other Word file</b> (written from scratch, or from another system) → not supported; it carries nothing this tool can rebuild. Attach its final PDF.</li><li><b>.pdf</b> → the exact pages go into the PDF pack; the Word pack references the file, because a PDF cannot become editable Word content.</li></ul></details>';
      if (files.fee && files.fee.kind === 'docx') h += notice('ok', 'The schedule text is unchanged and has been reconstructed. Word-only formatting, header or footer changes are not imported.');
      if (files.fee && files.fee.meta) {
        const m = files.fee.meta, verified = !!(m.name && m.reference);
        h += notice(verified ? 'ok' : 'warn', (verified ? 'Read from the file: ' : 'Could not verify client name and/or reference from this file. Read: ') + esc(m.name || '?') + ' · ' + esc(m.reference || '?') + ' · ' + esc(m.date || '?') + (verified ? ' <button class="link-btn quiet" data-act="pullFromUpload">Copy into this pack</button>' : ' — confirm the correct document is attached (asked again at export).'));
      }
    }

    // Wiring details
    h += secH('Wiring details') + '<div class="drop" data-drop="wiring"><input type="file" accept="application/pdf" multiple data-file="wiring"><span>Drop one or more wiring-detail PDFs here or <strong>click to choose</strong>. One funding block is created per file.</span></div>';
    if (d.accounts.length) {
      h += '<div class="acct-list">';
      d.accounts.forEach((a, i) => {
        const lvl = W.worstLevel(a.checks);
        h += '<div class="acct-row' + (openAccount === a.id ? ' open' : '') + '" data-act="openAcct" data-id="' + a.id + '"><span class="cur">' + esc(a.currency || '?') + '</span><span class="src">' + esc(a.sourceName || 'Manual entry') + '</span><span class="pill ' + lvl + '">' + (lvl === 'ok' ? '✓ ok' : lvl === 'warn' ? 'review' : 'attention') + '</span></div>';
        if (openAccount === a.id) h += accountEditor(a, i);
      });
      h += '</div>';
    }
    h += '<button class="add-btn" data-act="addAcct">+ Add funding account manually</button>';
    h += '<p class="hint">Missing or invalid-looking values are highlighted. Correct them or confirm N/A. Export runs a check first: missing critical fields, client mismatches and page overflow block it; the rest asks for confirmation.</p>';

    // Wording
    h += secH('Cover') + fld('Title', inp(p + '.coverTitle', d.coverTitle)) + fld('Status line', inp(p + '.readyLine', d.readyLine)) + fld('Opening text', ta(p + '.coverText', d.coverText, '', 56)) +
      fld('Currency line ({currencies} is filled automatically)', inp(p + '.coverCurrencyLine', d.coverCurrencyLine)) + fld('Closing text', ta(p + '.coverClose', d.coverClose, '', 56));
    h += secH('Funding page') + fld('Title', inp(p + '.fundingTitle', d.fundingTitle)) + fld('Introduction', ta(p + '.fundingIntro', d.fundingIntro, '', 56)) + fld('Callout', ta(p + '.fundingNote', d.fundingNote, '', 44));
    h += secH('Getting started') + fld('Title', inp(p + '.stepsTitle', d.stepsTitle));
    d.steps.forEach((s, i) => { h += '<div class="card"><div class="card-h"><span>Step ' + (i + 1) + '</span>' + (d.steps.length > 1 ? '<button class="link-btn" data-act="removeStep" data-i="' + i + '">Remove</button>' : '') + '</div>' + fld('', inp(p + '.steps.' + i + '.title', s.title, 'Step title')) + fld('', ta(p + '.steps.' + i + '.body', s.body, 'Step text', 70)) + '</div>'; });
    h += '<button class="add-btn" data-act="addStep">+ Add step</button>';
    h += fld('Reference block title', inp(p + '.governsTitle', d.governsTitle)) + fld('Reference lines (one per line)', taLines(p + '.governs', d.governs, '', 90));

    // T&C
    h += secH('Terms & Conditions') + '<label class="check"><input type="checkbox" data-act="includeTc"' + (d.includeTc ? ' checked' : '') + '> Append the Terms & Conditions PDF to the pack</label>';
    if (d.includeTc) h += '<div class="drop" data-drop="tc"><input type="file" accept="application/pdf" data-file="tc"><span>' + (files.tc ? '<strong>' + esc(files.tc.name) + '</strong> · ' + files.tc.pages.length + ' page(s)' : 'Drop the T&amp;C PDF here or <strong>click to choose</strong>') + '</span></div>';
    h += fld(d.includeTc ? 'Wording used (T&C attached)' : 'Wording used (T&C not attached)', inp(d.includeTc ? p + '.tcLineEnclosed' : p + '.tcLineSeparate', d.includeTc ? d.tcLineEnclosed : d.tcLineSeparate));
    h += '<p class="hint">The pack only says the Terms &amp; Conditions are enclosed when a T&amp;C PDF is actually attached; otherwise the second wording is printed.</p>';

    return h;
  }

  function renderControls() {
    const el = document.getElementById('pane');
    const d = doc();
    el.innerHTML = state.mode === 'welcome' ? welcomeControls(d) : feeControls(d, state.mode);
    renderBrandAndModes();
    document.getElementById('brand-sub').textContent = state.mode === 'welcome' ? 'Attach the fee schedule, drop the wiring PDFs, review, export.' : 'Edit any field, add or remove sections, then export.';
  }

  // Rebuilds the Entity segmented control and the Mode buttons from the active brand so switching
  // entities (or booting) always shows exactly the modes the brand supports.
  function renderBrandAndModes() {
    const brands = D.BRANDS;
    const brandBtns = Object.keys(brands).map(id => '<button type="button" data-brand="' + id + '" class="' + (id === D.activeBrand ? 'active' : '') + '">' + esc(brands[id].label) + '</button>').join('');
    const brandWrap = document.getElementById('entity-switch');
    if (brandWrap) brandWrap.innerHTML = brandBtns;
    const modes = D.brand().modes;
    const labels = (D.brand().modeLabels || {});
    const modeBtns = modes.map(m => '<button type="button" data-mode="' + m + '" class="' + (m === state.mode ? 'active' : '') + '">' + esc(labels[m] || MODE_NAMES[m] || m) + '</button>').join('');
    const modeWrap = document.querySelector('.modes');
    if (modeWrap) modeWrap.innerHTML = modeBtns;
  }

  function renderAll() { renderDesk(); renderControls(); persist(); }

  // ---------- Actions ----------
  function newBlock(type) {
    const t = { text: { type: 'text', title: 'Additional Terms', text: '' }, bullets: { type: 'bullets', title: 'Conditions', items: [''] },
      table: { type: 'table', title: 'Additional Charges', columns: ['Item', 'Fee'], rows: [['', '']], note: '' },
      feeList: { type: 'feeList', title: 'Other Fees', rows: [{ label: '', fee: '' }] },
      feeGrid: { type: 'feeGrid', title: 'Fees', profiles: [{ label: '', fees: [{ label: 'Fee', value: '' }] }] } }[type];
    return Object.assign({ id: D.uid() }, t);
  }
  const swap = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; };

  function markDuplicates() {
    const accts = w().accounts;
    accts.forEach((a, i) => {
      const key = (x) => [x.currency, (x.accountNo || '').replace(/\s/g, ''), (x.iban || '').replace(/\s/g, '')].join('|').toUpperCase();
      const dup = accts.findIndex((b, j) => j < i && key(b) === key(a) && (a.accountNo || a.iban));
      a.checks = W.validateAccount(a);
      if (dup >= 0) a.checks._duplicate = { level: 'warn', msg: 'Looks like a duplicate of account ' + (dup + 1) + ' (same currency, account number and IBAN). Remove one if it is.' };
    });
  }

  function startNewClient() {
    state = freshState();
    files = { fee: null, tc: null, wiring: {} };
    openAccount = null;
    // Only clears the active brand's slot; the other brand's work (if any) is left alone.
    try { sessionStorage.removeItem(STORE_KEY()); } catch (e) { /* ignore */ }
    renderAll();
    toast('Cleared. Ready for a new client.', 'info');
  }

  const ACTIONS = {
    addBlock(el) { doc().blocks.push(newBlock(el.dataset.type)); renderAll(); },
    removeBlock(el) { doc().blocks.splice(+el.dataset.i, 1); renderAll(); },
    moveBlock(el) { if (swap(doc().blocks, +el.dataset.i, +el.dataset.d)) renderAll(); },
    addFee(el) { getPath(state, el.dataset.i).profiles[+el.dataset.pi].fees.push({ label: '', value: '' }); renderAll(); },
    removeFee(el) { const pr = getPath(state, el.dataset.i).profiles[+el.dataset.pi]; if (pr.fees.length > 1) pr.fees.splice(+el.dataset.fi, 1); renderAll(); },
    addProfile(el) { const b = getPath(state, el.dataset.i); b.profiles.push({ label: 'New Profile', fees: (b.profiles[0] ? b.profiles[0].fees : [{ label: 'Fee', value: '' }]).map(f => ({ label: f.label, value: '' })) }); renderAll(); },
    removeProfile(el) { const b = getPath(state, el.dataset.i); if (b.profiles.length > 1) b.profiles.splice(+el.dataset.pi, 1); renderAll(); },
    addCol(el) { const b = getPath(state, el.dataset.i); b.columns.push('Column'); b.rows.forEach(r => r.push('')); renderAll(); },
    removeCol(el) { const b = getPath(state, el.dataset.i), ci = +el.dataset.ci; if (b.columns.length > 1) { b.columns.splice(ci, 1); b.rows.forEach(r => r.splice(ci, 1)); } renderAll(); },
    addRow(el) { const b = getPath(state, el.dataset.i); b.rows.push(b.type === 'table' ? b.columns.map(() => '') : { label: '', fee: '' }); renderAll(); },
    removeRow(el) { const b = getPath(state, el.dataset.i); if (b.rows.length > 1) b.rows.splice(+el.dataset.ri, 1); renderAll(); },
    addStep() { w().steps.push({ title: '', body: '' }); renderAll(); },
    removeStep(el) { if (w().steps.length > 1) w().steps.splice(+el.dataset.i, 1); renderAll(); },
    addAcct() { const a = D.account({ currency: '' }); a.checks = W.validateAccount(a); w().accounts.push(a); openAccount = a.id; renderAll(); },
    removeAcct(el) { const a = w().accounts.splice(+el.dataset.i, 1)[0]; if (a) delete files.wiring[a.id]; markDuplicates(); renderAll(); },
    moveAcct(el) { if (swap(w().accounts, +el.dataset.i, +el.dataset.d)) renderAll(); },
    openAcct(el) { openAccount = openAccount === el.dataset.id ? null : el.dataset.id; renderControls(); },
    toggleNa(el) { const a = w().accounts[+el.dataset.i]; a.na = a.na || {}; a.na[el.dataset.f] = !a.na[el.dataset.f]; markDuplicates(); renderAll(); },
    toggleClientFields(el) {
      const d = doc();
      d.clientFields = el.checked;
      // Clear the client-only fields when switching off so stale values don't resurface if the
      // user toggles back on later. Allocation key is cleared too — Indicative schedules carry
      // no reference, and reusing an allocated key for a later client would be unsafe.
      if (!d.clientFields) { d.preparedFor = ''; d.reference = ''; d.allocationKey = ''; }
      renderAll();
    },
    viewSource(el) { const f = files.wiring[el.dataset.id]; if (!f) return; const url = URL.createObjectURL(new Blob([f.buf], { type: 'application/pdf' })); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000); },
    feeSource(el) { w().feeSource = el.value; renderAll(); },
    ackMismatch() { w().mismatchAck = coherenceRaw().map(i => i.msg).join('\n'); renderAll(); },
    unackMismatch() { w().mismatchAck = ''; renderAll(); },
    includeTc(el) { w().includeTc = el.checked; renderAll(); },
    pullFromClient() { const c = state.docs.client, d = w(); d.clientName = c.preparedFor || d.clientName; d.cfsRef = c.reference || d.cfsRef; renderAll(); },
    pullFromUpload() { const m = files.fee && files.fee.meta, d = w(); if (!m) return; d.clientName = m.name || d.clientName; d.cfsRef = m.reference || d.cfsRef; renderAll(); },
    newClient() {
      showModal({ title: 'Start a new client?', text: 'This clears all three documents, every funding account and every attached file. The customer folder is the record; nothing is kept here.', onContinue: startNewClient, continueLabel: 'Clear everything' });
    },
    reset() {
      showModal({ title: 'Reset ' + MODE_NAMES[state.mode] + '?', text: 'Restores the standard wording and pricing for this document only.', onContinue: () => {
        state.docs[state.mode] = D[state.mode]();
        if (state.mode !== 'indicative') state.docs[state.mode].date = todayStr();
        if (state.mode === 'welcome') { files.fee = null; files.tc = null; files.wiring = {}; openAccount = null; }
        renderAll();
      }, continueLabel: 'Reset' });
    },
    async generateRef() {
      const d = doc();
      if ((D.activeBrand !== 'arie' && D.activeBrand !== 'acbm') || state.mode !== 'client') return;
      if (!d.preparedFor || !d.preparedFor.trim()) { showModal({ title: 'Client legal name required', text: 'Enter the client legal name before allocating a reference.' }); return; }
      // If this document already carries an auto-allocated reference, do NOT re-allocate — the
      // reference and client name are locked together. The only way to allocate for a different
      // client is Start New Client; the only way to recover from a wrong allocation is also
      // Start New Client (the old entry stays in the register against the original client name).
      if (d.allocationKey && d.reference) {
        showModal({ title: 'Already allocated', text: 'This Client Fee Schedule is already allocated as <b>' + esc(d.reference) + '</b> for <b>' + esc(d.preparedFor) + '</b>. To work on a different client, click <b>Start New Client</b>.' });
        return;
      }
      // Manually-typed historical reference (no allocationKey). Refuse to overwrite it from here
      // — staff must clear it first (or Start New Client). This prevents an auto-allocation from
      // silently replacing a hand-typed reference the staff member meant to keep.
      if (!d.allocationKey && d.reference && d.reference.trim()) {
        showModal({ title: 'Reference already set', text: 'A reference is already in the field (<b>' + esc(d.reference) + '</b>). Clear it first if you want to allocate a new one from the register.' });
        return;
      }
      // Idempotency key persists on the document so a retry after a reload / network blip
      // reuses the same slot in the register rather than consuming a new counter value.
      if (!d.allocationKey) { d.allocationKey = randomId(); persist(); }
      const btn = document.querySelector('button.gen-ref'); if (btn) { btn.disabled = true; btn.textContent = 'Allocating…'; }
      try {
        const resp = await fetch('/api/internal/pricing?action=allocate_ref', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brand: D.activeBrand, clientName: d.preparedFor.trim(), idempotencyKey: d.allocationKey, staff: getStaffId() })
        });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          // 409 means the server refused to hand this key over to a different client. The
          // document's allocationKey is already committed to someone else — clear it client-side
          // so the staff member's only path forward is Start New Client, which is the fix.
          if (resp.status === 409 && j.error === 'allocation_key_bound_to_other_client') {
            d.allocationKey = ''; persist();
          }
          showModal({ title: 'Could not allocate a reference', text: esc(j.message || j.error || ('HTTP ' + resp.status)) });
          return;
        }
        d.reference = j.reference;
        // The allocationKey stays on the document; a repeat allocation attempt (same key, same
        // client name) returns the SAME reference. A repeat attempt with a different client name
        // is refused server-side (409).
        renderAll();
        toast('Allocated ' + j.reference + (j.reused ? ' (already assigned to this client)' : ''), 'info');
      } catch (e) {
        showModal({ title: 'Network error', text: 'Could not reach the reference register. Please try again.' });
      } finally {
        const b2 = document.querySelector('button.gen-ref'); if (b2 && !d.reference) { b2.disabled = false; b2.textContent = 'Generate Reference'; }
      }
    },
    openHistory() {
      openReferenceHistory();
    },
    pdf() {
      guardedExport(() => {
        const go = () => X.printPdf(fileTitle());
        let seen = false; try { seen = sessionStorage.getItem('arie_print_hint') === '1'; } catch (e) { /* ignore */ }
        if (seen) return go();
        showModal({ title: 'Save as PDF', text: 'The browser print dialog opens next. Choose <b>Destination: Save as PDF</b>, <b>Margins: None</b>, and turn on <b>Background graphics</b> (under "More settings"). The browser remembers these choices.', onContinue: () => { try { sessionStorage.setItem('arie_print_hint', '1'); } catch (e) { /* ignore */ } go(); }, continueLabel: 'Open print dialog' });
      });
    },
    word(el) {
      guardedExport(async () => {
        el.disabled = true; el.textContent = 'Building…';
        try {
          const blob = state.mode === 'welcome' ? await X.welcomeDocx(w(), welcomeCtx()) : await X.feeDocx(doc());
          X.download(blob, fileTitle() + '.docx');
        } catch (e) { console.error(e); showModal({ title: 'Word export failed', text: esc(e.message) }); }
        el.disabled = false; el.textContent = 'Download Word';
      });
    }
  };

  function fileTitle() {
    const d = doc();
    const prefix = D.brand().filenamePrefix || 'ARIE';
    // Mode slug: use the document's own title when present, so ACBM's single mode uses the
    // "Indicative Fee Schedule" title that renders on the page instead of a hardcoded "Client".
    const titleSlug = X.safe(d.title || state.mode);
    if (state.mode === 'indicative') return prefix + '_' + (titleSlug || 'Indicative_Fee_Schedule');
    if (state.mode === 'client') return prefix + '_' + (titleSlug || 'Client_Fee_Schedule') + '_' + X.safe(d.preparedFor) + '_' + X.safe(d.date);
    return prefix + '_Welcome_Pack_' + X.safe(d.clientName) + '_' + X.safe(d.date);
  }

  // ---------- Reference brand validation ----------
  // Returns a human-readable error message when the reference string carries a different brand's
  // prefix than the active brand, or '' when it is empty or matches. Called from feeControls (for
  // live display) and from preflight (to block export). The brand of a reference is identified by
  // its prefix (ARIE-FS- / ACBM-FS-); a reference with no recognised prefix is accepted as-is.
  function refBrandMismatch(ref) {
    const b = brandFromReference(ref);
    if (!b || b === D.activeBrand) return '';
    const expected = D.brand().filenamePrefix;
    return 'Reference "' + ref + '" uses the ' + (D.BRANDS[b].filenamePrefix) + '-FS prefix, which belongs to ' + D.BRANDS[b].displayName + '. This document is for ' + D.brand().displayName + ' — use ' + expected + '-FS-… instead.';
  }

  // ---------- Brand detection on uploads ----------
  // Returns the brand id ('arie' | 'acbm') encoded in a reference string, or '' when the prefix
  // doesn't match any configured brand (older files, hand-typed references, blank).
  function brandFromReference(ref) {
    const r = String(ref || '').trim().toUpperCase();
    if (!r) return '';
    for (const id of Object.keys(D.BRANDS)) {
      const prefix = (D.BRANDS[id].filenamePrefix || '').toUpperCase();
      if (prefix && r.indexOf(prefix + '-FS-') === 0) return id;
    }
    return '';
  }
  // Infer the brand of an embedded CFS state. Reference prefix wins; eyebrow is a weaker fallback
  // (users can edit the eyebrow freely). Returns '' when neither can identify a brand.
  function brandOfFeeDoc(feeDoc) {
    const byRef = brandFromReference(feeDoc && feeDoc.reference);
    if (byRef) return byRef;
    const eye = String((feeDoc && feeDoc.eyebrow) || '').trim().toUpperCase();
    for (const id of Object.keys(D.BRANDS)) {
      if (eye && eye === String(D.BRANDS[id].eyebrow || '').toUpperCase()) return id;
    }
    return '';
  }

  // ---------- File handling ----------
  async function handleFiles(kind, list) {
    const arr = Array.from(list || []);
    const pdfs = arr.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    const docxs = arr.filter(f => /\.docx$/i.test(f.name));
    if (!pdfs.length && !(kind === 'fee' && docxs.length)) { toast(kind === 'fee' ? 'Attach a .docx exported by this tool or a .pdf.' : 'Only PDF files are supported here.'); return; }
    toast('Reading ' + arr.length + ' file(s)…', 'info');
    try {
      if (kind === 'wiring') {
        const d = w(); const failed = [];
        // One unreadable or oversized file must not stop the rest of a multi-file drop.
        for (const f of pdfs) {
          try {
            const big = tooBig(f, 'wiring');
            if (big) { failed.push(big); continue; }            // refused on File.size, never read
            const buf = await f.arrayBuffer();                  // read exactly once
            const g = await wiringGuard(f, buf);
            if (!g.ok) { failed.push(f.name + ' — ' + g.reason); continue; }
            const a = await W.parseWiringFile(f, buf);          // same bytes, not a second read
            d.accounts.push(a);                                // never replaces: several accounts per currency are allowed
            files.wiring[a.id] = { name: f.name, buf };
            if (!d.clientName) { const who = clientFromBeneficiary(a.beneficiaryName); if (who && /CLIENT\s*ACCOUNT/i.test(a.beneficiaryName)) d.clientName = who; }
          } catch (e) { failed.push(f.name + ' — ' + (e.message || 'could not be read')); }
        }
        markDuplicates();
        const first = d.accounts.find(x => W.worstLevel(x.checks) !== 'ok'); openAccount = first ? first.id : null;
        if (failed.length) showModal({ title: failed.length + ' wiring file' + (failed.length > 1 ? 's' : '') + ' not added', text: 'No funding block was created for:<ul style="margin:6px 0 0;padding-left:16px">' + failed.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' + (d.accounts.length ? 'The other files were added.' : '') });
      } else if (kind === 'fee') {
        const f = docxs[0] || pdfs[0];
        const mb = f.size / 1048576;
        // Every limit is checked against File.size first; nothing oversized is ever read into memory.
        // A Client Fee Schedule from this tool is well under a megabyte.
        if (docxs[0] && mb > 15) { showModal({ title: 'Word file too large', text: 'This Word file is ' + mb.toFixed(1) + ' MB. That is unusually large for a Client Fee Schedule. Please check that the correct document was selected.' }); return; }
        if (pdfs[0] && !docxs[0]) { const big = tooBig(f, 'fee'); if (big) { showModal({ title: 'File too large', text: esc(big) }); return; } }
        const buf = await f.arrayBuffer();
        if (docxs[0]) {
          if (mb > 5) toast(f.name + ': ' + mb.toFixed(1) + ' MB — unusually large for a Client Fee Schedule; check the document.', 'info');
          const r = await IO.readDocxState(buf);
          if (!r) { showModal({ title: 'Not a Document Builder export', text: 'This Word file carries no embedded schedule, so it cannot be rebuilt automatically. Attach the final Client Fee Schedule PDF instead.' }); return; }
          if (r.edited) {
            files.fee = null;
            showModal({ title: 'Word file edited after export', text: 'This Client Fee Schedule was edited in Word after it was generated. Automatic reconstruction has been disabled to avoid losing those amendments.<br><br>Attach the final Client Fee Schedule <b>PDF</b> for the PDF pack; the Word pack will reference it and can be amended by hand for this exceptional case.' });
            renderAll(); return;
          }
          // The embedded payload must be a Client Fee Schedule and must be structurally sound before
          // anything renders from it: an Indicative Fee Schedule carries embedded state too.
          const v = IO.validateFeeState(r.state);
          if (!v.ok) {
            files.fee = null;
            const named = { indicative: 'an Indicative Fee Schedule', welcome: 'a Welcome Pack' }[v.kind];
            showModal(v.kind
              ? { title: 'Wrong document type', text: 'This file is ' + (named || 'a different ARIE document') + ', not a Client Fee Schedule. Attach this client\u2019s final Client Fee Schedule instead.' }
              : { title: 'Schedule cannot be reconstructed', text: 'This ARIE Fee Schedule cannot be reconstructed safely \u2014 ' + esc(v.reason) + '. Attach its final PDF instead.' });
            renderAll(); return;
          }
          const feeDoc = r.state;
          // Cross-brand attachment guard: the attached CFS must belong to the active brand. Brand is
          // inferred from the reference prefix (ARIE-FS-… / ACBM-FS-…) and, as a safety net, from the
          // stored eyebrow string. An ACBM Welcome Pack doesn't exist in UI, so in practice this
          // catches an ACBM CFS attached to an ARIE Welcome Pack.
          const attachedBrandDocx = brandOfFeeDoc(feeDoc);
          if (attachedBrandDocx && attachedBrandDocx !== D.activeBrand) {
            files.fee = null;
            showModal({ title: 'Wrong entity', text: 'This Client Fee Schedule was issued by ' + esc(D.BRANDS[attachedBrandDocx].displayName) + ', but the current Welcome Pack is for ' + esc(D.brand().displayName) + '. Switch entity, or attach the Client Fee Schedule issued by ' + esc(D.brand().displayName) + ' instead.' });
            renderAll(); return;
          }
          files.fee = { name: f.name, kind: 'docx', buf, feeDoc, meta: { name: feeDoc.preparedFor, reference: feeDoc.reference, date: feeDoc.date } };
        } else {
          if (!(await sizeGuard(f, buf))) return;
          const meta = await W.readFeeScheduleMeta(buf.slice(0));
          if (meta.docType === 'indicative' || meta.docType === 'welcome') {
            files.fee = null;
            showModal({ title: 'Wrong document type', text: 'This PDF is ' + (meta.docType === 'indicative' ? 'an Indicative Fee Schedule' : 'a Welcome Pack') + ', not a Client Fee Schedule. Attach this client\u2019s final Client Fee Schedule PDF instead.' });
            renderAll(); return;
          }
          // Cross-brand attachment guard for PDFs: the reference prefix identifies the issuing brand.
          const attachedBrandPdf = brandFromReference(meta.reference);
          if (attachedBrandPdf && attachedBrandPdf !== D.activeBrand) {
            files.fee = null;
            showModal({ title: 'Wrong entity', text: 'This Client Fee Schedule PDF (reference ' + esc(meta.reference) + ') was issued by ' + esc(D.BRANDS[attachedBrandPdf].displayName) + ', but the current Welcome Pack is for ' + esc(D.brand().displayName) + '. Switch entity, or attach the Client Fee Schedule issued by ' + esc(D.brand().displayName) + ' instead.' });
            renderAll(); return;
          }
          const pages = await W.renderPages(buf.slice(0), 2.5);
          // The rendered pages are what both packs use; the source bytes have no further reader, so they
          // are not retained. (Wiring buffers ARE kept — "View source PDF" reopens them.)
          files.fee = { name: f.name, kind: 'pdf', pages, meta };
        }
        const d = w(), m = files.fee.meta || {};
        if (!d.clientName && m.name) d.clientName = m.name;
        if (!d.cfsRef && m.reference) d.cfsRef = m.reference;
      } else if (kind === 'tc') {
        const f = pdfs[0];
        const big = tooBig(f, 'tc');
        if (big) { showModal({ title: 'File too large', text: esc(big) }); return; }
        const buf = await f.arrayBuffer();
        if (!(await sizeGuard(f, buf))) return;
        files.tc = { name: f.name, pages: await W.renderPages(buf.slice(0), 2.5) };
      }
      toast('Done.', 'info');
    } catch (e) {
      // A refused file is a handled outcome shown to staff, not a fault: warn, don't error.
      if (e && e.unsafeZip) { console.warn(e.message); files.fee = null; showModal({ title: 'Word file cannot be opened safely', text: esc(e.message) }); }
      else { console.error(e); toast('Could not read file: ' + e.message); }
    }
    renderAll();
  }

  // Byte caps applied to File.size BEFORE the file is read, so an enormous PDF is refused without ever
  // being loaded into memory. The page-count guards below run afterwards on what is left.
  const MAX_MB = { wiring: 25, fee: 20, tc: 30 };
  function tooBig(f, kind) {
    const mb = f.size / 1048576;
    if (mb <= MAX_MB[kind]) return null;
    return f.name + ' is ' + mb.toFixed(1) + ' MB, over the ' + MAX_MB[kind] + ' MB limit for '
      + (kind === 'wiring' ? 'wiring instructions' : kind === 'fee' ? 'a Client Fee Schedule' : 'a Terms & Conditions PDF')
      + '. Please check that the correct document was selected'
      + (kind === 'tc' ? ', or leave the Terms & Conditions as "provided separately"' : '') + '.';
  }

  // Wiring instructions are a single page. Anything much larger is the wrong document, and parsing it
  // would read text from every page. Warn above 5 pages / 10 MB, refuse above 20 pages / 25 MB.
  async function wiringGuard(f, buf) {
    const mb = f.size / 1048576;
    let pages;
    try { pages = await W.pageCount(buf.slice(0)); } catch (e) { return { ok: false, reason: 'this file could not be opened as a PDF' }; }
    if (pages > 20 || mb > 25) return { ok: false, reason: pages + ' pages / ' + mb.toFixed(1) + ' MB. This file is unusually large for wiring instructions. Please check that the correct document was selected.' };
    if (pages > 5 || mb > 10) toast(f.name + ': ' + pages + ' pages / ' + mb.toFixed(1) + ' MB — unusually large for wiring instructions; check the document.', 'info');
    return { ok: true };
  }

  // Attached PDFs are rendered to page images in memory. Warn above 25 pages / 15 MB, refuse above 80 pages.
  async function sizeGuard(f, buf) {
    const pages = await W.pageCount(buf.slice(0));
    const mb = f.size / 1048576;
    if (pages > 80) { showModal({ title: 'File too large to append', text: esc(f.name) + ' has ' + pages + ' pages. Appending it as page images would strain the browser. Leave the Terms & Conditions as "provided separately".' }); return false; }
    if (pages > 25 || mb > 15) toast(f.name + ': ' + pages + ' pages / ' + mb.toFixed(1) + ' MB — large attachment, rendering may take a moment.', 'info');
    return true;
  }

  // Update an account's check messages, input highlighting and status pill without re-rendering the pane.
  function refreshAccountChecks(path) {
    const base = path.replace(/\.[a-zA-Z]+$/, '');
    const a = getPath(state, base); if (!a) return;
    const idx = +base.split('.').pop();
    for (const f of ['currency'].concat(W.FIELDS)) {
      const input = document.getElementById('f_' + (base + '.' + f).replace(/\./g, '_')); if (!input) continue;
      const ck = (a.checks || {})[f] || { level: 'ok', msg: '' }; const isNa = a.na && a.na[f];
      input.classList.remove('ok', 'warn', 'error'); if (!isNa) input.classList.add(ck.level);
      const msg = input.closest('.fld') && input.closest('.fld').querySelector('.msg'); if (msg) { msg.textContent = ck.msg; msg.className = 'msg ' + ck.level; }
    }
    const row = document.querySelectorAll('.acct-row')[idx]; if (row) { const lvl = W.worstLevel(a.checks); const pill = row.querySelector('.pill'); pill.className = 'pill ' + lvl; pill.textContent = lvl === 'ok' ? '✓ ok' : lvl === 'warn' ? 'review' : 'attention'; row.querySelector('.cur').textContent = a.currency || '?'; }
  }

  let toastTimer = null;
  function toast(msg, cls) {
    const t = document.getElementById('toast'); t.textContent = msg; t.className = 'toast no-print' + (cls ? ' ' + cls : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- Reference register ----------
  // The staff identifier is a per-browser localStorage value, OPTIONAL. It is sent with each
  // allocation and recorded in the register entry so the history view shows who allocated what.
  // No server-side auth is attached to it (the shared passcode is the only auth); it is a label.
  const STAFF_KEY = 'arie_pricing_staff_id';
  function getStaffId() { try { return localStorage.getItem(STAFF_KEY) || ''; } catch (e) { return ''; } }
  function setStaffId(v) { try { localStorage.setItem(STAFF_KEY, String(v || '').slice(0, 40)); } catch (e) { /* ignore */ } }
  function randomId() {
    // 128 bits of entropy encoded urlsafe-base64. Crypto.randomUUID would also work.
    try { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : fallback(); } catch (e) { return fallback(); }
    function fallback() { let s = ''; for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 36).toString(36); return s; }
  }

  function openReferenceHistory() {
    closeModal();
    const bg = document.createElement('div'); bg.className = 'modal-bg no-print'; bg.id = 'modal';
    bg.innerHTML = '<div class="modal" role="dialog" style="min-width:min(640px,95vw);max-width:800px">' +
      '<div class="m-h">Reference History</div>' +
      '<div class="m-b">' +
        '<p class="hint" style="margin:0 0 10px">Search allocated Client Fee Schedule references by client name, reference number or staff identifier.</p>' +
        '<input id="ref-history-q" class="in" type="search" placeholder="Search…" autocomplete="off" style="width:100%;padding:8px 10px">' +
        '<div id="ref-history-body"><p class="ref-history-empty">Loading…</p></div>' +
      '</div>' +
      '<div class="m-f"><button class="primary" data-m="cancel">Close</button></div></div>';
    bg.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) closeModal(); });
    document.body.appendChild(bg);
    const q = document.getElementById('ref-history-q');
    const body = document.getElementById('ref-history-body');
    let timer = null, lastReq = 0;
    function run() {
      const term = q.value.trim();
      const myReq = ++lastReq;
      body.innerHTML = '<p class="ref-history-empty">Searching…</p>';
      fetch('/api/internal/pricing?action=register_search&q=' + encodeURIComponent(term), { credentials: 'same-origin' })
        .then(r => r.json().catch(() => ({})))
        .then(j => {
          if (myReq !== lastReq) return;
          if (j && j.ok && Array.isArray(j.results)) {
            if (!j.results.length) { body.innerHTML = '<p class="ref-history-empty">No references found' + (term ? ' matching "' + esc(term) + '".' : ' yet.') + '</p>'; return; }
            body.innerHTML = '<table class="ref-history-table"><thead><tr><th>Reference</th><th>Client</th><th>Entity</th><th>Allocated</th><th>Staff</th></tr></thead><tbody>' +
              j.results.map(r => '<tr><td><b>' + esc(r.reference) + '</b></td><td>' + esc(r.clientName || '—') + '</td><td>' + esc((r.entity || '').toUpperCase()) + '</td><td>' + esc(fmtDate(r.allocatedAt)) + '</td><td>' + esc(r.staff || '') + '</td></tr>').join('') +
              '</tbody></table>' + (j.results.length >= 200 ? '<p class="hint" style="margin-top:8px">Showing the first 200 results. Narrow your search to see more.</p>' : '');
          } else if (j && j.error === 'redis_unconfigured') {
            body.innerHTML = '<p class="ref-history-empty">Reference register is not configured yet. Ask the administrator to connect Upstash Redis in Vercel.</p>';
          } else {
            body.innerHTML = '<p class="ref-history-empty">Could not load register.</p>';
          }
        })
        .catch(() => { if (myReq === lastReq) body.innerHTML = '<p class="ref-history-empty">Could not reach the register.</p>'; });
    }
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
    run();
    setTimeout(() => q.focus(), 50);
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try { const d = new Date(iso); if (isNaN(d.getTime())) return iso; return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; }
  }

  // ---------- Events ----------
  function bind() {
    const pane = document.getElementById('pane');
    pane.addEventListener('input', (e) => {
      const el = e.target; if (!el.dataset.path) return;
      const val = el.dataset.lines ? el.value.split('\n') : el.value;
      setPath(state, el.dataset.path, el.dataset.path.endsWith('.currency') ? String(val).toUpperCase() : val);
      if (el.dataset.acct) { markDuplicates(); refreshAccountChecks(el.dataset.path); }
      scheduleDesk(); persist();
    });
    pane.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset.file) { handleFiles(el.dataset.file, el.files); el.value = ''; return; }
      if (el.dataset.act && ACTIONS[el.dataset.act] && (el.type === 'radio' || el.type === 'checkbox')) ACTIONS[el.dataset.act](el);
    });
    document.body.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]'); if (!el) return;
      if (el.type === 'radio' || el.type === 'checkbox') return;
      if (el.dataset.act === 'openAcct' && e.target.closest('.acct-edit')) return;
      const fn = ACTIONS[el.dataset.act]; if (fn) { e.preventDefault(); fn(el); }
    });
    // Delegated so re-rendered mode / entity buttons keep working.
    document.addEventListener('click', (e) => {
      const mb = e.target.closest('.modes button[data-mode]');
      if (mb) {
        if (!state.docs[mb.dataset.mode]) return;    // ignore a mode this brand doesn't offer
        state.mode = mb.dataset.mode;
        if (state.mode === 'welcome') { const d = w(), c = state.docs.client; if (d.feeSource === 'current') { if (!d.clientName && c.preparedFor) d.clientName = c.preparedFor; if (!d.cfsRef && c.reference) d.cfsRef = c.reference; } }
        renderAll();
        return;
      }
      const eb = e.target.closest('#entity-switch button[data-brand]');
      if (eb) switchBrand(eb.dataset.brand);
    });
    pane.addEventListener('dragover', (e) => { const z = e.target.closest('.drop'); if (z) { e.preventDefault(); z.classList.add('over'); } });
    pane.addEventListener('dragleave', (e) => { const z = e.target.closest('.drop'); if (z) z.classList.remove('over'); });
    pane.addEventListener('drop', (e) => { const z = e.target.closest('.drop'); if (!z) return; e.preventDefault(); z.classList.remove('over'); handleFiles(z.dataset.drop, e.dataTransfer.files); });
    pane.addEventListener('click', (e) => { const z = e.target.closest('.drop'); if (z && !e.target.closest('button')) z.querySelector('input[type=file]').click(); });
    window.addEventListener('afterprint', () => { document.title = 'Document Builder'; });
    window.addEventListener('resize', scheduleDesk);
  }

  function browserCheck() {
    const ua = navigator.userAgent;
    const chromium = /Chrome\/\d+/.test(ua) && !/OPR\/|Firefox\//.test(ua);
    if (!chromium) document.getElementById('browser-warn').hidden = false;
  }

  // ---------- Boot ----------
  document.getElementById('app-version').textContent = 'v' + D.VERSION;
  const staffEl = document.getElementById('staff-id');
  if (staffEl) {
    staffEl.value = getStaffId();
    staffEl.addEventListener('input', () => setStaffId(staffEl.value));
  }
  load();
  bind();
  browserCheck();
  document.fonts && document.fonts.ready ? document.fonts.ready.then(renderAll) : renderAll();
  renderAll();

  // Hook for automated tests; not used by the UI.
  window.ARIE = { getState: () => state, getFiles: () => files, handleFiles, actions: ACTIONS, renderAll, preflight, coherence, startNewClient };
})();
