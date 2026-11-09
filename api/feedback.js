// ============================================================================
//  ARIE Finance — Leave Your Feedback  (Vercel serverless function)
//  Route:  GET  /api/feedback            -> { ok, enabled }   (public status)
//          POST /api/feedback            -> store, then notify
//
//  Deliberately separate from /api/website-form so Contact and Careers routing
//  is untouched. The endpoint is INACTIVE (POST returns 503, GET reports
//  enabled:false) unless every variable below is set. Nothing is activated by
//  merging this file.
// ----------------------------------------------------------------------------
//  REQUIRED TO ACTIVATE (Vercel → Project → Settings → Environment Variables):
//    FEEDBACK_ENABLED              "true" — explicit on/off switch
//    FEEDBACK_REDIS_REST_URL       DEDICATED Upstash Redis database for feedback.
//    FEEDBACK_REDIS_REST_TOKEN     Not the shared internal-tools database: the
//                                  shared token can read every key it holds.
//    FEEDBACK_ENCRYPTION_KEY       32-byte key, base64 (openssl rand -base64 32).
//                                  Personal fields are AES-256-GCM encrypted
//                                  before they reach the database.
//    FEEDBACK_RETENTION_DAYS       approved retention period, in days (integer)
//    FEEDBACK_TO_EMAIL             monitored feedback inbox (feedback owner)
//    COMPLAINTS_TO_EMAIL           complaints handler, copied on submissions
//                                  flagged "handle as a formal complaint"
//    SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, FORM_FROM_EMAIL,
//    ALLOWED_ORIGIN                shared with /api/website-form
//  OPTIONAL:
//    FEEDBACK_CC_EMAIL             backup owner, copied on every submission
//    ALLOW_LOCAL_ORIGINS           "true" to accept http://localhost:* (dev only)
// ----------------------------------------------------------------------------
//  RECORD LIFECYCLE
//    1. validate + spam/abuse checks
//    2. reference FB-YYMMDD-XXXXXX reserved with SET NX (unique, never reused)
//    3. record written: immutable createdAt, plaintext triage metadata,
//       encrypted personal fields, append-only events[]
//    4. only after step 3 succeeds does the visitor get a confirmation + ref
//    5. notification email; outcome appended to events[] ("notified" or
//       "notification_failed"). A failed email never loses the record: the
//       record stays in the database and is listed by scripts/feedback-records.js
//  Keys are namespaced by VERCEL_ENV so preview never touches production data.
//  Every key carries a TTL (records and index: approved retention period).
//
//  COMPLAINTS: the category chosen by the visitor never decides whether a
//  message is a complaint. Every notification asks the owner to assess any
//  expression of dissatisfaction against the Complaints Procedure. The
//  "formal complaint" checkbox only adds requirements (name + email) and
//  copies the complaints handler; it does not create a separate process.
// ============================================================================

const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Redis } = require('@upstash/redis');

