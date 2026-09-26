/* MauBank TT/DD PDF fill (recovered from the prior prototype, retained
   mapping verified against the current template).

   Corrections applied from the review:
     - Application date written as DD/MM/YYYY (full year in Text3).
     - TT marker drawn as an overlay glyph at a verified coordinate on
       page 1 (no AcroForm field exists for TT/DD).
     - Output stays editable (no flatten, NeedAppearances set true).
     - Page 2 (Terms & Conditions) is never touched — no widgets on it,
       no drawing operations.
*/
(function (root) {
  // app field -> MauBank AcroForm field name (verified against the
  // current blank template's 56-widget page 1 layout).
  const PDF_MAP = {
    client:             "undefined",              // Account Name (remitter)
    address:            "undefined_2",            // Remitter Address line 1
    address2:           "Address",                // Remitter Address line 2 (widget name is "Address")
    contact:            "Contact No",             // Contact number
    currency:           "Payment currency",
    amount:             "Amount",
    valueDate:          "Value Date",
    amountWords:        "Amount in Words",
    debitAccount:       "undefined_3",            // In payment, please debit account number
    beneficiaryBank:    "BENEFICIARY BANK DETAILS", // widget name is misleading — this IS the Ben Bank Name field
    bankAddress:        "undefined_4",            // Ben Bank Address
    swift:              "BENEFICIARY CUSTOMER DETAILS", // widget name is misleading — this IS the SWIFT field
    sortCode:           "Sort Code if any",
    beneficiaryName:    "undefined_5",
    beneficiaryAddress: "undefined_6",
    accountNumber:      "Account Number",
    iban:               "Text4",
    purpose:            "undefined_7"
  };

  // Intermediary Bank per-character row (left→right).
  // Note the current template omits Text20 and Text21.
  const INT_BOXES = [
    "Text7","Text8","Text9","Text10","Text11","Text12","Text13",
    "Text14","Text15","Text16","Text17","Text18","Text19","Text22","Text23","Text24",
    "Text25","Text26","Text27","Text28","Text29","Text30","Text31","Text32","Text33",
    "Text34","Text35","Text36","Text37","Text38"
  ];

  const MONTHS = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06",
                   jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };
  function pad2(x) { x = String(x); return x.length < 2 ? "0" + x : x; }

  // Parse a date string into DD / MM / YYYY components. Never guesses:
  // unrecognised formats leave all three blank.
  function splitDate(s) {
    s = String(s || "").trim();
    if (!s) return { day: "", month: "", year: "" };
    let m = s.match(/^(\d{1,2})[\/\-.\s]+(\d{1,2})[\/\-.\s]+(\d{4})$/); // DD/MM/YYYY
    if (m) return { day: pad2(m[1]), month: pad2(m[2]), year: m[3] };
    m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);           // YYYY-MM-DD
    if (m) return { day: pad2(m[3]), month: pad2(m[2]), year: m[1] };
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);              // D Month YYYY
    if (m) { const mo = MONTHS[m[2].toLowerCase().slice(0, 3)]; if (mo) return { day: pad2(m[1]), month: mo, year: m[3] }; }
    return { day: "", month: "", year: "" };
  }

  // Today in Mauritius (UTC+4, no DST). Returns "DD/MM/YYYY".
  function todayMauritius(now) {
    const d = new Date(((now || new Date()).getTime()) + 4 * 3600 * 1000);
    const dd = pad2(d.getUTCDate());
    const mm = pad2(d.getUTCMonth() + 1);
    const yyyy = String(d.getUTCFullYear());
    return `${dd}/${mm}/${yyyy}`;
  }

  function joinSigs(sigs) {
    const arr = (sigs || []).filter(Boolean);
    if (arr.length === 0) return "";
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return arr[0].padEnd(38) + arr[1];
    return arr.join("      ");
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  // TT / DD tick: no AcroForm field exists for this. Draw a small "X"
  // to the LEFT of the printed "TT/" label at a fixed page-1 coordinate.
  // Coordinate x=54, y=746 sits in the margin immediately before the
  // "TT/ DD" label (visible on the rendered template).
  const TT_OVERLAY = { x: 54, y: 746, size: 11 };

  async function fillMaubankPdf(t, opts) {
    opts = opts || {};
    const PDFLib = (typeof self !== "undefined" && self.PDFLib)
      ? self.PDFLib
      : (typeof require === "function" ? require("pdf-lib") : null);
    if (!PDFLib) throw new Error("PDF engine not loaded");
    const templateBytes = opts.templateBytes
      || (typeof self !== "undefined" && self.MAUBANK_TEMPLATE_BYTES);
    if (!templateBytes) throw new Error("MauBank template not loaded");

    const doc = await PDFLib.PDFDocument.load(templateBytes);
    const form = doc.getForm();

    const set = (name, val) => {
      try { const f = form.getTextField(name); f.setFontSize(10); f.setText(val == null ? "" : String(val)); }
      catch (e) { /* field absent — safe no-op */ }
    };

    // Straightforward text fields.
    for (const [k, f] of Object.entries(PDF_MAP)) set(f, t[k] || "");

    // Application date — full year DD/MM/YYYY (Text1=DD, Text2=MM, Text3=YYYY).
    const src = t.applicationDate || todayMauritius();
    const d = splitDate(src);
    set("Text1", d.day); set("Text2", d.month); set("Text3", d.year);

    // Charges: blank ships with a pre-populated Applicant "X". Clear both,
    // then set exactly one based on the transaction's manual selection.
    set("Text5", ""); set("Text6", "");
    if (t.charges === "Applicant")        set("Text5", "    X");
    else if (t.charges === "Beneficiary") set("Text6", "    X");

    // Authorised signatories (single field, two-column layout).
    set("prevailing Terms and Conditions overleaf", joinSigs(t.signatories));

    // Intermediary bank -> per-character boxes; blank leaves every box empty.
    const chars = String(t.intermediaryBank || "").split("");
    INT_BOXES.forEach((box, i) => set(box, chars[i] || ""));

    // TT / DD tick — overlay on page 1 only. Never touch page 2 (T&C).
    const helv = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const page1 = doc.getPage(0);
    page1.drawText("X", { x: TT_OVERLAY.x, y: TT_OVERLAY.y, size: TT_OVERLAY.size, font: helv });

    // Keep the form editable: do NOT flatten. Ask viewers to (re)render values.
    try { form.updateFieldAppearances(); } catch (e) { /* no-op */ }
    try { form.acroForm.dict.set(PDFLib.PDFName.of("NeedAppearances"), PDFLib.PDFBool.True); } catch (e) { /* no-op */ }
    return await doc.save();
  }

  function pdfName(t) {
    const who = (t.beneficiaryName || t.client || "transfer")
      .replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "transfer";
    return `MauBank-TT_${who}_${new Date().toISOString().slice(0, 10)}.pdf`;
  }

  const api = { fillMaubankPdf, pdfName, splitDate, joinSigs, todayMauritius,
                b64ToBytes, PDF_MAP, INT_BOXES, TT_OVERLAY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ARIE_pdf = api;
})(typeof self !== "undefined" ? self : this);
