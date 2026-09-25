/* Label-driven extraction (recovered from the prior prototype, with the
   ARIE aliases retained: Sender Name → client, Transfer Currency → currency, etc.).
   Never guesses. Source Amount / Source Currency are deliberately NOT mapped
   over Transfer Amount / Transfer Currency. */
(function (root) {
  const LABELS = {
    "remitter": "client", "client": "client", "applicant": "client",
    "ordering customer": "client", "account holder": "client",
    "remitter address": "address", "client address": "address",
    "applicant address": "address", "address": "address",
    "contact number": "contact", "telephone": "contact", "phone": "contact",
    "tel": "contact", "mobile": "contact", "contact": "contact",
    "currency": "currency", "ccy": "currency",
    "amount": "amount", "value": "amount", "sum": "amount",
    "debit account": "debitAccount", "account to debit": "debitAccount",
    "debit a/c": "debitAccount", "source account": "debitAccount",
    "application date": "applicationDate", "date of application": "applicationDate",
    "instruction date": "applicationDate",
    "value date": "valueDate", "settlement date": "valueDate",
    "beneficiary name": "beneficiaryName", "beneficiary": "beneficiaryName",
    "payee": "beneficiaryName", "pay to": "beneficiaryName",
    "beneficiary address": "beneficiaryAddress", "payee address": "beneficiaryAddress",
    "beneficiary bank": "beneficiaryBank", "bank name": "beneficiaryBank",
    "receiving bank": "beneficiaryBank", "bank": "beneficiaryBank",
    "bank address": "bankAddress", "beneficiary bank address": "bankAddress",
    "swift": "swift", "swift code": "swift", "bic": "swift",
    "swift/bic": "swift", "swift / bic": "swift",
    "sort code": "sortCode", "sort code / routing": "sortCode",
    "routing": "sortCode", "routing number": "sortCode",
    "account number": "accountNumber", "account no": "accountNumber",
    "a/c no": "accountNumber", "account": "accountNumber", "account no.": "accountNumber",
    "iban": "iban",
    "intermediary bank": "intermediaryBank", "correspondent bank": "intermediaryBank",
    "via bank": "intermediaryBank",
    "purpose": "purpose", "purpose of payment": "purpose", "reason": "purpose",
    "details of payment": "purpose", "remittance information": "purpose",
    "charges": "charges", "charge": "charges", "bank charges": "charges",
    "details of charges": "charges",
    "country": "country", "reference": "reference",
    // ARIE cross-border request aliases:
    "sender name": "client", "sender account number": "debitAccount",
    "transfer currency": "currency", "transfer amount": "amount",
    "beneficiary bank name": "beneficiaryBank",
    "beneficiary account number": "accountNumber", "beneficiary iban": "iban"
    // "Source Amount" / "Source Currency" are deliberately absent —
    // the beneficiary leg (Transfer Amount / Transfer Currency) always wins.
  };

  const cu = (typeof require === "function")
    ? require("./cleanup.js")
    : (typeof self !== "undefined" ? self.ARIE_cleanup : null);
  const wo = (typeof require === "function")
    ? require("./words.js")
    : (typeof self !== "undefined" ? self.ARIE_words : null);

  function normaliseKey(k) {
    return k.toLowerCase().replace(/\s+/g, " ").replace(/\*+/g, "").trim();
  }

  function extractFields(txn, parsed) {
    const text = String((parsed && parsed.text) || "");
    const lines = text.replace(/\r/g, "").split("\n");
    const found = {};
    for (const raw of lines) {
      const line = raw.trim();
      const ci = line.indexOf(":");
      if (ci < 1) continue;
      const rawKey = line.slice(0, ci).trim();
      const key = normaliseKey(rawKey);
      const val = line.slice(ci + 1).trim();
      if (!val) continue;
      const field = LABELS[key];
      if (field && !(field in found)) found[field] = val;
    }
    Object.keys(found).forEach(k => { txn[k] = cu.trimAll(found[k]); });

    // "USD 12,500.00" style: split into currency + amount when currency empty.
    if (txn.amount) {
      const m = txn.amount.match(/^([A-Za-z]{3})\s*([0-9.,]+)$/);
      if (m) { if (!txn.currency) txn.currency = m[1].toUpperCase(); txn.amount = m[2]; }
    }
    if (txn.currency) txn.currency = txn.currency.toUpperCase().slice(0, 3);
    if (txn.swift) txn.swift = txn.swift.toUpperCase().replace(/\s+/g, "");
    if (txn.iban) txn.iban = txn.iban.toUpperCase().replace(/\s+/g, "");

    // Cleanup rules per V1: deterministic address / purpose only.
    if (txn.beneficiaryAddress) txn.beneficiaryAddress = cu.cleanAddress(txn.beneficiaryAddress);
    if (txn.address) txn.address = cu.cleanAddress(txn.address);
    if (txn.bankAddress) txn.bankAddress = cu.cleanAddress(txn.bankAddress);
    if (txn.purpose) txn.purpose = cu.cleanPurpose(txn.purpose);

    // Charges: MauBank field only accepts "Applicant" or "Beneficiary".
    // A numeric value like "0.0" leaves it BLANK (staff choose manually).
    if (txn.charges) {
      const c = txn.charges.toLowerCase();
      txn.charges = /applicant|remitter/.test(c) ? "Applicant"
                  : /beneficiary/.test(c) ? "Beneficiary" : "";
    }

    // Amount-in-words derived from provided amount (transformation, not a guess).
    if (txn.amount && !txn.amountWords) txn.amountWords = wo.amountToWords(txn.amount);
    return txn;
  }

  const api = { extractFields, LABELS, normaliseKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ARIE_extract = api;
})(typeof self !== "undefined" ? self : this);