const TYPES = new Set(['Suggestion', 'Service experience', 'Compliment']);
const LIMITS = { message: [10, 4000], name: [0, 120], colleague: [0, 120], email: [0, 254] };
const MAX_BODY_BYTES = 64 * 1024;
const RL_WINDOW_S = 600;       // 10 minutes
const RL_MAX = 5;              // submissions per IP per window
const DEDUPE_S = 600;          // identical resubmission returns the same reference
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---- configuration -----------------------------------------------------------
const REQUIRED_ENV = [
  'FEEDBACK_ENABLED', 'FEEDBACK_REDIS_REST_URL', 'FEEDBACK_REDIS_REST_TOKEN', 'FEEDBACK_ENCRYPTION_KEY',
  'FEEDBACK_RETENTION_DAYS', 'FEEDBACK_TO_EMAIL', 'COMPLAINTS_TO_EMAIL',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FORM_FROM_EMAIL', 'ALLOWED_ORIGIN',
];
// Shared internal-tools database variables: feedback must never use the same database.
const SHARED_DB_ENV = ['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'];
function config(env) {
  env = env || process.env;
  if (String(env.FEEDBACK_ENABLED).toLowerCase() !== 'true') return { enabled: false, reason: 'switched_off' };
  const missing = REQUIRED_ENV.filter((k) => !env[k]);
  if (missing.length) return { enabled: false, reason: 'missing_config' };
  const key = Buffer.from(String(env.FEEDBACK_ENCRYPTION_KEY), 'base64');
  if (key.length !== 32) return { enabled: false, reason: 'bad_key' };
  const days = Number(env.FEEDBACK_RETENTION_DAYS);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return { enabled: false, reason: 'bad_retention' };
  for (const k of ['FEEDBACK_TO_EMAIL', 'COMPLAINTS_TO_EMAIL']) if (!EMAIL_RE.test(String(env[k]))) return { enabled: false, reason: 'bad_recipient' };
  if (env.FEEDBACK_CC_EMAIL && !EMAIL_RE.test(String(env.FEEDBACK_CC_EMAIL))) return { enabled: false, reason: 'bad_recipient' };
  if (SHARED_DB_ENV.some((k) => env[k] && String(env[k]).replace(/\/+$/, '') === String(env.FEEDBACK_REDIS_REST_URL).replace(/\/+$/, ''))) return { enabled: false, reason: 'shared_database' };
  return {
    enabled: true, key, ttl: days * 86400,
    ns: 'feedback:' + (env.VERCEL_ENV || 'development') + ':',
    to: env.FEEDBACK_TO_EMAIL, complaintsTo: env.COMPLAINTS_TO_EMAIL, cc: env.FEEDBACK_CC_EMAIL || '',
    from: env.FORM_FROM_EMAIL,
    redisUrl: env.FEEDBACK_REDIS_REST_URL, redisToken: env.FEEDBACK_REDIS_REST_TOKEN,
    smtp: { host: env.SMTP_HOST, port: Number(env.SMTP_PORT), secure: String(env.SMTP_SECURE).toLowerCase() === 'true', auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000 },
  };
}

// ---- injectable dependencies (tests replace these) ----------------------------
const deps = {
  redis: (cfg) => new Redis({ url: cfg.redisUrl, token: cfg.redisToken }),
  transport: (cfg) => nodemailer.createTransport(cfg.smtp),
  now: () => new Date(),
};

// ---- helpers -------------------------------------------------------------------
function clean(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim(); }
function cleanMultiline(s) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim(); }
function headerSafe(s) { return clean(s).replace(/[\r\n]+/g, ' ').slice(0, 120); }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function truthy(v) { return v === true || v === 'true' || v === 'on' || v === '1'; }
function lenOk(v, k) { const [a, b] = LIMITS[k]; return v.length >= a && v.length <= b; }
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function getIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function originAllowed(req, env) {
  env = env || process.env;
  const allow = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.origin || '';
  if (allow.length && allow.indexOf(origin) !== -1) return true;
  if (String(env.ALLOW_LOCAL_ORIGINS).toLowerCase() === 'true' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  return false;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY_BYTES) return { tooLarge: true };
    return { body: req.body };
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) return { tooLarge: true };
    try { return { body: JSON.parse(req.body) }; } catch (_) { return { body: null }; }
  }
  return await new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY_BYTES) { resolve({ tooLarge: true }); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve({ body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }); } catch (_) { resolve({ body: null }); } });
    req.on('error', () => resolve({ body: null }));
  });
}

// AES-256-GCM: iv(12) | tag(16) | ciphertext, base64
function encrypt(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function decrypt(key, b64) {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
}

// Flags (never rejects) text that looks like card numbers or IBANs so the
// owner can handle it carefully. The visitor is asked not to include these.
function luhn(d) { let s = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = d.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; }
function looksSensitive(text) {
  const t = String(text || '');
  const cards = t.replace(/[ -]/g, '').match(/\d{13,19}/g) || [];
  if (cards.some(luhn)) return true;
  return /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/.test(t.toUpperCase());
}

function newReference(now) {
  const y = String(now.getUTCFullYear()).slice(2), m = String(now.getUTCMonth() + 1).padStart(2, '0'), d = String(now.getUTCDate()).padStart(2, '0');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  let r = ''; const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) r += alphabet[bytes[i] % alphabet.length];
  return 'FB-' + y + m + d + '-' + r;
}

function mauritiusTime(now) {
  try { return now.toLocaleString('en-GB', { timeZone: 'Indian/Mauritius', hour12: false }) + ' Mauritius'; } catch (_) { return now.toISOString(); }
}

