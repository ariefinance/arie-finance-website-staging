// ============================================================================
//  ARIE Finance — website form handler   (Vercel serverless function)
//  Route:  POST /api/website-form
//  Delivers Contact and Careers submissions to customercare@ariefinance.com
//  via SMTP (Nodemailer). No credentials are ever exposed to the browser.
// ----------------------------------------------------------------------------
//  REQUIRED ENVIRONMENT VARIABLES (set in Vercel → Project → Settings → Env):
//    SMTP_HOST         SMTP server host
//    SMTP_PORT         465 (secure) | 587 (STARTTLS)
//    SMTP_SECURE       "true" for 465, "false" for 587
//    SMTP_USER         SMTP username / login
//    SMTP_PASS         SMTP password / API key            (secret)
//    FORM_FROM_EMAIL   verified sender, e.g. no-reply@ariefinance.com
//    FORM_TO_EMAIL     recipient — customercare@ariefinance.com
//    ALLOWED_ORIGIN    comma-separated production origins, e.g.
//                      https://ariefinance.com,https://www.ariefinance.com
//  OPTIONAL:
//    ALLOW_LOCAL_ORIGINS   "true" to also accept http://localhost:* (dev only)
// ----------------------------------------------------------------------------
//  SUBMISSION LIFECYCLE (dedupe): a submission is tracked as `pending` the moment
//  it is claimed for delivery and only promoted to `delivered` AFTER Nodemailer
//  confirms sendMail() succeeded. Any delivery-stage failure releases the record
//  so the submission stays retryable — a failed or unconfigured send can never
//  produce a false duplicate success. A concurrent identical request that arrives
//  while the first is still pending is rejected with HTTP 409 (never success).
//
//  NOTE ON RATE LIMITING / DEDUPE STATE: the in-memory guards below are
//  best-effort. Vercel functions are stateless and horizontally scaled, so
//  counters reset on cold start and are not shared across instances. For
//  production-grade, cross-instance protection, back these with Vercel KV /
//  Upstash Redis (see README).
// ============================================================================

const nodemailer = require('nodemailer');
const yauzl = require('yauzl');
const { SaxesParser } = require('saxes');

// ---- limits -----------------------------------------------------------------
const MAX_BODY_BYTES = 5 * 1024 * 1024;   // whole JSON request
const MAX_CV_BYTES   = 3 * 1024 * 1024;   // raw CV file
const LIMITS = {
  fullname:   [2, 150],
  email:      [1, 254],
  phone:      [0, 50],
  message:    [10, 5000],
  firstname:  [2, 100],
  surname:    [2, 100],
  expertise:  [2, 150],
  contactnum: [5, 50],
};

const ALLOWED_EXT  = ['.pdf', '.doc', '.docx'];
const ALLOWED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream', // some browsers report this; signature check still applies
  '',
];
const DANGEROUS_EXT = /\.(exe|bat|cmd|com|scr|msi|js|mjs|vbs|ps1|sh|bash|php|phtml|phar|htm|html|svg|jar|dll|so|gz|zip|rar|7z|iso|apk|bin|pl|py|rb)(\.|$)/i;

// ---- DOCX (OOXML) structural-validation limits ------------------------------
const DOCX_MAX_ENTRIES            = 512;               // zip-bomb: cap entry count
const DOCX_MAX_TOTAL_UNCOMPRESSED = 50 * 1024 * 1024;  // zip-bomb: cap total inflated size
const DOCX_MAX_MEMBER_BYTES       = 8 * 1024 * 1024;   // cap on any single member we inflate
const DOCX_MAX_RATIO              = 200;               // zip-bomb: cap per-entry inflate ratio
const DOCX_RATIO_MIN_SIZE         = 64 * 1024;         // ignore ratio for tiny members
const DOCX_REQUIRED = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'];
const DOCX_WML_MAIN_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const DOCX_CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const DOCX_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOCX_OFFICE_REL_TYPES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
]);
const DOCX_WML_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);

// ---- best-effort in-memory guards ------------------------------------------
const RL_WINDOW_MS   = 60 * 1000;
const RL_MAX         = 5;                 // max submissions per IP per window
const DELIVERED_MS   = 2 * 60 * 1000;     // confirmed-duplicate window (delivered)
const PENDING_TTL_MS = 60 * 1000;         // stale-pending reclaim window
const rlStore     = new Map();            // ip   -> [timestamps]
const submitStore = new Map();            // hash -> { state: 'pending'|'delivered', ts }

