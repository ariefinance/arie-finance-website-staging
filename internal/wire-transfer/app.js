/* ARIE Wire Transfer — single-page app (focused rebuild of the prior
   ARIE Operations shell). Browser-local; nothing is stored on the server. */
(function () {
  "use strict";

  const KNOWN_SIGNATORIES = ["Rajesh Shibdeen", "Avinash Rucktooa"];
  const state = { transactions: [], currentId: null, seq: 0, templateBytes: null };

  // Load the MauBank template once at boot (session-authenticated).
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
    ["address",            "Address",                 "area"],
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
    t.applicationDate = self.ARIE_pdf.todayMauritius(); // default to today (Mauritius)
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
        // Ensure amountWords is set from extracted amount if the extractor left it blank.
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
    try {
      await loadTemplate();
      const bytes = await self.ARIE_pdf.fillMaubankPdf(t, { templateBytes: state.templateBytes });
      download(new Blob([bytes], { type: "application/pdf" }), self.ARIE_pdf.pdfName(t));
    } catch (e) { alert("Could not generate the MauBank form: " + e.message); }
  }
  async function generateAll() {
    if (!state.transactions.length) return;
    try {
      await loadTemplate();
      if (state.transactions.length === 1) return generateOne(state.transactions[0]);
      const zip = new self.JSZip();
      for (const t of state.transactions) {
        const bytes = await self.ARIE_pdf.fillMaubankPdf(t, { templateBytes: state.templateBytes });
        zip.file(self.ARIE_pdf.pdfName(t), bytes);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      download(blob, `MauBank-WireTransfers_${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (e) { alert("Could not generate the batch: " + e.message); }
  }

  /* ---------- rendering ---------- */
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const $ = id => document.getElementById(id);

  function currentTxn() { return state.transactions.find(x => x.id === state.currentId); }

  function statusBadge(t) { return self.ARIE_require.status(t); }

  function fieldHtml(t, key) {
    const def = FIELDS.find(f => f[0] === key);
    const [k, label, type] = def;
    const val = esc(t[k]);
    const blank = !String(t[k] || "").trim();
    const cls = "field" + (blank ? " blankwarn" : "");
    if (type === "charges") {
      const opts = ["", "Applicant", "Beneficiary"].map(o =>
        `<option value="${o}" ${t[k] === o ? "selected" : ""}>${o || "— select —"}</option>`).join("");
      return `<div class="${cls}"><label>${label}</label>
        <select onchange="ARIE_app.setField('${k}',this.value)">${opts}</select>
        <div class="hint">Applicant / Beneficiary. A numeric "Charges: 0.0" in the email is ignored.</div></div>`;
    }
    if (type === "area") {
      const hint = k === "amountWords" ? `<div class="hint">Auto-derived from the amount — editable.</div>` : ``;
      return `<div class="${cls}"><label>${label}</label>
        <textarea oninput="ARIE_app.setField('${k}',this.value)">${val}</textarea>${hint}</div>`;
    }
    const recompute = (k === "amount" || k === "currency") ? "true" : "false";
    return `<div class="${cls}"><label>${label}</label>
      <input value="${val}" oninput="ARIE_app.setField('${k}',this.value,${recompute})" /></div>`;
  }

  function render() {
    const drop = $("dropCard");
    const detail = $("detailCard");
    const list = $("txList");
    const genAll = $("btnGenerateAll");
    const clearAll = $("btnClearAll");

    if (!state.transactions.length) {
      drop.classList.remove("hide");
      detail.classList.add("hide");
      list.innerHTML = "";
      genAll.disabled = clearAll.disabled = true;
      return;
    }

    drop.classList.remove("hide");
    detail.classList.remove("hide");
    genAll.disabled = clearAll.disabled = false;

    list.innerHTML = state.transactions.map(t => {
      const sb = statusBadge(t);
      const label = esc((t.beneficiaryName || "—") + " · " + (t.currency || "") + " " + (t.amount || ""));
      const src = esc(t.source);
      return `<li class="${t.id === state.currentId ? "active" : ""}" onclick="ARIE_app.select('${t.id}')">
        <div class="li-main"><div class="li-title">${label}</div>
          <div class="li-sub">${src}</div></div>
        <span class="status ${sb.cls}">${esc(sb.label)}</span>
      </li>`;
    }).join("");

    const t = currentTxn();
    if (!t) { detail.classList.add("hide"); return; }
    const sb = statusBadge(t);
    const groups = [
      ["Remitter", ["client","address","contact","debitAccount"]],
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
      ? `<div class="notice warn"><b>${missing.length}</b> required field${missing.length === 1 ? "" : "s"} to complete before generating: ${missing.map(esc).join(", ")}.</div>`
      : `<div class="notice ok">All required fields present.</div>`;

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
        <span class="status ${sb.cls}">${esc(sb.label)}</span>
        <button class="btn accent" onclick="ARIE_app.generateOne('${t.id}')" ${missing.length ? "disabled" : ""}>Download MauBank PDF</button>
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
  }

  /* ---------- events ---------- */
  const drop = () => $("drop");
  function initUpload() {
    const el = drop();
    const input = $("fileInput");
    el.onclick = () => input.click();
    input.onchange = e => { ingest(e.target.files); input.value = ""; };
    ["dragover","dragenter"].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.add("over"); }));
    ["dragleave","drop"].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.remove("over"); }));
    el.addEventListener("drop", e => { if (e.dataTransfer.files.length) ingest(e.dataTransfer.files); });
  }

  /* ---------- public actions (inline handlers) ---------- */
  const api = {
    select(id) { state.currentId = id; render(); },
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
      if (recompute) t.amountWords = self.ARIE_words.amountToWords(t.amount);
      render();
    },
    setSig(i, v) { const t = currentTxn(); if (t) { t.signatories[i] = v; render(); } },
    delSig(i)   { const t = currentTxn(); if (t) { t.signatories.splice(i, 1); render(); } },
    addSig()    { const t = currentTxn(); if (t) { t.signatories.push(""); render(); } },
    generateOne(id) { const t = state.transactions.find(x => x.id === id); if (t) generateOne(t); },
    generateAll
  };
  self.ARIE_app = api;

  /* ---------- boot after auth ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    initUpload();
    $("btnGenerateAll").onclick = generateAll;
    $("btnClearAll").onclick = api.clearAll;
    render();
  });
})();
