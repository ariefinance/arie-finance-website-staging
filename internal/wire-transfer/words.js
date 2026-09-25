/* Amount-in-words engine (recovered from the prior prototype, unchanged).
   Convention: words only, no currency prefix, no trailing "ONLY";
   include cents only when non-zero. */
(function (root) {
  const ONES = ["","ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT","NINE","TEN","ELEVEN","TWELVE",
    "THIRTEEN","FOURTEEN","FIFTEEN","SIXTEEN","SEVENTEEN","EIGHTEEN","NINETEEN"];
  const TENS = ["","","TWENTY","THIRTY","FORTY","FIFTY","SIXTY","SEVENTY","EIGHTY","NINETY"];
  function threeDigits(n) {
    let s = "";
    if (n > 99) { s += ONES[Math.floor(n / 100)] + " HUNDRED"; n %= 100; if (n) s += " AND "; }
    if (n > 19) { s += TENS[Math.floor(n / 10)]; if (n % 10) s += "-" + ONES[n % 10]; }
    else if (n > 0) { s += ONES[n]; }
    return s;
  }
  function intToWords(n) {
    if (n === 0) return "ZERO";
    const scales = ["","THOUSAND","MILLION","BILLION","TRILLION"];
    let parts = [], i = 0;
    while (n > 0) {
      const c = n % 1000;
      if (c) parts.unshift(threeDigits(c) + (scales[i] ? " " + scales[i] : ""));
      n = Math.floor(n / 1000);
      i++;
    }
    return parts.join(" ").trim();
  }
  function amountToWords(amountStr) {
    const raw = String(amountStr || "").replace(/[, ]/g, "");
    if (!raw || isNaN(Number(raw))) return "";
    const num = Number(raw);
    const whole = Math.floor(num);
    const cents = Math.round((num - whole) * 100);
    let w = intToWords(whole);
    if (cents > 0) w += " AND " + intToWords(cents) + " CENTS";
    return w.replace(/\s+/g, " ").trim();
  }
  const api = { amountToWords, intToWords, threeDigits };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ARIE_words = api;
})(typeof self !== "undefined" ? self : this);