function rateLimited(ip) {
  const now = Date.now();
  const arr = (rlStore.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  if (arr.length >= RL_MAX) { rlStore.set(ip, arr); return true; }
  arr.push(now);
  rlStore.set(ip, arr);
  if (rlStore.size > 5000) rlStore.clear(); // crude memory cap
  return false;
}

// Submission lifecycle. Runs synchronously (no await between read and write) so
// the claim is atomic on a single instance. Returns one of:
//   'delivered' — an identical submission was already confirmed delivered
//   'pending'   — an identical submission is currently being processed
//   'claimed'   — this request now owns a fresh pending record (proceed to send)
function claimSubmission(hash) {
  const now = Date.now();
  if (submitStore.size > 5000) submitStore.clear(); // crude memory cap
  const rec = submitStore.get(hash);
  if (rec) {
    if (rec.state === 'delivered' && now - rec.ts < DELIVERED_MS) return 'delivered';
    if (rec.state === 'pending'   && now - rec.ts < PENDING_TTL_MS) return 'pending';
    // otherwise the record is stale (delivered window expired, or a pending
    // record timed out because its request died) — allow it to be reclaimed.
  }
  submitStore.set(hash, { state: 'pending', ts: now });
  return 'claimed';
}
function markDelivered(hash) { submitStore.set(hash, { state: 'delivered', ts: Date.now() }); }
// Release a pending claim so the submission stays retryable after a failure.
function releaseSubmission(hash) {
  const rec = submitStore.get(hash);
  if (rec && rec.state === 'pending') submitStore.delete(hash);
}

function cheapHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

// ---- helpers ----------------------------------------------------------------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// strip control chars; collapse for single-line header-bound values
function clean(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, ' ').trim(); }
function cleanMultiline(s) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim(); }
// header-safe: no CR/LF (defends against header injection in subject / replyTo)
function headerSafe(s) { return clean(s).replace(/[\r\n]+/g, ' '); }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function validEmail(s) { const v = clean(s); return v.length <= 254 && EMAIL_RE.test(v) ? v : null; }
function lenOk(s, key) { const [min, max] = LIMITS[key]; const n = (s || '').length; return n >= min && n <= max; }

function getIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function originAllowed(req) {
  const allow = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.origin || '';
  if (allow.length && allow.indexOf(origin) !== -1) return true;
  if (String(process.env.ALLOW_LOCAL_ORIGINS).toLowerCase() === 'true' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  // Same-origin requests from the browser may omit Origin on some navigations;
  // if no origin header at all AND no allow-list configured, fall through as blocked.
  return false;
}

// file signature validation (magic bytes)
function signatureOk(ext, mime, buf) {
  if (!buf || buf.length < 4) return false;
  const b = buf;
  const isPdf  = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;                       // %PDF
  const isOle  = b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0;                       // DOC (OLE2)
  const isZip  = b[0] === 0x50 && b[1] === 0x4B && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);     // DOCX (ZIP/OOXML)
  if (ext === '.pdf')  return isPdf  && (mime === 'application/pdf' || mime === 'application/octet-stream' || mime === '');
  if (ext === '.doc')  return isOle  && (mime === 'application/msword' || mime === 'application/octet-stream' || mime === '');
  if (ext === '.docx') return isZip  && mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return false;
}

// ---- DOCX OOXML structural validation --------------------------------------
// Parses the ZIP central directory with yauzl (lazy entries). Inspects every
// entry's metadata BEFORE any decompression, enforces zip-bomb / traversal /
// encryption guards, confirms the OOXML package structure, and inflates ONLY
// [Content_Types].xml (in memory, size-capped) to verify the WordprocessingML
// main-document content type. Nothing is ever written to disk.
// Resolves { ok:true } or { ok:false, error:'<reason>' }.
function xmlAttribute(tag, localName) {
  const attrs = tag && tag.attributes ? Object.values(tag.attributes) : [];
  for (let i = 0; i < attrs.length; i++) {
    if (attrs[i].local === localName || attrs[i].name === localName) return attrs[i].value;
  }
  return null;
}

function parseXmlSafely(xml, onOpenTag) {
  if (typeof xml !== 'string' || !xml.length || xml.indexOf('\uFFFD') !== -1) throw new Error('xml_invalid');
  // OOXML parts used here never need a DTD or custom entity declarations.
  // Reject them before parsing to prevent entity-expansion / external-entity tricks.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('xml_dtd_forbidden');

  const parser = new SaxesParser({ xmlns: true });
  let parseError = null;
  parser.on('error', (err) => { parseError = err || new Error('xml_invalid'); });
  parser.on('opentag', (tag) => {
    if (!parseError) onOpenTag(tag);
  });
  parser.write(xml).close();
  if (parseError) throw parseError;
}