function buildEmail(cfg, ref, rec, personal) {
  const flag = rec.formalComplaint ? '[COMPLAINT] ' : '[Feedback] ';
  const who = personal.name ? headerSafe(personal.name) : 'Anonymous';
  const subject = flag + rec.type + ' — ' + ref + ' — ' + who;
  const pairs = [
    ['Reference', ref],
    ['Received', mauritiusTime(new Date(rec.createdAt)) + ' (UTC ' + rec.createdAt + ')'],
    ['Category chosen', rec.type],
    ['Formal complaint requested', rec.formalComplaint ? 'YES — handle under the Complaints Procedure' : 'No'],
    ['Message', personal.message],
    ['Colleague named', personal.colleague || '—'],
    ['Name', personal.name || '—'],
    ['Email', personal.email || '—'],
    ['Happy to be contacted', rec.contactOk ? 'Yes' : 'No'],
    ['Possible sensitive data', rec.sensitiveSuspected ? 'Yes — the message may contain card or account numbers. Handle with care.' : 'No'],
  ];
  const triage = 'TRIAGE: assess any expression of dissatisfaction in this message against the ARIE Complaints Procedure, whatever category was chosen. '
    + 'Where it qualifies, record it in the complaints register under this reference.';
  const text = triage + '\n\n' + pairs.map((p) => p[0] + ': ' + p[1]).join('\n');
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#0b1748;">'
    + '<p style="margin:0 0 14px;padding:10px 12px;background:#FFF7E6;border-left:3px solid #C99B3F;">' + escapeHtml(triage) + '</p>'
    + '<table style="border-collapse:collapse;border:1px solid #e2e6ee;">'
    + pairs.map((p) => '<tr><td style="padding:6px 12px;font-weight:600;vertical-align:top;white-space:nowrap;">' + escapeHtml(p[0]) + '</td><td style="padding:6px 12px;">' + escapeHtml(p[1]).replace(/\n/g, '<br>') + '</td></tr>').join('')
    + '</table></div>';
  const cc = [];
  if (rec.formalComplaint) cc.push(cfg.complaintsTo);
  if (cfg.cc) cc.push(cfg.cc);
  return {
    from: cfg.from, to: cfg.to, cc: cc.length ? cc.join(', ') : undefined, subject, text, html,
    replyTo: (personal.email && EMAIL_RE.test(personal.email)) ? personal.email : undefined,
  };
}

