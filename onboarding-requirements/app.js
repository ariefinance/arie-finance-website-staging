/*
 * ARIE Finance — Onboarding Requirements
 *
 * Vanilla-JS production port of the approved design artifact. Data, strings,
 * conditional rules and PDF layout are preserved verbatim from the frozen
 * specification. UI is semantic HTML (buttons, native <dialog>, aria-expanded
 * accordions), no framework. PDF generation is delegated to the locally
 * vendored html2pdf bundle; per-page footer (corporate line + "Requirements
 * v1.0 · Page X of Y") is added through the jsPDF handle exposed by html2pdf's
 * .toPdf().get('pdf') chain.
 *
 * No analytics, no dataLayer, no third-party fetches at runtime (fonts aside).
 */
(function () {
  'use strict';

  // ---------- constants (frozen spec) ----------
  var VER = '1.0';
  var VDATE = 'October 2026';
  var MAY_APPLY = 'May apply — please confirm with ARIE Finance';

  var CORP_FOOTER = 'ARIE FINANCE LTD | COMPANY NUMBER 221997 | 3RD FLOOR, KPMG CENTRE, EBENE, MAURITIUS | LICENCE IK17000006 / GB25205028';

  // Category definitions. Order drives both the UI accordion and the PDF.
  // `hidden:true` = computed dependency (never user-togglable).
  var CATS = [
    { k: 'company',     l: 'Applicant Company', always: true },
    { k: 'directors',   l: 'Directors' },
    { k: 'signatories', l: 'Authorised Signatories' },
    { k: 'ubo',         l: 'Ultimate Beneficial Owners' },
    { k: 'corpSh',      l: 'Corporate Shareholder — Company' },
    { k: 'dirCorpSh',   l: 'Director of Corporate Shareholder', hidden: true }
  ];
  var TOGGLEABLE = CATS.filter(function (c) { return !c.hidden; });

  // "Required for each ..." subtitles beneath each per-person section header.
  var PPN = {
    directors:   'Required for each Director',
    signatories: 'Required for each Authorised Signatory',
    ubo:         'Required for each Ultimate Beneficial Owner',
    corpSh:      'Required for each Corporate Shareholder',
    dirCorpSh:   'Required for each Director of each Corporate Shareholder'
  };

  // ---------- state ----------
  var state = {
    view: 'landing',        // 'landing' | 'preview'
    modalStep: 1,           // 1 | 2
    companyName: '',
    nameErr: false,
    condErr: false,
    cats: {
      company: true, directors: true, signatories: true, ubo: true,
      corpSh: false, dirCorpSh: false
    },
    conds: { oy: null, ba: null, li: null },
    expL: {                 // landing accordion open-state
      company: true, directors: false, signatories: false,
      ubo: false, corpSh: false, dirCorpSh: false
    },
    expP: {}                // preview accordion open-state (populated on generate)
  };

  // ---------- requirements data ----------
  // `cd` = governing conditional ('oy' | 'ba' | 'li'); `cn` = note shown
  // underneath. In personalised view, items where `cn === null` are dropped
  // (that happens when the user answered the governing question "No").
  function items(c) {
    var oy = c.oy, ba = c.ba, li = c.li;
    return {
      company: [
        { n: 'Application + Onboarding Form', nt: 'To be completed and signed', dl: true },
        { n: 'Certified True Copy Certificate of Incorporation' },
        { n: 'Certified True Copy Memorandum and Articles of Association' },
        { n: 'Certified True Copy Register of Directors & Shareholders',
          nt: 'Or Certificate of Incumbency showing active directors and shareholders' },
        { n: 'Certified True Copy Register of Beneficial Owners',
          nt: 'Or written confirmation of beneficial owner' },
        { n: 'Certified True Copy Certificate of Good Standing', cd: 'oy',
          cn: oy === 'yes' ? 'Required: company is more than 1 year old'
             : oy === 'unsure' ? MAY_APPLY
             : oy === 'no' ? null
             : 'If the company is more than one year old' },
        { n: 'Latest Financial Statements / Management Accounts', cd: 'oy',
          cn: oy === 'yes' ? 'Required: company is more than 1 year old'
             : oy === 'unsure' ? MAY_APPLY
             : oy === 'no' ? null
             : 'If the company is more than one year old' },
        { n: 'Signed Structure Chart up to the Beneficial Owner' },
        { n: 'Last 6 months’ Bank Statements', cd: 'ba',
          cn: ba === 'yes' ? 'Required: existing bank account available'
             : ba === 'unsure' ? MAY_APPLY
             : ba === 'no' ? null
             : 'If an existing bank account is available' },
        { n: 'Certified True Copy licence to operate and proof of its validity', cd: 'li',
          cn: li === 'yes' ? 'Required: business is subject to a licence'
             : li === 'unsure' ? MAY_APPLY
             : li === 'no' ? null
             : 'If the business activity is subject to a regulatory or operating licence' },
        { n: 'Documentary evidence of Source of Funds' }
      ],
      directors: [
        { n: 'Certified True Copy Passport' },
        { n: 'Certified True Copy Proof of Address', nt: 'Dated less than 3 months — Utility Bill or Bank Statement' },
        { n: 'CV / Detailed Profile' }
      ],
      signatories: [
        { n: 'Certified True Copy Passport' },
        { n: 'Certified True Copy Proof of Address', nt: 'Dated less than 3 months — Utility Bill or Bank Statement' },
        { n: 'Contact Details', nt: 'Email address and phone number' }
      ],
      ubo: [
        { n: 'Certified True Copy Passport' },
        { n: 'Certified True Copy Proof of Address', nt: 'Dated less than 2 months — Utility Bill or Bank Statement' },
        { n: 'CV / Detailed Profile' }
      ],
      // Corporate Shareholder age is INDEPENDENT of the applicant company's
      // `oy` answer. Keep the generic conditional note; do not substitute
      // based on `c.oy`.
      corpSh: [
        { n: 'Certified True Copy Certificate of Incorporation' },
        { n: 'Certified True Copy Memorandum and Articles of Association' },
        { n: 'Certified True Copy Register of Directors & Shareholders',
          nt: 'Or Certificate of Incumbency showing active directors and shareholders' },
        { n: 'Certified True Copy Register of Beneficial Owners',
          nt: 'Or written confirmation of beneficial owner' },
        { n: 'Certified True Copy Certificate of Good Standing', cn: 'If the corporate shareholder is more than one year old' },
        { n: 'Latest Financial Statements / Management Accounts', cn: 'If the corporate shareholder is more than one year old' }
      ],
      dirCorpSh: [
        { n: 'Certified True Copy Passport' },
        { n: 'Certified True Copy Proof of Address', nt: 'Dated less than 3 months — Utility Bill or Bank Statement' },
        { n: 'CV / Detailed Profile' }
      ]
    };
  }

  // Items visible in a given render: landing = all; personalised = drop
  // conditional rows the user flipped to "No".
  function visible(k, c, personalised) {
    var its = items(c)[k] || [];
    if (personalised) return its.filter(function (i) { return !i.cd || i.cn !== null; });
    return its;
  }

  // ---------- escaping helpers ----------
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeFilenamePart(s) {
    return String(s).replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').substring(0, 80);
  }

  // ---------- DOM helpers ----------
  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn) { el.addEventListener(ev, fn); }
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      if (k === 'class') el.className = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] === true) el.setAttribute(k, '');
      else if (attrs[k] === false || attrs[k] == null) { /* skip */ }
      else el.setAttribute(k, attrs[k]);
    }
    if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  // ---------- landing accordion render ----------
  function renderLandingAccordions() {
    var host = $('landing-sections');
    host.innerHTML = '';
    var catList = CATS; // landing always shows every category
    catList.forEach(function (d, idx) {
      var its = visible(d.k, {}, false);
      var open = !!state.expL[d.k];
      var ppn = PPN[d.k];

      var head = h('button', {
        type: 'button', class: 'acc-head', 'aria-expanded': String(open),
        'aria-controls': 'acc-body-' + d.k, id: 'acc-head-' + d.k,
        onclick: function () { state.expL[d.k] = !state.expL[d.k]; renderLandingAccordions(); }
      }, [
        h('div', { class: 'acc-head-left' }, [
          h('div', { class: 'acc-num', 'aria-hidden': 'true' }, String(idx + 1).padStart(2, '0')),
          h('div', { class: 'acc-title' }, d.l)
        ]),
        h('div', { class: 'acc-chev', 'aria-hidden': 'true' }, '⌄')
      ]);

      var body = h('div', {
        id: 'acc-body-' + d.k, role: 'region', 'aria-labelledby': 'acc-head-' + d.k,
        hidden: !open
      });
      if (ppn) body.appendChild(h('div', { class: 'acc-ppn' }, ppn));
      its.forEach(function (i) { body.appendChild(renderAccItem(i, false)); });

      host.appendChild(h('div', { class: 'acc' }, [head, body]));
    });
  }

  function renderAccItem(i, personalised) {
    var ma = i.cn && i.cn.indexOf('May apply') === 0;
    var cls = 'acc-item' + (i.cn ? (ma ? ' cond may' : ' cond') : '');
    var children = [h('span', { class: 'n' }, i.n)];
    if (i.nt) children.push(h('span', { class: 'note-s' }, i.nt));
    if (i.cn) children.push(h('div', null, [h('span', { class: 'tag' }, i.cn)]));
    if (i.dl) {
      children.push(h('div', { class: 'inline-dl' }, [
        h('a', {
          href: '/documents/ARIE_Finance_Corporate_Onboarding_Pack.pdf',
          download: 'ARIE_Finance_Corporate_Onboarding_Pack.pdf'
        }, 'Download Corporate Onboarding Pack ↓'),
        h('span', { class: 'hint' }, 'Includes the application and related onboarding declarations.')
      ]));
    }
    return h('div', { class: cls }, children);
  }

  // ---------- preview render ----------
  function renderPreview() {
    $('pv-company').textContent = state.companyName;
    var selected = CATS.filter(function (d) { return state.cats[d.k]; })
      .map(function (d) {
        if (d.k === 'corpSh') return 'Corporate Shareholder — Company & Directors';
        if (d.k === 'dirCorpSh') return null;
        return d.l;
      })
      .filter(Boolean).join(' · ');
    $('pv-structure').textContent = selected;
    var c = state.conds, parts = [];
    if (c.oy) parts.push('Company more than one year old: ' + humanAns(c.oy));
    if (c.ba) parts.push('Existing bank account: ' + humanAns(c.ba));
    if (c.li) parts.push('Regulatory / operating licence: ' + humanAns(c.li));
    $('pv-conds').textContent = parts.join(' · ');

    var host = $('preview-sections');
    host.innerHTML = '';
    var n = 0;
    CATS.filter(function (d) { return state.cats[d.k]; }).forEach(function (d) {
      n++;
      var its = visible(d.k, state.conds, true);
      var open = !!state.expP[d.k];
      var ppn = PPN[d.k];
      var head = h('button', {
        type: 'button', class: 'acc-head', 'aria-expanded': String(open),
        'aria-controls': 'pacc-body-' + d.k, id: 'pacc-head-' + d.k,
        onclick: function () { state.expP[d.k] = !state.expP[d.k]; renderPreview(); }
      }, [
        h('div', { class: 'acc-head-left' }, [
          h('div', { class: 'acc-num', 'aria-hidden': 'true' }, String(n).padStart(2, '0')),
          h('div', { class: 'acc-title' }, d.l)
        ]),
        h('div', { class: 'acc-chev', 'aria-hidden': 'true' }, '⌄')
      ]);
      var body = h('div', {
        id: 'pacc-body-' + d.k, role: 'region', 'aria-labelledby': 'pacc-head-' + d.k,
        hidden: !open
      });
      if (ppn) body.appendChild(h('div', { class: 'acc-ppn' }, ppn));
      its.forEach(function (i) { body.appendChild(renderAccItem(i, true)); });
      host.appendChild(h('div', { class: 'acc' }, [head, body]));
    });
  }

  function humanAns(a) { return a === 'yes' ? 'Yes' : a === 'no' ? 'No' : 'Not sure'; }

  // ---------- view switching ----------
  function showView(name) {
    state.view = name;
    $('view-landing').hidden = name !== 'landing';
    $('view-preview').hidden = name !== 'preview';
    if (name === 'landing') renderLandingAccordions();
    if (name === 'preview') renderPreview();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  // ---------- modal (native <dialog>) ----------
  var modal, prevFocus;
  function openModal(step) {
    modal = modal || $('gen-modal');
    prevFocus = document.activeElement;
    state.modalStep = step || 1;
    state.nameErr = false;
    state.condErr = false;
    renderModal();
    if (typeof modal.showModal === 'function') modal.showModal();
    else { modal.setAttribute('open', ''); modal.style.display = 'block'; }
    // Focus the first interactive field in the current step.
    var focusTarget = state.modalStep === 1 ? $('m-company') : $('m-cond-list').querySelector('button');
    if (focusTarget) setTimeout(function () { focusTarget.focus(); }, 10);
  }
  function closeModal() {
    if (!modal) return;
    if (typeof modal.close === 'function') modal.close();
    else { modal.removeAttribute('open'); modal.style.display = 'none'; }
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  }
  function renderModal() {
    $('m-step-n').textContent = state.modalStep;
    $('modal-title').textContent = state.modalStep === 1 ? 'Company & Structure' : 'A few quick questions';
    $('m-s1').hidden = state.modalStep !== 1;
    $('m-s2').hidden = state.modalStep !== 2;
    $('btn-modal-next').hidden = state.modalStep !== 1;
    $('btn-modal-gen').hidden = state.modalStep !== 2;
    $('btn-modal-back').disabled = state.modalStep === 1;

    var input = $('m-company');
    input.value = state.companyName;
    input.classList.toggle('err', !!state.nameErr);
    input.setAttribute('aria-invalid', state.nameErr ? 'true' : 'false');
    $('m-company-err').classList.toggle('show', !!state.nameErr);

    renderCatGrid();
    renderCondList();

    $('m-cond-err').classList.toggle('show', !!state.condErr);
  }
  function renderCatGrid() {
    var host = $('m-cat-grid');
    host.innerHTML = '';
    TOGGLEABLE.forEach(function (d) {
      var active = !!state.cats[d.k];
      var lbl = (d.k === 'corpSh' && active) ? 'Corporate Shareholder — Company & Directors' : d.l;
      var btn = h('button', {
        type: 'button', class: 'cat-chip',
        'aria-pressed': String(active),
        style: 'background:' + (active ? '#06113A' : '#f5f5f3') +
               ';border:' + (active ? '1px solid #06113A' : '1px dashed #d4d4d0') +
               ';color:' + (active ? '#fff' : '#888'),
        disabled: !!d.always,
        onclick: d.always ? null : function () {
          state.cats[d.k] = !state.cats[d.k];
          // Corporate Shareholder couples the dependent Director block.
          if (d.k === 'corpSh') state.cats.dirCorpSh = state.cats[d.k];
          renderCatGrid();
        }
      }, [
        h('span', {
          class: 'ck', 'aria-hidden': 'true',
          style: 'background:' + (active ? 'rgba(255,255,255,.2)' : 'transparent') +
                 ';color:' + (active ? '#fff' : 'transparent') +
                 ';border:' + (active ? 'none' : '1.5px solid #ccc')
        }, active ? '✓' : ''),
        h('span', { class: 'lbl' }, lbl),
        d.always ? h('span', { class: 'always' }, 'Always included') : null
      ]);
      host.appendChild(btn);
    });
  }
  var COND_QS = [
    { k: 'oy', q: 'Is the company more than one year old?', help: null, sep: true },
    { k: 'ba', q: 'Does the company maintain an existing bank account?', help: null, sep: true },
    { k: 'li', q: 'Is your business activity subject to a regulatory or operating licence?',
      help: 'For example, financial services, insurance, investment, gaming, telecoms or another regulated activity.', sep: false }
  ];
  function renderCondList() {
    var host = $('m-cond-list');
    host.innerHTML = '';
    COND_QS.forEach(function (q) {
      var row = h('div', { class: 'cond-q' + (q.sep ? ' sep' : '') });
      row.appendChild(h('div', { class: 'q' }, q.q));
      if (q.help) row.appendChild(h('div', { class: 'help' }, q.help));
      var cur = state.conds[q.k];
      var opts = [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']];
      var btns = h('div', { class: 'cond-row', role: 'group', 'aria-label': q.q });
      opts.forEach(function (o) {
        var active = cur === o[0];
        var isU = o[0] === 'unsure';
        var style = active
          ? (isU
              ? 'background:#fffbeb;color:#92400e;border:1px solid #fde68a'
              : 'background:#06113A;color:#fff;border:1px solid #06113A')
          : 'background:#f5f5f3;color:#666;border:1px solid #e8e8e5';
        btns.appendChild(h('button', {
          type: 'button', 'aria-pressed': String(active), style: style,
          onclick: function () {
            state.conds[q.k] = state.conds[q.k] === o[0] ? null : o[0];
            state.condErr = false;
            renderCondList();
            $('m-cond-err').classList.remove('show');
          }
        }, o[1]));
      });
      row.appendChild(btns);
      host.appendChild(row);
    });
  }

  // ---------- generate ----------
  function tryContinue() {
    var nm = $('m-company').value.trim().substring(0, 150);
    if (!nm) {
      state.companyName = $('m-company').value;
      state.nameErr = true;
      renderModal();
      $('m-company').focus();
      return;
    }
    state.companyName = nm;
    state.nameErr = false;
    state.modalStep = 2;
    renderModal();
    var firstBtn = $('m-cond-list').querySelector('button');
    if (firstBtn) firstBtn.focus();
  }
  function tryGenerate() {
    var c = state.conds;
    if (c.oy === null || c.ba === null || c.li === null) {
      state.condErr = true;
      renderModal();
      return;
    }
    // Default preview-accordion open-state: open every selected section.
    var ep = {};
    CATS.forEach(function (d) { if (state.cats[d.k]) ep[d.k] = true; });
    state.expP = ep;
    state.condErr = false;
    closeModal();
    showView('preview');
  }

  // ---------- PDF ----------
  // Builds the printable HTML for a Generic or Personalised checklist. The
  // per-page footer (corporate line + "Page X of Y") is added separately by
  // iterating the jsPDF handle after html2pdf has rendered, so no footer
  // markup is embedded here.
  function printHtml(type) {
    var c = type === 'generic' ? {} : state.conds;
    var cf = type === 'generic' ? null : state.cats;
    var co = type === 'generic' ? null : state.companyName;
    var secs = CATS.filter(function (d) { return !cf || cf[d.k]; });

    var out = '';
    out += '<div style="font-family:DM Sans,system-ui,sans-serif;color:#1a1a1a">';
    out += '<div style="height:6px;background:linear-gradient(90deg,#06113A,#201485)"></div>';
    out += '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin:24px 0 28px">' +
      '<img src="/onboarding-requirements/assets/arie-logo.png" style="height:22px" alt="ARIE Finance">' +
      '<div style="font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:2px;color:#b8a070">Corporate Onboarding</div></div>';

    if (type === 'generic') {
      out += '<div style="font-family:DM Serif Display,serif;font-size:26px;color:#06113A;line-height:1.2;margin-bottom:8px">Onboarding Requirements<br>Checklist</div>';
      out += '<div style="width:40px;height:2px;background:#b8a070;margin-bottom:8px"></div>';
      out += '<div style="font-size:10px;color:#888;margin-bottom:16px">Standard documentation required for onboarding with ARIE Finance.</div>';
      out += '<div style="padding:8px 0;border-top:1px solid #e8e5dd;border-bottom:1px solid #e8e5dd;margin-bottom:16px;font-size:9px;color:#888">Requirements version: <span style="color:#333;font-weight:500">' + VER + ' · ' + VDATE + '</span></div>';
    } else {
      out += '<div style="font-family:DM Serif Display,serif;font-size:26px;color:#06113A;line-height:1.2;margin-bottom:8px">Onboarding Document<br>Checklist</div>';
      out += '<div style="width:40px;height:2px;background:#b8a070;margin-bottom:8px"></div>';
      out += '<div style="font-size:10px;color:#888;margin-bottom:16px">Checklist generated based on the information provided.</div>';
      out += '<div style="padding:12px 0;border-top:1px solid #e8e5dd;border-bottom:1px solid #e8e5dd;margin-bottom:6px">';
      out += '<div style="font-size:10px;margin-bottom:4px"><span style="color:#888">Company:</span> <span style="color:#06113A;font-weight:600;font-size:12px">' + esc(co || '') + '</span></div>';
      var dt = new Date();
      var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      out += '<div style="display:flex;gap:16px;font-size:9px;color:#888"><div>Generated: <span style="color:#333;font-weight:500">' +
        dt.getDate() + ' ' + months[dt.getMonth()] + ' ' + dt.getFullYear() + '</span></div>' +
        '<div>Requirements version: <span style="color:#333;font-weight:500">' + VER + ' · ' + VDATE + '</span></div></div></div>';

      var selN = CATS.filter(function (d) { return cf[d.k]; }).map(function (d) { return d.l; }).join(' · ');
      out += '<div style="padding:6px 0;margin-bottom:12px;font-size:9px;color:#888;line-height:1.8"><div>Structure: <span style="color:#333">' + esc(selN) + '</span></div>';
      var cp = [];
      function fmtAns(k, label) {
        if (!c[k]) return;
        var v = c[k];
        var col = v === 'unsure' ? '#b8a070;font-weight:600' : '#333;font-weight:500';
        cp.push(label + ': <span style="color:' + col + '">' + humanAns(v) + '</span>');
      }
      fmtAns('oy', 'Company more than one year old');
      fmtAns('ba', 'Existing bank account');
      fmtAns('li', 'Regulatory / operating licence');
      if (cp.length) out += '<div>' + cp.join(' · ') + '</div>';
      out += '</div>';

      out += '<div style="background:#06113A;padding:14px 18px;border-radius:4px;margin-bottom:14px">' +
        '<div style="font-size:11px;font-weight:600;color:#fff;line-height:1.5;margin-bottom:4px">Please tick the documents included with your submission and send this completed checklist together with your supporting documents to ARIE Finance.</div>' +
        '<div style="font-size:9px;color:rgba(255,255,255,.6);line-height:1.5">This helps ARIE Finance identify the documents submitted and review your onboarding pack more efficiently.</div></div>';
    }

    out += '<div style="font-size:9px;color:#555;line-height:1.6;margin-bottom:18px;padding:10px 14px;background:#f5f3ee;border-radius:4px">Where a requirement applies to more than one person or entity, please tick the box once the relevant document has been included for <strong>all</strong> applicable persons or entities.</div>';

    var sN = 0;
    secs.forEach(function (d) {
      sN++;
      var its = visible(d.k, c, type === 'personalised');
      var ppn = PPN[d.k];
      out += '<div style="margin-bottom:16px;break-inside:avoid;page-break-inside:avoid">';
      out += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:' + (ppn ? '4' : '10') + 'px">' +
        '<div style="font-size:9px;font-weight:700;color:#b8a070;letter-spacing:1px">' + (sN < 10 ? '0' : '') + sN + '</div>' +
        '<div style="font-size:12px;font-weight:600;color:#06113A">' + esc(d.l) + '</div>' +
        '<div style="flex:1;height:1px;background:#e8e5dd;margin-left:8px"></div></div>';
      if (ppn) out += '<div style="font-size:9px;color:#888;margin-bottom:8px;padding-left:22px;font-style:italic">' + esc(ppn) + '</div>';
      out += '<div style="padding:0 0 0 22px">';
      its.forEach(function (i, idx) {
        var last = idx === its.length - 1;
        var ma = i.cn && i.cn.indexOf('May apply') === 0;
        out += '<div style="display:flex;align-items:flex-start;gap:10px;padding:6px 0;' + (last ? '' : 'border-bottom:1px solid #f0ede6') + '">';
        out += '<div style="width:15px;height:15px;border:1.5px solid #888;border-radius:2px;flex-shrink:0;margin-top:1px"></div>';
        out += '<div style="flex:1"><div style="font-size:10px;color:#333">' + esc(i.n) + '</div>';
        if (i.nt) out += '<div style="font-size:9px;color:#aaa;margin-top:1px">' + esc(i.nt) + '</div>';
        if (i.cn) out += '<div style="font-size:9px;color:#b8a070;' + (ma ? 'font-weight:500;' : '') + 'margin-top:1px">' + esc(i.cn) + '</div>';
        out += '</div></div>';
      });
      out += '</div></div>';
    });

    var disc = type === 'generic'
      ? 'This checklist identifies standard documentation requirements. ARIE Finance may request additional information or documentation depending on the entity, ownership structure, jurisdiction, business activities and compliance review.'
      : 'This checklist reflects the information provided and is intended to assist with document preparation. ARIE Finance may request additional information or documentation following its review.';
    out += '<div style="padding-top:10px;margin-top:16px"><div style="font-size:8px;color:#aaa;line-height:1.6">' + disc + '</div></div>';

    out += '</div>';
    return out;
  }

  // Per-page footer injection via the jsPDF handle html2pdf exposes.
  function addFooters(pdf) {
    var total = pdf.internal.getNumberOfPages();
    var pageW = pdf.internal.pageSize.getWidth();
    var pageH = pdf.internal.pageSize.getHeight();
    for (var i = 1; i <= total; i++) {
      pdf.setPage(i);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6.5);
      pdf.setTextColor(170, 170, 170);
      // Top-of-footer rule, 10mm above the bottom edge.
      pdf.setDrawColor(232, 229, 221);
      pdf.setLineWidth(0.2);
      pdf.line(20, pageH - 14, pageW - 20, pageH - 14);
      // Corporate line, left-aligned.
      pdf.text(CORP_FOOTER, 20, pageH - 10);
      // Requirements version + page X of Y, right-aligned.
      pdf.text('Requirements v' + VER + ' · Page ' + i + ' of ' + total, pageW - 20, pageH - 5, { align: 'right' });
    }
  }

  function printPdf(type) {
    if (typeof window.html2pdf !== 'function') {
      alert('PDF generation is unavailable in this browser. Please contact ARIE Finance.');
      return;
    }
    var container = document.createElement('div');
    container.style.cssText = 'width:170mm;';
    container.innerHTML = printHtml(type);
    /* detached - html2pdf clones the node, no need to attach it to the live DOM */
    var safe = safeFilenamePart(state.companyName);
    var fname = type === 'generic'
      ? 'ARIE_Onboarding_Requirements_Checklist.pdf'
      : 'ARIE_Onboarding_Checklist_' + (safe || 'Company') + '.pdf';

    function cleanup() { try { document.body.removeChild(container); } catch (e) { /* ignore */ } }

    window.html2pdf()
      .set({
        margin: [15, 20, 22, 20], // extra bottom margin reserved for the per-page footer
        filename: fname,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#FAF9F6' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
      })
      .from(container)
      .toPdf()
      .get('pdf')
      .then(function (pdf) { try { addFooters(pdf); } catch (e) { /* footer is best-effort */ } })
      .save()
      .then(cleanup, function () { cleanup(); alert('PDF generation failed. Please try again.'); });
  }

  // ---------- wiring ----------
  function init() {
    // Landing CTAs
    on($('btn-view-reqs'), 'click', function () {
      var el = $('reqs-anchor');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    on($('btn-dl-generic-hero'), 'click', function () { printPdf('generic'); });
    on($('btn-dl-generic-bottom'), 'click', function () { printPdf('generic'); });
    on($('btn-open-modal'), 'click', function () { openModal(1); });

    // Preview CTAs
    on($('btn-back-landing'), 'click', function () { showView('landing'); });
    on($('btn-edit-details'), 'click', function () { openModal(1); });
    on($('btn-dl-personalised'), 'click', function () { printPdf('personalised'); });

    // Modal controls
    modal = $('gen-modal');
    on($('btn-modal-close'), 'click', closeModal);
    on($('btn-modal-back'), 'click', function () {
      if (state.modalStep === 2) { state.modalStep = 1; renderModal(); $('m-company').focus(); }
    });
    on($('btn-modal-next'), 'click', tryContinue);
    on($('btn-modal-gen'), 'click', tryGenerate);
    // Native <dialog> emits 'cancel' on Escape; 'close' when closed either way.
    on(modal, 'cancel', function () { /* let it close; focus-return happens in closeModal via click path */ });
    on(modal, 'close', function () { if (prevFocus && prevFocus.focus) prevFocus.focus(); });
    // Backdrop-click: close only when the click lands on the dialog element
    // itself (which fills the viewport around the shell).
    on(modal, 'click', function (e) { if (e.target === modal) closeModal(); });
    on($('m-company'), 'input', function (e) {
      state.companyName = e.target.value;
      if (state.nameErr && e.target.value.trim()) {
        state.nameErr = false;
        e.target.classList.remove('err');
        e.target.setAttribute('aria-invalid', 'false');
        $('m-company-err').classList.remove('show');
      }
    });
    on($('m-company'), 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); tryContinue(); } });

    showView('landing');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