function validateContentTypesXml(xml) {
  let first = true;
  let rootOk = false;
  let documentOverride = false;
  parseXmlSafely(xml, (tag) => {
    if (first) {
      first = false;
      rootOk = tag.local === 'Types' && tag.uri === DOCX_CT_NS;
      if (!rootOk) throw new Error('content_types_root');
    }
    if (tag.local === 'Override' && tag.uri === DOCX_CT_NS) {
      const partName = xmlAttribute(tag, 'PartName');
      const contentType = xmlAttribute(tag, 'ContentType');
      if (partName === '/word/document.xml' && contentType === DOCX_WML_MAIN_CT) documentOverride = true;
    }
  });
  return rootOk && documentOverride;
}

function validatePackageRelationshipsXml(xml) {
  let first = true;
  let rootOk = false;
  let officeDocumentRelationship = false;
  parseXmlSafely(xml, (tag) => {
    if (first) {
      first = false;
      rootOk = tag.local === 'Relationships' && tag.uri === DOCX_REL_NS;
      if (!rootOk) throw new Error('relationships_root');
    }
    if (tag.local === 'Relationship' && tag.uri === DOCX_REL_NS) {
      const type = xmlAttribute(tag, 'Type');
      const target = xmlAttribute(tag, 'Target');
      const targetMode = xmlAttribute(tag, 'TargetMode');
      const normalisedTarget = String(target || '').replace(/^\/+/, '');
      const internal = !targetMode || String(targetMode).toLowerCase() === 'internal';
      if (DOCX_OFFICE_REL_TYPES.has(type) && normalisedTarget === 'word/document.xml' && internal) {
        officeDocumentRelationship = true;
      }
    }
  });
  return rootOk && officeDocumentRelationship;
}

function validateWordDocumentXml(xml) {
  let first = true;
  let rootNamespace = null;
  let rootOk = false;
  let bodyFound = false;
  parseXmlSafely(xml, (tag) => {
    if (first) {
      first = false;
      rootNamespace = tag.uri;
      rootOk = tag.local === 'document' && DOCX_WML_NAMESPACES.has(tag.uri);
      if (!rootOk) throw new Error('document_root');
    } else if (tag.local === 'body' && tag.uri === rootNamespace) {
      bodyFound = true;
    }
  });
  return rootOk && bodyFound;
}

function validateDocxXmlParts(parts) {
  try {
    return validateContentTypesXml(parts.get('[Content_Types].xml'))
      && validatePackageRelationshipsXml(parts.get('_rels/.rels'))
      && validateWordDocumentXml(parts.get('word/document.xml'));
  } catch (_) {
    return false;
  }
}