// ============================================================================
async function handler(req, res) {
  const cfg = config();
  if (req.method === 'GET') { res.setHeader('Cache-Control', 'public, max-age=60'); return res.status(200).json({ ok: true, enabled: cfg.enabled }); }
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed' }); }
  if (!cfg.enabled) return res.status(503).json({ ok: false, error: 'feedback_not_enabled' });
  if (!originAllowed(req)) return res.status(403).json({ ok: false, error: 'forbidden_origin' });

  const parsed = await readBody(req);
  if (parsed.tooLarge) return res.status(413).json({ ok: false, error: 'payload_too_large' });
  const body = parsed.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'invalid_body' });
  const f = (body.fields && typeof body.fields === 'object') ? body.fields : {};

  // honeypot: pretend success, store nothing
  if (clean(f.hp_url)) return res.status(200).json({ ok: true, reference: null });

  const type = clean(f.type);
  const message = cleanMultiline(f.message);
  const colleague = clean(f.colleague);
  const name = clean(f.name);
  const emailRaw = clean(f.email);
  const contactOk = truthy(f.contact_ok);
  const formalComplaint = truthy(f.complaint);

  if (!TYPES.has(type)) return res.status(400).json({ ok: false, error: 'invalid_type' });
  if (!lenOk(message, 'message')) return res.status(400).json({ ok: false, error: 'invalid_message' });
  if (!lenOk(colleague, 'colleague')) return res.status(400).json({ ok: false, error: 'invalid_colleague' });
  if (!lenOk(name, 'name')) return res.status(400).json({ ok: false, error: 'invalid_name' });
  if (emailRaw && (!EMAIL_RE.test(emailRaw) || emailRaw.length > 254)) return res.status(400).json({ ok: false, error: 'invalid_email' });
  if (formalComplaint && (!name || !emailRaw)) return res.status(400).json({ ok: false, error: 'complaint_contact_required' });

  let redis;
  try { redis = deps.redis(cfg); } catch (_) { return res.status(503).json({ ok: false, error: 'storage_unavailable' }); }
  const ns = cfg.ns;
  const ip = getIp(req);
  const hmac = (v) => crypto.createHmac('sha256', cfg.key).update(v).digest('hex');
  const ipKey = ns + 'rl:' + hmac('ip|' + ip).slice(0, 32); // keyed hash; no raw IP stored

  // rate limit (shared across instances)
  try {
    const n = await redis.incr(ipKey);
    if (n === 1 || n > RL_MAX) await redis.expire(ipKey, RL_WINDOW_S); // re-arm so a failed expire can never block an IP permanently
    if (n > RL_MAX) return res.status(429).json({ ok: false, error: 'rate_limited' });
  } catch (_) { return res.status(503).json({ ok: false, error: 'storage_unavailable' }); }

  // idempotency: an identical message from the same connection within 10 min returns the same reference
  const dedupeKey = ns + 'dedupe:' + hmac(['dedupe', ip, type, message, emailRaw, name, colleague, formalComplaint ? '1' : '0'].join('|')).slice(0, 40);
  try {
    const prior = await redis.get(dedupeKey);
    if (prior) return res.status(200).json({ ok: true, reference: String(prior), duplicate: true });
  } catch (_) { return res.status(503).json({ ok: false, error: 'storage_unavailable' }); }

  const now = deps.now();
  const createdAt = now.toISOString();
  const personal = { message, colleague, name, email: emailRaw };
  const rec = {
    v: 1, createdAt, type, formalComplaint, contactOk,
    sensitiveSuspected: looksSensitive(message + ' ' + colleague),
    triage: 'pending',
    events: [{ at: createdAt, event: 'received' }],
    personal: encrypt(cfg.key, personal),
  };

  // durable write: reserve a unique reference (SET NX), then index it
  let ref = null;
  try {
    for (let i = 0; i < 5 && !ref; i++) {
      const candidate = newReference(now);
      const okSet = await redis.set(ns + 'rec:' + candidate, JSON.stringify(rec), { nx: true, ex: cfg.ttl });
      if (okSet === 'OK' || okSet === true) ref = candidate;
    }
    if (!ref) throw new Error('reference_exhausted');
  } catch (err) {
    console.error('[feedback] storage failed code=' + (err && err.code ? err.code : 'unknown'));
    return res.status(503).json({ ok: false, error: 'storage_failed' });
  }
  // The record is now durable: from here on nothing may turn this into a failure for the visitor.
  // Index/dedupe are conveniences; if they fail the record is still found by the recovery tool's SCAN fallback.
  try {
    await redis.zadd(ns + 'index', { score: now.getTime(), member: ref });
    await redis.zremrangebyscore(ns + 'index', 0, now.getTime() - cfg.ttl * 1000); // prune expired refs
    await redis.expire(ns + 'index', cfg.ttl);
    await redis.set(dedupeKey, ref, { ex: DEDUPE_S });
  } catch (err) {
    console.error('[feedback] index/dedupe write failed ref=' + ref);
  }

  // notify (record already safe). Outcome appended to the record's events.
  let notified = false;
  try {
    await deps.transport(cfg).sendMail(buildEmail(cfg, ref, rec, personal));
    notified = true;
  } catch (err) {
    console.error('[feedback] notification failed ref=' + ref + ' code=' + (err && err.code ? err.code : 'unknown'));
  }
  try {
    const raw = await redis.get(ns + 'rec:' + ref);
    const cur = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (cur && Array.isArray(cur.events)) {
      cur.events.push({ at: deps.now().toISOString(), event: notified ? 'notified' : 'notification_failed' });
      await redis.set(ns + 'rec:' + ref, JSON.stringify(cur), { xx: true, keepTtl: true });
    }
  } catch (err) {
    console.error('[feedback] event append failed ref=' + ref);
  }

  return res.status(200).json({ ok: true, reference: ref });
}

module.exports = handler;
module.exports.__test = { config, deps, encrypt, decrypt, looksSensitive, newReference, buildEmail, REQUIRED_ENV };
