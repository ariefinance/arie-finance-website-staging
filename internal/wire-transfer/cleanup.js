/* Deterministic cleanup helpers.
   Only shape-preserving fixes — never guess missing content. */
(function (root) {
  function trimAll(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

  // "3rd Floor, KPMG Building, , Ebene, 124324" -> "3rd Floor, KPMG Building, Ebene, 124324"
  // Collapses runs of empty comma-separated fragments and trims stray whitespace
  // around commas. Idempotent.
  function cleanAddress(s) {
    s = trimAll(s);
    if (!s) return "";
    const parts = s.split(",").map(p => p.trim()).filter(p => p.length > 0);
    return parts.join(", ");
  }

  // "COMPUTER_SERVICES" -> "Computer services". Underscore / snake case -> sentence.
  // Leaves values already containing lowercase letters or explicit case alone.
  function cleanPurpose(s) {
    s = trimAll(s);
    if (!s) return "";
    if (!/_/.test(s) && /[a-z]/.test(s)) return s; // already mixed case
    const lower = s.replace(/_/g, " ").toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  const api = { trimAll, cleanAddress, cleanPurpose };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ARIE_cleanup = api;
})(typeof self !== "undefined" ? self : this);