// Parses the ZIP central directory lazily, validates metadata before inflation,
// then inflates only the three small XML parts needed to prove that the archive
// is a genuine WordprocessingML package. Nothing is written to disk.
function validateDocx(buf) {
  return new Promise((resolve) => {
    let settled = false;
    let zipRef = null;
    const done = (r) => {
      if (settled) return;
      settled = true;
      try { if (zipRef) zipRef.close(); } catch (_) {}
      resolve(r);
    };

    yauzl.fromBuffer(buf, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return done({ ok: false, error: 'corrupt' });
      zipRef = zip;

      let entryCount = 0;
      let totalUncompressed = 0;
      const seen = new Set();
      const xmlParts = new Map();

      zip.on('error', () => done({ ok: false, error: 'corrupt' }));

      zip.on('end', () => {
        for (let i = 0; i < DOCX_REQUIRED.length; i++) {
          if (!seen.has(DOCX_REQUIRED[i])) return done({ ok: false, error: 'structure' });
        }
        if (!validateDocxXmlParts(xmlParts)) return done({ ok: false, error: 'ooxml_invalid' });
        done({ ok: true });
      });

      zip.on('entry', (entry) => {
        entryCount++;
        if (entryCount > DOCX_MAX_ENTRIES) return done({ ok: false, error: 'too_many_entries' });

        const name = String(entry.fileName || '');
        if (!name || name.indexOf('\u0000') !== -1) return done({ ok: false, error: 'path' });

        // General-purpose bit 0 indicates traditional ZIP encryption.
        if ((entry.generalPurposeBitFlag & 0x1) === 0x1) return done({ ok: false, error: 'encrypted' });
        // Only stored and DEFLATE members are expected and safely supported.
        if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) return done({ ok: false, error: 'compression' });

        // No backslashes, absolute paths, drive-letter paths or traversal.
        if (name.indexOf('\\') !== -1 || name.charAt(0) === '/' || /^[A-Za-z]:/.test(name)) {
          return done({ ok: false, error: 'path' });
        }
        const pathParts = name.split('/');
        if (pathParts.indexOf('..') !== -1 || pathParts.indexOf('.') !== -1) return done({ ok: false, error: 'path' });

        // Reject Unix symlink entries.
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if ((unixMode & 0xF000) === 0xA000) return done({ ok: false, error: 'symlink' });

        const uSize = Number(entry.uncompressedSize || 0);
        const cSize = Number(entry.compressedSize || 0);
        totalUncompressed += uSize;
        if (totalUncompressed > DOCX_MAX_TOTAL_UNCOMPRESSED) return done({ ok: false, error: 'too_large' });
        if (uSize > DOCX_RATIO_MIN_SIZE && cSize > 0 && (uSize / cSize) > DOCX_MAX_RATIO) {
          return done({ ok: false, error: 'ratio' });
        }

        const isDir = /\/$/.test(name);
        if (!isDir && DOCX_REQUIRED.indexOf(name) !== -1) {
          if (seen.has(name)) return done({ ok: false, error: 'duplicate_part' });
          seen.add(name);
          if (uSize <= 0 || uSize > DOCX_MAX_MEMBER_BYTES) return done({ ok: false, error: 'too_large' });

          zip.openReadStream(entry, (streamErr, stream) => {
            if (streamErr || !stream) return done({ ok: false, error: 'corrupt' });
            const chunks = [];
            let got = 0;
            stream.on('data', (chunk) => {
              got += chunk.length;
              if (got > DOCX_MAX_MEMBER_BYTES) {
                try { stream.destroy(); } catch (_) {}
                return done({ ok: false, error: 'too_large' });
              }
              chunks.push(chunk);
            });
            stream.on('error', () => done({ ok: false, error: 'corrupt' }));
            stream.on('end', () => {
              const xml = Buffer.concat(chunks).toString('utf8');
              xmlParts.set(name, xml);
              zip.readEntry();
            });
          });
          return;
        }
        zip.readEntry();
      });

      zip.readEntry();
    });
  });
}

function decodeBase64Strict(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  // FileReader produces canonical RFC 4648 base64 without whitespace.
  // Requiring canonical padding prevents Buffer.from() from silently ignoring
  // malformed characters or accepting ambiguous encodings.
  if (value.length % 4 !== 0) return null;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, 'base64');
    if (!decoded.length || decoded.toString('base64') !== value) return null;
    return decoded;
  } catch (_) {
    return null;
  }
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    const size = Buffer.byteLength(JSON.stringify(req.body));
    if (size > MAX_BODY_BYTES) return { tooLarge: true };
    return { body: req.body };
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) return { tooLarge: true };
    try { return { body: JSON.parse(req.body) }; } catch (_) { return { body: null }; }
  }
  return await new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { resolve({ tooLarge: true }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve({ body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }); } catch (_) { resolve({ body: null }); } });
    req.on('error', () => resolve({ body: null }));
  });
}

function timestamp() {
  const now = new Date();
  let local;
  try { local = now.toLocaleString('en-GB', { timeZone: 'Indian/Mauritius', hour12: false }); }
  catch (_) { local = now.toISOString(); }
  return local + ' Mauritius (UTC: ' + now.toISOString() + ')';
}

