/* Pure helpers used by the app: which fields are optional (so blank
   optional inputs are not styled as errors), whether the batch is
   ready to generate, and unique-name allocation for ZIP entries.

   Pure functions only — no DOM. Testable in Node. */
(function (root) {
  const OPTIONAL_FIELDS = new Set([
    "address2",         // Remitter Address (line 2)
    "sortCode",         // Sort Code — only when explicitly provided
    "intermediaryBank"  // Intermediary Bank — only when applicable
  ]);

  function isOptional(k) { return OPTIONAL_FIELDS.has(k); }

  // batchReadiness: does every loaded transaction have every required
  // field? Returns the ready flag plus the list of incomplete
  // transactions with their missing fields (used to name the offenders
  // when the batch button is pressed).
  function batchReadiness(txns, req) {
    const incomplete = [];
    for (const t of txns || []) {
      const missing = req.missingFields(t);
      if (missing.length) {
        incomplete.push({
          id: t.id,
          label: (t.beneficiaryName || t.source || "Untitled").toString(),
          missing
        });
      }
    }
    return { ready: (txns || []).length > 0 && incomplete.length === 0, incomplete };
  }

  // dedupeName: register `base` against a Set of already-used names.
  // Returns `base` when unused; otherwise `base_2`, `base_3`, …
  // preserving any file extension. `used` is mutated in place.
  function dedupeName(base, used) {
    if (!used.has(base)) { used.add(base); return base; }
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    let n = 2;
    while (used.has(stem + "_" + n + ext)) n++;
    const out = stem + "_" + n + ext;
    used.add(out);
    return out;
  }

  const api = { OPTIONAL_FIELDS, isOptional, batchReadiness, dedupeName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ARIE_state = api;
})(typeof self !== "undefined" ? self : this);
