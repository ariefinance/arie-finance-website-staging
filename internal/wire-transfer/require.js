/* V1 requiredness model — a single source of truth for what blocks a
   MauBank wire-transfer PDF from being generated.

   Required for a normal TT V1 (both Account Number AND IBAN are required):
     Application Date, Remitter Name, Remitter Address (line 1),
     Contact Number, Payment Currency, Amount, Value Date,
     Amount in Words, Debit Account, Beneficiary Bank Name,
     Beneficiary Bank Address, SWIFT/BIC, Beneficiary Name,
     Beneficiary Address, Account Number, IBAN, Purpose, Charges
     selection, and two authorised signatories.

   Application Date defaults to today (Mauritius) on ingestion but if
   the user clears it, generation is blocked — the model does not read
   defaults, only the current value on the transaction.

   Conditional / normally blank (never block generation):
     Remitter Address (line 2), Sort Code, Intermediary Bank,
     Import Loan. */
(function (root) {
  const REQUIRED_SIMPLE = [
    ["applicationDate",    "Application Date"],
    ["client",             "Remitter Name"],
    ["address",            "Remitter Address"],
    ["contact",            "Contact Number"],
    ["currency",           "Payment Currency"],
    ["amount",             "Amount"],
    ["valueDate",          "Value Date"],
    ["amountWords",        "Amount in Words"],
    ["debitAccount",       "Debit Account"],
    ["beneficiaryBank",    "Beneficiary Bank Name"],
    ["bankAddress",        "Beneficiary Bank Address"],
    ["swift",              "SWIFT / BIC"],
    ["beneficiaryName",    "Beneficiary Name"],
    ["beneficiaryAddress", "Beneficiary Address"],
    ["accountNumber",      "Account Number"],
    ["iban",               "IBAN"],
    ["purpose",            "Purpose"],
    ["charges",            "Charges selection"]
  ];
  const REQUIRED_KEYS = new Set(REQUIRED_SIMPLE.map(x => x[0]));

  function isBlank(v) { return !String(v == null ? "" : v).trim(); }

  function missingFields(t) {
    const missing = [];
    for (const [k, label] of REQUIRED_SIMPLE) if (isBlank(t[k])) missing.push(label);
    const sigs = (t.signatories || []).filter(s => !isBlank(s));
    if (sigs.length < 2) missing.push("Two authorised signatories");
    return missing;
  }

  function status(t) {
    const m = missingFields(t);
    if (!m.length) return { cls: "ok", label: "Ready to generate" };
    if (m.length === 1) return { cls: "review", label: m[0] + " missing" };
    return { cls: "review", label: m.length + " required fields to complete" };
  }

  const api = { REQUIRED_SIMPLE, REQUIRED_KEYS, missingFields, status };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ARIE_require = api;
})(typeof self !== "undefined" ? self : this);