// ============================================================================
module.exports = async function handler(req, res) {
  // --- method control ---
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  // --- origin control (no wildcard in production) ---
  if (!originAllowed(req)) {
    return res.status(403).json({ ok: false, error: 'forbidden_origin' });
  }
  // --- rate limiting (best effort) ---
  const ip = getIp(req);
  if (rateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  // --- body ---
  const parsed = await readBody(req);
  if (parsed.tooLarge) return res.status(413).json({ ok: false, error: 'payload_too_large' });
  const body = parsed.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'invalid_body' });

  // --- honeypot: silently accept, never email (no PII / no IP logged) ---
  const fields = (body.fields && typeof body.fields === 'object') ? body.fields : {};
  if (clean(fields.hp_url)) {
    console.warn('[website-form] honeypot rejected');
    return res.status(200).json({ ok: true });
  }

  // --- form type allow-list ---
  const formType = clean(body.form);
  if (formType !== 'contact' && formType !== 'careers') {
    return res.status(400).json({ ok: false, error: 'invalid_form_type' });
  }

  const files = Array.isArray(body.files) ? body.files : [];
  const url = clean(body.url).slice(0, 500);
  const referrer = clean(body.referrer).slice(0, 500);
  const ts = timestamp();

  // --- per-type validation + email assembly ---
  let subject, textBody, htmlRows, replyTo, dedupeSeed;
  const attachments = [];

  if (formType === 'contact') {
    const fullname = clean(fields.fullname);
    const email = validEmail(fields.email);
    const phone = clean(fields.phone);
    const message = cleanMultiline(fields.requirement);
    const consent = fields.tcs === true || fields.tcs === 'true' || fields.tcs === 'on';

    if (!lenOk(fullname, 'fullname')) return res.status(400).json({ ok: false, error: 'invalid_name' });
    if (!email) return res.status(400).json({ ok: false, error: 'invalid_email' });
    if (phone.length > LIMITS.phone[1]) return res.status(400).json({ ok: false, error: 'invalid_phone' });
    if (!lenOk(message, 'message')) return res.status(400).json({ ok: false, error: 'invalid_message' });
    if (!consent) return res.status(400).json({ ok: false, error: 'consent_required' });

    replyTo = email;
    subject = 'ARIE Finance Website Enquiry — ' + headerSafe(fullname);
    dedupeSeed = ip + '|contact|' + email + '|' + cheapHash(message);
    const pairs = [
      ['Form type', 'Contact enquiry'],
      ['Full name', fullname],
      ['Email', email],
      ['Phone', phone || '—'],
      ['Message', message],
      ['Consent', consent ? 'Yes — accepted Terms & Conditions and Privacy Policy' : 'No'],
      ['Submitted', ts],
      ['Source URL', url || '—'],
      ['Referrer', referrer || '—'],
    ];
    textBody = pairs.map((p) => p[0] + ': ' + p[1]).join('\n');
    htmlRows = pairs.map((p) => '<tr><td style="padding:6px 12px;font-weight:600;vertical-align:top;white-space:nowrap;">' + escapeHtml(p[0]) + '</td><td style="padding:6px 12px;">' + escapeHtml(p[1]).replace(/\n/g, '<br>') + '</td></tr>').join('');

  } else { // careers
    const firstName = clean(fields.name);
    const surname = clean(fields.surname);
    const expertise = clean(fields.expertise);
    const contactNum = clean(fields.phone);
    const email = validEmail(fields.email);
    const consent = fields.consent === true || fields.consent === 'true' || fields.consent === 'on';

    if (!lenOk(firstName, 'firstname')) return res.status(400).json({ ok: false, error: 'invalid_firstname' });
    if (!lenOk(surname, 'surname')) return res.status(400).json({ ok: false, error: 'invalid_surname' });
    if (!lenOk(expertise, 'expertise')) return res.status(400).json({ ok: false, error: 'invalid_expertise' });
    if (!lenOk(contactNum, 'contactnum')) return res.status(400).json({ ok: false, error: 'invalid_phone' });
    if (!email) return res.status(400).json({ ok: false, error: 'invalid_email' });
    if (!consent) return res.status(400).json({ ok: false, error: 'consent_required' });

    // CV is mandatory
    const cv = files[0];
    if (!cv || !cv.data) return res.status(400).json({ ok: false, error: 'cv_required' });

    const filename = clean(cv.filename).slice(0, 180);
    const lower = filename.toLowerCase();
    const ext = lower.slice(lower.lastIndexOf('.'));
    if (DANGEROUS_EXT.test(lower)) return res.status(400).json({ ok: false, error: 'cv_type_rejected' });
    if (ALLOWED_EXT.indexOf(ext) === -1) return res.status(400).json({ ok: false, error: 'cv_type_rejected' });
    if (ALLOWED_MIME.indexOf(String(cv.contentType || '')) === -1) return res.status(400).json({ ok: false, error: 'cv_type_rejected' });
    // extra double-extension guard: exactly one recognised extension expected
    if ((lower.match(/\.(pdf|docx?|exe|zip|js|svg|html?)/gi) || []).length > 1) return res.status(400).json({ ok: false, error: 'cv_type_rejected' });

    const buf = decodeBase64Strict(cv.data);
    if (!buf) return res.status(400).json({ ok: false, error: 'cv_unreadable' });
    if (cv.size != null) {
      const declaredSize = Number(cv.size);
      if (!Number.isSafeInteger(declaredSize) || declaredSize < 1 || declaredSize !== buf.length) {
        return res.status(400).json({ ok: false, error: 'cv_size_mismatch' });
      }
    }
    if (buf.length > MAX_CV_BYTES) return res.status(413).json({ ok: false, error: 'cv_too_large' });
    if (!signatureOk(ext, String(cv.contentType || ''), buf)) return res.status(400).json({ ok: false, error: 'cv_signature_mismatch' });

    // DOCX must be a genuine OOXML WordprocessingML package, not a renamed ZIP.
    if (ext === '.docx') {
      const dv = await validateDocx(buf);
      if (!dv.ok) return res.status(400).json({ ok: false, error: 'cv_type_rejected' });
    }

    attachments.push({ filename: filename || ('cv' + ext), content: buf, contentType: cv.contentType || 'application/octet-stream' });

    replyTo = email;
    subject = 'ARIE Finance Careers Application — ' + headerSafe(firstName) + ' ' + headerSafe(surname);
    dedupeSeed = ip + '|careers|' + email + '|' + cheapHash(firstName + surname + expertise);
    const pairs = [
      ['Form type', 'Careers application'],
      ['First name', firstName],
      ['Surname', surname],
      ['Field of expertise', expertise],
      ['Contact number', contactNum],
      ['Email', email],
      ['Consent', consent ? 'Yes — consented to data processing for recruitment (Privacy Policy)' : 'No'],
      ['Submitted', ts],
      ['CV', filename + ' (' + Math.round(buf.length / 1024) + ' KB)'],
    ];
    textBody = pairs.map((p) => p[0] + ': ' + p[1]).join('\n');
    htmlRows = pairs.map((p) => '<tr><td style="padding:6px 12px;font-weight:600;vertical-align:top;white-space:nowrap;">' + escapeHtml(p[0]) + '</td><td style="padding:6px 12px;">' + escapeHtml(p[1]).replace(/\n/g, '<br>') + '</td></tr>').join('');
  }

  // --- submission lifecycle: claim the dedupe key from the VALIDATED payload ---
  // A record is only marked `delivered` after sendMail() confirms below.
  const dedupeKey = cheapHash(dedupeSeed);
  const claim = claimSubmission(dedupeKey);
  if (claim === 'delivered') {
    // A prior identical submission was already confirmed received.
    return res.status(200).json({ ok: true, duplicate: true, message: 'This submission was already received.' });
  }
  if (claim === 'pending') {
    // An identical submission is still being processed — not a success.
    return res.status(409).json({ ok: false, error: 'processing', message: 'A matching submission is currently being processed.' });
  }
  // claim === 'claimed' — this request owns a fresh pending record; proceed.

  // --- required SMTP configuration present? (delivery-stage: release on failure) ---
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FORM_FROM_EMAIL', 'FORM_TO_EMAIL'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    releaseSubmission(dedupeKey); // never leave a successful-looking pending/delivered state
    console.error('[website-form] smtp not configured (' + missing.length + ' env var(s) missing)');
    return res.status(500).json({ ok: false, error: 'email_not_configured' });
  }

  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#0b1748;">'
    + '<h2 style="margin:0 0 12px;">' + escapeHtml(subject) + '</h2>'
    + '<table style="border-collapse:collapse;border:1px solid #e2e6ee;">' + htmlRows + '</table>'
    + (attachments.length ? '<p style="margin-top:16px;color:#555;">CV attached.</p>' : '')
    + '</div>';

  // --- send (record is promoted to `delivered` ONLY after SMTP accepts) ---
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.FORM_FROM_EMAIL,
      to: process.env.FORM_TO_EMAIL,
      subject: subject,
      text: textBody,
      html: html,
      replyTo: (replyTo && EMAIL_RE.test(replyTo)) ? replyTo : undefined,
      attachments: attachments,
    });
    markDelivered(dedupeKey);            // confirmed delivered — dedupe now protects
    return res.status(200).json({ ok: true });
  } catch (err) {
    releaseSubmission(dedupeKey);        // delivery failed — keep it retryable
    // safe log: no PII, no message body, no CV contents, no provider payload
    console.error('[website-form] send failed type=' + formType + ' code=' + (err && err.code ? err.code : 'unknown'));
    return res.status(500).json({ ok: false, error: 'send_failed' });
  }
};

module.exports.__test = { validateDocx, decodeBase64Strict, validateDocxXmlParts, claimSubmission, markDelivered, releaseSubmission };
