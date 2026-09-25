// Reads the fee-schedule state that this tool embeds in every Client Fee Schedule .docx it exports.
//
// The state JSON is stored as base64 in Word custom document properties named ARIE_STATE_0..n
// (chunked, because Word caps a single custom property at 255 characters). Custom properties survive
// editing and saving in Word, so a CFS DOCX from days ago can be re-attached to a later Welcome Pack
// and the schedule is rendered again natively (PDF and DOCX) instead of being pasted as page images.
//
// A DOCX is a zip; this is the minimal reader needed for one entry (docProps/custom.xml), using the
// browser's DecompressionStream so no zip library is shipped.
(function () {
  'use strict';

  const PROP_PREFIX = 'ARIE_STATE_';
  const CHUNK = 200;

  function toChunks(obj) {
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    const out = [];
    for (let i = 0; i < b64.length; i += CHUNK) out.push({ name: PROP_PREFIX + (i / CHUNK), value: b64.slice(i, i + CHUNK) });
    return out;
  }

  // Inflate with a hard ceiling. The stream is read chunk by chunk and abandoned the moment the output
  // passes the limit, so a deflate bomb is stopped while it is expanding rather than after it has
  // allocated. Never call this without a limit.
  async function inflateRaw(bytes, limit) {
    const ds = new DecompressionStream('deflate-raw');
    const reader = new Blob([bytes]).stream().pipeThrough(ds).getReader();
    const chunks = []; let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { try { await reader.cancel(); } catch (e) { /* already closed */ } throw unsafe(); }
      chunks.push(value);
    }
    const out = new Uint8Array(total); let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  // A Builder Client Fee Schedule is a small file, and these two entries are the only ones this app ever
  // reads. Both ceilings are checked against the ZIP central directory BEFORE anything is inflated, so a
  // 40 KB .docx whose word/document.xml expands to 400 MB is refused without being decompressed.
  // ZIP64 is deliberately not supported: nothing this tool legitimately reads needs it, and the 32-bit
  // sentinel values are exactly how a crafted file hides its real sizes.
  const ENTRY_LIMIT = { 'docProps/custom.xml': 2 * 1048576, 'word/document.xml': 10 * 1048576 };
  const MAX_ENTRIES = 5000;      // a real .docx has tens of entries
  const MAX_RATIO = 200;         // deflate on XML rarely beats ~20:1
  const Z64 = 0xFFFFFFFF;
  function unsafe() {
    const e = new Error('This Word file contains an unusually large internal document and cannot be opened safely. Attach its final PDF instead.');
    e.unsafeZip = true; return e;
  }

  // Returns Uint8Array of the named entry, or null.
  async function zipEntry(arrayBuffer, wantedName) {
    const limit = ENTRY_LIMIT[wantedName] || 2 * 1048576;
    const u8 = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);
    const len = u8.length;
    // End of central directory
    let eocd = -1;
    for (let i = len - 22; i >= Math.max(0, len - 66000); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('Not a zip/docx file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const cdSize = dv.getUint32(eocd + 12, true);
    // ZIP64 sentinels, impossible counts, or a central directory outside the file: refuse, do not guess.
    if (count === 0xFFFF || p === Z64 || cdSize === Z64) throw unsafe();
    if (count > MAX_ENTRIES || p + 46 > len || p + cdSize > len) throw unsafe();
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (p + 46 > len || dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      if (p + 46 + nlen > len) throw unsafe();
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      if (name === wantedName) {
        if (csize === Z64 || usize === Z64 || lho === Z64) throw unsafe();
        if (usize > limit || csize > limit) throw unsafe();
        if (usize > csize * MAX_RATIO && csize > 0) throw unsafe();
        if (method === 0 && csize !== usize) throw unsafe();
        if (lho + 30 > len) throw unsafe();
        const ln = dv.getUint16(lho + 26, true), le = dv.getUint16(lho + 28, true);
        const start = lho + 30 + ln + le;
        if (start + csize > len) throw unsafe();
        const data = u8.slice(start, start + csize);
        if (method === 0) return data;
        if (method === 8) return await inflateRaw(data, limit);
        throw new Error('Unsupported zip compression ' + method);
      }
      p += 46 + nlen + elen + clen;
    }
    return null;
  }

  const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  // Visible body text of a docx (word/document.xml). Whitespace is removed entirely so that Word
  // re-splitting runs on save cannot change the fingerprint; only the characters count.
  async function bodyText(arrayBuffer) {
    const xml = await zipEntry(arrayBuffer, 'word/document.xml');
    if (!xml) return '';
    const text = new TextDecoder().decode(xml);
    const runs = []; const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g; let m;
    while ((m = re.exec(text))) runs.push(unxml(m[1]));
    return runs.join('').replace(/\s+/g, '');
  }

  // Deterministic fingerprint of the visible text (two independent 32-bit hashes + length).
  function fingerprint(text) {
    let h1 = 0x811c9dc5, h2 = 5381;
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = (Math.imul(h2, 33) + c) >>> 0; }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + '-' + text.length;
  }

  // Returns { state, storedFp, currentFp, edited } or null when the docx carries no embedded state.
  // edited === true means the visible text no longer matches what this tool generated: the state must not be reused.
  async function readDocxState(arrayBuffer) {
    const xml = await zipEntry(arrayBuffer, 'docProps/custom.xml');
    if (!xml) return null;
    const text = new TextDecoder().decode(xml);
    const parts = []; let storedFp = '';
    const re = /<property[^>]*name="(ARIE_STATE_(\d+)|ARIE_FP)"[^>]*>\s*<vt:lpwstr>([^<]*)<\/vt:lpwstr>/g;
    let m; while ((m = re.exec(text))) { if (m[1] === 'ARIE_FP') storedFp = unxml(m[3]); else parts.push({ i: +m[2], v: unxml(m[3]) }); }
    if (!parts.length) return null;
    parts.sort((a, b) => a.i - b.i);
    let state = null;
    try { state = JSON.parse(decodeURIComponent(escape(atob(parts.map(p => p.v).join(''))))); } catch (e) { return null; }
    const currentFp = fingerprint(await bodyText(arrayBuffer));
    return { state, storedFp, currentFp, edited: !storedFp || storedFp !== currentFp };
  }

  // Structural validation of an embedded schedule before it is handed to the renderer or the DOCX
  // exporter. A corrupted, hand-edited or older-format payload must fail here rather than half-render.
  // Deliberately a shape check, not a schema framework: no migrations, no versions to maintain.
  const BLOCK_SHAPE = {
    feeGrid: (b) => Array.isArray(b.profiles) && b.profiles.length <= MAX_PROFILES && b.profiles.every(p => p && typeof p === 'object' && str(p.label) && rows(p.fees) && p.fees.every(f => f && str(f.label) && str(f.value))),
    table: (b) => Array.isArray(b.columns) && b.columns.length <= MAX_ROWS && b.columns.every(str) && rows(b.rows) && b.rows.every(r => Array.isArray(r) && r.length <= MAX_ROWS && r.every(str)),
    feeList: (b) => rows(b.rows) && b.rows.every(r => r && str(r.label) && str(r.fee)),
    bullets: (b) => rows(b.items) && b.items.every(str),
    text: (b) => str(b.text)
  };
  // Returns { ok: true } or { ok: false, reason } — reason is shown to staff.
  // Caps so a malformed or hostile embedded state cannot build thousands of controls or a giant document.
  // These are far above any real Client Fee Schedule (the standard one has 6 sections).
  const MAX_BLOCKS = 50, MAX_PROFILES = 20, MAX_ROWS = 100, MAX_STR = 20000;
  const str = (x) => typeof x === 'string' && x.length <= MAX_STR;
  const rows = (x) => Array.isArray(x) && x.length <= MAX_ROWS;

  function validateFeeState(st) {
    if (!st || typeof st !== 'object' || Array.isArray(st)) return { ok: false, reason: 'the embedded schedule is not readable' };
    if (st.kind !== 'client') return { ok: false, reason: 'the embedded document is a ' + (st.kind === 'indicative' ? 'Indicative Fee Schedule' : st.kind === 'welcome' ? 'Welcome Pack' : 'different document type') + ', not a Client Fee Schedule', kind: st.kind || 'unknown' };
    if (st.clientFields !== true) return { ok: false, reason: 'the embedded document carries no client details' };
    for (const f of ['preparedFor', 'reference', 'date', 'title', 'subtitle', 'eyebrow', 'intro', 'note'])
      if (!str(st[f])) return { ok: false, reason: 'the embedded schedule is missing or over-long in "' + f + '"' };
    if (!Array.isArray(st.blocks) || !st.blocks.length) return { ok: false, reason: 'the embedded schedule has no sections' };
    if (st.blocks.length > MAX_BLOCKS) return { ok: false, reason: 'the embedded schedule has an implausible number of sections (' + st.blocks.length + ')' };
    for (const b of st.blocks) {
      if (!b || typeof b !== 'object' || !BLOCK_SHAPE[b.type]) return { ok: false, reason: 'the embedded schedule contains an unsupported section type (' + ((b && b.type) || 'none') + ')' };
      if (b.title !== undefined && !str(b.title)) return { ok: false, reason: 'a "' + b.type + '" section has a malformed title' };
      if (!BLOCK_SHAPE[b.type](b)) return { ok: false, reason: 'a "' + b.type + '" section in the embedded schedule is malformed' };
    }
    return { ok: true };
  }

  window.ARIE_DOCXIO = { toChunks, readDocxState, bodyText, fingerprint, validateFeeState, PROP_PREFIX };
})();
