/* ARIE Wire Transfer — single-page app. Browser-local; nothing is
   stored on the server. */
(function () {
  "use strict";

  const KNOWN_SIGNATORIES = ["Rajesh Shibdeen", "Avinash Rucktooa"];
  const state = { transactions: [], currentId: null, seq: 0, templateBytes: null, detailRenderStamp: 0 };

  async function loadTemplate() {
    if (state.templateBytes) return state.templateBytes;
    const r = await fetch("assets/maubank-tt-dd.pdf", { credentials: "same-origin" });
    if (!r.ok) throw new Error("Could not load MauBank template (" + r.status + ")");
    const buf = await r.arrayBuffer();
    state.templateBytes = new Uint8Array(buf);
    self.MAUBANK_TEMPLATE_BYTES = state.templateBytes;
    return state.templateBytes;
  }

  const FIELDS = [
    ["client",             "Client / Remitter",       "text"],
    ["address",            "Remitter Address (line 1)", "area"],
    ["address2",           "Remitter Address (line 2)", "area"],
    ["contact",            "Contact Number",          "text"],
    ["debitAccount",       "Debit Account",           "text"],
    ["applicationDate",    "Application Date",        "text"],
    ["currency",           "Currency",                "text"],
    ["amount",             "Amount",                  "text"],
    ["amountWords",        "Amount in Words",         "area"],
    ["valueDate",          "Value Date",              "text"],
    ["purpose",            "Purpose",                 "area"],
    ["charges",            "Charges",                 "charges"],
    ["beneficiaryName",    "Beneficiary Name",        "text"],
    ["beneficiaryAddress", "Beneficiary Address",     "area"],
    ["accountNumber",      "Account Number",          "text"],
    ["iban",               "IBAN",                    "text"],
    ["beneficiaryBank",    "Beneficiary Bank",        "text"],
    ["bankAddress",        "Bank Address",            "area"],
    ["swift",              "SWIFT / BIC",             "text"],
    ["sortCode",           "Sort Code",               "text"],
    ["intermediaryBank",   "Intermediary Bank",       "text"]
  ];

  function newTxn(source) {
    const t = { id: "t" + (++state.seq), source, signatories: KNOWN_SIGNATORIES.slice(), country: "", reference: "" };
    FIELDS.forEach(f => t[f[0]] = "");
    t.applicationDate = self.ARIE_pdf.todayMauritius();
    return t;
  }

  /* ---------- file I/O ---------- */
  function readText(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); }); }
  function readBuf(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file); }); }

  async function ingest(files) {
    const list = [].filter.call(files, f => /\.(msg|eml)$/i.test(f.name));
    if (!list.length) { alert("Please upload .msg or .eml files."); return; }
    for (const f of list) {
      const t = newTxn(f.name);
      try {
        const parsed = /\.eml$/i.test(f.name)
          ? self.ARIE_parser.parseEml(await readText(f))
          : self.ARIE_parser.parseMsgBuffer(await readBuf(f));
        self.ARIE_extract.extractFields(t, parsed);
        if (t.amount && !t.amountWords) t.amountWords = self.ARIE_words.amountToWords(t.amount);
      } catch (e) {
        t._error = "Could not read this file automatically — fill in manually.";
      }
      state.transactions.push(t);
    }
    if (!state.currentId && state.transactions.length) state.currentId = state.transactions[0].id;
    render();
  }

  /* ---------- generation ---------- */
  function download(blob, name) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  }

  async function generateOne(t) {
    const missing = self.ARIE_require.missingFields(t);
    if (missing.length) {
      alert(
        "Cannot generate this transaction — " + missing.length + " required field" +
        (missing.length === 1 ? "" : "s") + " to complete:\n\n" +
        missing.map(m => "• " + m).join("\n")
      );
      return;
    }
    try {
      await loadTemplate();
      const bytes = await self.ARIE_pdf.fillMaubankPdf(t, { templateBytes: state.templateBytes });
      download(new Blob([bytes], { type: "application/pdf" }), self.ARIE_pdf.pdfName(t));
    } catch (e) { alert("Could not generate the MauBank form: " + e.message); }
  }

  async function generateAll() {
    if (!state.transactions.length) return;
    const ready = self.ARIE_state.batchReadiness(state.transactions, self.ARIE_require);
    if (!ready.ready) {
      const listStr = ready.incomplete.map(x =>
        "• " + x.label + " — " + x.missing.length + " field" + (x.missing.length === 1 ? "" : "s")
      ).join("\n");
      alert(
        "Cannot generate the batch — the following transaction" +
        (ready.incomplete.length === 1 ? " is" : "s are") + " incomplete:\n\n" + listStr +
        "\n\nOpen each incomplete transaction, fill every required field, then try again."
      );
      return;
    }
    try {
      await loadTemplate();
      if (state.transactions.length === 1) return generateOne(state.transactions[0]);
      const zip = new self.JSZip();
      const used = new Set();
      for (const t of state.transactions) {
        const bytes = await self.ARIE_pdf.fillMaubankPdf(t, { templateBytes: state.templateBytes });
        const name = self.ARIE_state.dedupeName(self.ARIE_pdf.pdfName(t), used);
        zip.file(name, bytes);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      download(blob, `MauBank-WireTransfers_${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (e) { alert("Could not generate the batch: " + e.message); }
  }

  /* ---------- rendering ---------- */
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const $ = id => document.getElementById(id);
  const isBlank = v => !String(v == null ? "" : v).trim();

  function currentTxn() { return state.transactions.find(x => x.id === state.currentId); }
  function statusBadge(t) { return self.ARIE_require.status(t); }

  function fieldHtml(t, key) {
    const def = FIELDS.find(f => f[0] === key);
    const [k, label, type] = def;
    const optional = self.ARIE_state.isOptional(k);
    const val = esc(t[k]);
    const blank = isBlank(t[k]);
    const cls = "field" + (!optional && blank ? " blankwarn" : "");
    const optHint = '<div class="hint">Optional / if applicable</div>';

    if (type === "charges") {
      const opts = ["", "Applicant", "Beneficiary"].map(o =>
        `<option value="${o}" ${t[k] === o ? "selected" : ""}>${o || "— select —"}</option>`).join("");
      return `<div class="${cls}" data-field="${k}"><label>${label}</label>
        <select data-field-input="${k}" onchange="ARIE_app.setField('${k}',this.value)">${opts}</select>
        <div class="hint">Applicant / Beneficiary. A numeric "Charges: 0.0" in the email is ignored.</div></div>`;
    }
    if (type === "area") {
      const hint = k === "amountWords"
        ? '<div class="hint">Auto-derived from the amount — editable.</div>'
        : (optional ? optHint : "");
      return `<div class="${cls}" data-field="${k}"><label>${label}</label>
        <textarea data-field-input="${k}" oninput="ARIE_app.setField('${k}',this.value)">${val}</textarea>${hint}</div>`;
    }
    const recompute = (k === "amount" || k === "currency") ? "true" : "false";
    const hint = optional ? optHint : "";
    return `<div class="${cls}" data-field="${k}"><label>${label}</label>
      <input data-field-input="${k}" value="${val}" oninput="ARIE_app.setField('${k}',this.value,${recompute})" />${hint}</div>`;
  }

  /* full render (list + detail) */
  function render() { renderList(); renderDetail(); }

  function renderList() {
    const drop = $("dropCard");
    const detail = $("detailCard");
    const list = $("txList");
    const genAll = $("btnGenerateAll");
    const clearAll = $("btnClearAll");
    if (!list) return;

    if (!state.transactions.length) {
      if (drop) drop.classList.remove("hide");
      if (detail) detail.classList.add("hide");
      list.innerHTML = "";
      if (genAll) genAll.disabled = true;
      if (clearAll) clearAll.disabled = true;
      return;
    }
    if (drop) drop.classList.remove("hide");
    if (detail) detail.classList.remove("hide");
    if (clearAll) clearAll.disabled = false;

    const ready = self.ARIE_state.batchReadiness(state.transactions, self.ARIE_require);
    if (genAll) genAll.disabled = !ready.ready;

    list.innerHTML = state.transactions.map(t => {
      const sb = statusBadge(t);
      const label = esc((t.beneficiaryName || "—") + " · " + (t.currency || "") + " " + (t.amount || ""));
      const src = esc(t.source);
      return `<li data-id="${t.id}" class="${t.id === state.currentId ? "active" : ""}" onclick="ARIE_app.select('${t.id}')">
        <div class="li-main"><div class="li-title">${label}</div><div class="li-sub">${src}</div></div>
        <span class="status ${sb.cls}" data-slot="row-status">${esc(sb.label)}</span>
      </li>`;
    }).join("");
  }

  function renderDetail() {
    state.detailRenderStamp++;
    const detail = $("detailCard");
    const t = currentTxn();
    if (!detail) return;
    if (!t) { detail.classList.add("hide"); detail.innerHTML = ""; return; }
    detail.classList.remove("hide");

    const sb = statusBadge(t);
    const groups = [
      ["Remitter", ["client","address","address2","contact","debitAccount"]],
      ["Payment",  ["applicationDate","currency","amount","amountWords","valueDate","purpose","charges"]],
      ["Beneficiary", ["beneficiaryName","beneficiaryAddress","accountNumber","iban"]],
      ["Beneficiary Bank", ["beneficiaryBank","bankAddress","swift","sortCode","intermediaryBank"]]
    ];
    const sec = groups.map(([title, keys]) => `
      <div class="sec-title">${title}</div>
      <div class="grid">${keys.map(k => fieldHtml(t, k)).join("")}</div>
    `).join("");

    const sigRows = (t.signatories || []).map((s, i) => `<div class="sig-row">
      <input value="${esc(s)}" oninput="ARIE_app.setSig(${i},this.value)" placeholder="Signatory name" />
      <button class="btn small danger" onclick="ARIE_app.delSig(${i})">Remove</button>
    </div>`).join("");

    const missing = self.ARIE_require.missingFields(t);
    const missingHtml = missing.length
      ? `<div class="notice warn" data-slot="missing"><b>${missing.length}</b> required field${missing.length === 1 ? "" : "s"} to complete before generating: ${missing.map(esc).join(", ")}.</div>`
      : `<div class="notice ok" data-slot="missing">All required fields present.</div>`;

    const ctx = (t.country || t.reference)
      ? `<div class="notice ctx"><b>Email context (not written to the form):</b>
           ${t.country    ? "Country: " + esc(t.country) + ".&nbsp;&nbsp;"    : ""}
           ${t.reference  ? "Reference: " + esc(t.reference) + "."             : ""}
         </div>` : "";

    detail.innerHTML = `
      <div class="toolbar">
        <div class="title-row">
          <h2>${esc((t.beneficiaryName || t.source))}</h2>
          <span class="pill">${esc(t.source)}</span>
        </div>
        <div class="spacer"></div>
        <span class="status ${sb.cls}" data-slot="status">${esc(sb.label)}</span>
        <button class="btn accent" data-slot="gen-one" onclick="ARIE_app.generateOne('${t.id}')" ${missing.length ? "disabled" : ""}>Download MauBank PDF</button>
        <button class="btn danger" onclick="ARIE_app.remove('${t.id}')">Remove</button>
      </div>
      ${t._error ? `<div class="notice warn">${esc(t._error)}</div>` : ""}
      ${ctx}
      ${missingHtml}
      ${sec}
      <div class="sec-title">Authorised Signatories</div>
      ${sigRows}
      <button class="btn small secondary" onclick="ARIE_app.addSig()">+ Add signatory</button>
    `;
    updateFeedback();
  }

  /* Feedback update that leaves inputs mounted and focused.
     Called on every keystroke and every non-structural mutation. */
  function updateFeedback() {
    const t = currentTxn();
    // Batch controls (left rail).
    const genAll = $("btnGenerateAll");
    if (genAll) {
      const ready = self.ARIE_state.batchReadiness(state.transactions, self.ARIE_require);
      genAll.disabled = !ready.ready;
    }
    if (!t) return;

    // Row-status pill in the left rail.
    const row = document.querySelector('#txList li[data-id="' + t.id + '"] [data-slot="row-status"]');
    const sb = statusBadge(t);
    if (row) {
      row.textContent = sb.label;
      row.className = "status " + sb.cls;
      row.setAttribute("data-slot", "row-status");
    }

    // Detail-card badge + missing notice + per-txn generate button.
    const badge = document.querySelector('#detailCard [data-slot="status"]');
    if (badge) {
      badge.textContent = sb.label;
      badge.className = "status " + sb.cls;
      badge.setAttribute("data-slot", "status");
    }
    const missing = self.ARIE_require.missingFields(t);
    const notice = document.querySelector('#detailCard [data-slot="missing"]');
    if (notice) {
      notice.innerHTML = missing.length
        ? '<b>' + missing.length + '</b> required field' + (missing.length === 1 ? "" : "s") +
          ' to complete before generating: ' + missing.map(esc).join(", ") + '.'
        : "All required fields present.";
      notice.className = "notice " + (missing.length ? "warn" : "ok");
      notice.setAttribute("data-slot", "missing");
    }
    const genOne = document.querySelector('#detailCard [data-slot="gen-one"]');
    if (genOne) genOne.disabled = missing.length > 0;

    // .blankwarn class on each field wrapper (required + blank only).
    document.querySelectorAll('#detailCard .field[data-field]').forEach(wrap => {
      const k = wrap.getAttribute("data-field");
      const optional = self.ARIE_state.isOptional(k);
      const blank = isBlank(t[k]);
      wrap.classList.toggle("blankwarn", !optional && blank);
    });
  }

  /* ---------- events ---------- */
  function initUpload() {
    const el = $("drop");
    const input = $("fileInput");
    if (!el || !input) return;
    el.onclick = () => input.click();
    input.onchange = e => { ingest(e.target.files); input.value = ""; };
    ["dragover","dragenter"].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.add("over"); }));
    ["dragleave","drop"].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.remove("over"); }));
    el.addEventListener("drop", e => { if (e.dataTransfer.files.length) ingest(e.dataTransfer.files); });
  }

  /* ---------- public actions ---------- */
  const api = {
    select(id) {
      state.currentId = id;
      render();
    },
    remove(id) {
      state.transactions = state.transactions.filter(t => t.id !== id);
      if (state.currentId === id) state.currentId = state.transactions.length ? state.transactions[0].id : null;
      render();
    },
    clearAll() {
      if (!state.transactions.length) return;
      if (confirm("Clear all transactions and start fresh?")) {
        state.transactions = []; state.currentId = null; render();
      }
    },
    setField(k, v, recompute) {
      const t = currentTxn(); if (!t) return;
      t[k] = v;
      if (recompute) {
        t.amountWords = self.ARIE_words.amountToWords(t.amount);
        const ta = document.querySelector('#detailCard [data-field-input="amountWords"]');
        if (ta && ta.value !== t.amountWords) ta.value = t.amountWords;
      }
      updateFeedback();
    },
    setSig(i, v) {
      const t = currentTxn(); if (!t) return;
      t.signatories[i] = v;
      updateFeedback();
    },
    delSig(i) {
      const t = currentTxn(); if (!t) return;
      t.signatories.splice(i, 1);
      renderDetail();
    },
    addSig() {
      const t = currentTxn(); if (!t) return;
      t.signatories.push("");
      renderDetail();
    },
    generateOne(id) { const t = state.transactions.find(x => x.id === id); if (t) generateOne(t); },
    generateAll,
    // Test-only handles. Not part of the public surface.
    _debug: { state, currentTxn, render, renderList, renderDetail, updateFeedback, newTxn, FIELDS }
  };
  self.ARIE_app = api;

  /* ---------- boot ---------- */
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("DOMContentLoaded", () => {
      initUpload();
      const g = $("btnGenerateAll"); if (g) g.onclick = generateAll;
      const c = $("btnClearAll");    if (c) c.onclick = api.clearAll;
      render();
    });
  }
})();
