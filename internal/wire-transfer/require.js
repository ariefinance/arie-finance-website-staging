/* V1 requiredness model — replaces the prior CORE_FIELDS check.
   Generation is blocked only when a genuinely required field is missing.

   Required for normal TT V1:
     Remitter Name, Remitter Address, Contact Number, Payment Currency,
     Amount, Value Date, Amount in Words, Debit Account, Beneficiary Bank
     Name, Beneficiary Bank Address, SWIFT/BIC, Beneficiary Name,
     Beneficiary Address, Purpose, Charges selection, and
     Account Number OR IBAN (either present), and
     two standard signatories present.

   Conditional / normally blank (never block generation):
     Sort Code, Intermediary Bank, Import Loan. */
(function (root) {
  const REQUIRED_SIMPLE = [
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
    ["purpose",            "Purpose"],
    ["charges",            "Charges selection"]
  ];

  function isBlank(v) { return !String(v == null ? "" : v).trim(); }

  function missingFields(t) {
    const missing = [];
    for (const [k, label] of REQUIRED_SIMPLE) {
      if (isBlank(t[k])) missing.push(label);
    }
    // Account Number OR IBAN (at least one).
    if (isBlank(t.accountNumber) && isBlank(t.iban)) {
      missing.push("Account Number or IBAN");
    }
    // Two signatories present.
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

  const api = { REQUIRED_SIMPLE, missingFields, status };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ARIE_require = api;
})(typeof self !== "undefined" ? self : this);
