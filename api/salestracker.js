// ============================================================================
//  ARIE Finance — Sales Tracker API   (Vercel serverless function)
//  Route:  /api/salestracker
//  Shared, authenticated datastore for the internal Sales & Client
//  Acquisition Tracker served at /salestracker.
// ----------------------------------------------------------------------------
//  DATA MODEL (Upstash Redis — field/record-level, no whole-DB overwrite):
//    st:rec:<id>      HASH   one lead record; each field is a Redis hash field
//    st:tab:<tab>     LIST   ordered lead ids for a tab (newest first)
//    st:seeded        STR    "1" once the initial dataset has been imported
//    st:signkey       STR    server-generated HMAC key for session tokens
//    st:loginfail:<ip> STR   failed-login counter (TTL), brute-force throttle
//
//  Concurrency: every edit is an HSET touching only the changed field(s) of a
//  single record, so simultaneous edits by different users never clobber each
//  other's other fields. There is no read-modify-write of a whole database.
// ----------------------------------------------------------------------------
//  REQUIRED ENVIRONMENT VARIABLES (set in Vercel → Project → Settings → Env):
//    SALESTRACKER_PASSCODE   staff access passcode (secret; NEVER in source)
//    + Upstash Redis REST credentials, injected automatically by the Vercel
//      Marketplace Upstash integration. This function accepts either the
//      KV_REST_API_* names or the UPSTASH_REDIS_REST_* names:
//        KV_REST_API_URL   / UPSTASH_REDIS_REST_URL
//        KV_REST_API_TOKEN / UPSTASH_REDIS_REST_TOKEN
//  No database credentials or passcodes are ever exposed to the browser.
// ----------------------------------------------------------------------------
//  ACTIONS (JSON body; all except "login" require Authorization: Bearer <token>)
//    POST { action:"login", passcode }                 -> { token, exp }
//    GET  ?action=data                                 -> { tabs:{...}, order }
//    POST { action:"update", id, fields:{k:v,...} }    -> { ok, id }
//    POST { action:"create", tab, record:{...} }       -> { ok, record }
//    POST { action:"seed",  data:{tab:[records]} }     -> { ok, seeded|already }
// ============================================================================

const crypto = require('crypto');

// ---- config ---------------------------------------------------------------
// Resolve the Upstash/KV REST credentials from the KNOWN pairs the Vercel
// Upstash integration injects — explicitly, never by wildcard, so the tracker
// can never bind to an unrelated datastore added to the project later.
function resolveRedisCreds() {
  const env = process.env;
  const known = [
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ];
  for (const [u, t] of known) if (env[u] && env[t]) return { url: env[u], token: env[t] };
  return { url: '', token: '' };
}
const _creds = resolveRedisCreds();
const REST_URL   = _creds.url;
const REST_TOKEN = _creds.token;
const PASSCODE   = process.env.SALESTRACKER_PASSCODE || '';

const TOKEN_TTL_MS   = 12 * 60 * 60 * 1000;      // 12h session
const MAX_BODY_BYTES = 2 * 1024 * 1024;          // 2MB (seed is the big one)
const LOGIN_WINDOW_S = 900;                      // 15 min
const LOGIN_MAX_FAIL = 12;                       // per IP per window

const TABS = ['luca', 'uae', 'mauritius', 'uk', 'africa', 'existing', 'onboarding', 'filmproduction'];
// fields a client is allowed to write. id is immutable; score is preserved.
const EDITABLE = new Set([
  'company', 'contact', 'email', 'phone', 'country', 'industry',
  'priority', 'owner', 'status', 'lastContact', 'followUp',
  'nextAction', 'comments',
]);
// full set persisted per record (editable + server-managed)
const REC_FIELDS = [...EDITABLE, 'id', 'score'];

// ---- Upstash REST helpers -------------------------------------------------
async function redis(cmd) {
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('redis: ' + (j.error || r.status));
  return j.result;
}
async function pipeline(cmds) {
  if (!cmds.length) return [];
  const r = await fetch(REST_URL.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(j)) throw new Error('redis pipeline: ' + r.status);
  return j.map((x) => {
    if (x && x.error) throw new Error('redis: ' + x.error);
    return x ? x.result : null;
  });
}
// HGETALL may come back as a flat [f,v,f,v] array or an object; normalise.
function toObj(res) {
  if (!res) return null;
  if (Array.isArray(res)) {
    if (!res.length) return null;
    const o = {};
    for (let i = 0; i < res.length; i += 2) o[res[i]] = res[i + 1];
    return o;
  }
  if (typeof res === 'object') return Object.keys(res).length ? res : null;
  return null;
}

// ---- session tokens (HMAC, server-side key — decoupled from passcode) -----
let _signKey = null;
async function signKey() {
  if (_signKey) return _signKey;
  let k = await redis(['GET', 'st:signkey']);
  if (!k) {
    const fresh = crypto.randomBytes(32).toString('hex');
    // SET NX: only the first caller wins; then read the authoritative value.
    await redis(['SET', 'st:signkey', fresh, 'NX']);
    k = await redis(['GET', 'st:signkey']);
  }
  _signKey = k;
  return k;
}
function b64url(s) { return Buffer.from(s).toString('base64url'); }
function mintToken(key) {
  const payload = b64url(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS }));
  const sig = crypto.createHmac('sha256', key).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function verifyToken(token, key) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return false;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', key).update(payload).digest('base64url');
  const a = Buffer.from(sig || ''); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  let data; try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return false; }
  return data && typeof data.exp === 'number' && Date.now() < data.exp;
}
function constEq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  if (x.length !== y.length) { // still compare to avoid trivial length timing leak
    crypto.timingSafeEqual(x, x);
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

// ---- request parsing ------------------------------------------------------
function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY_BYTES) return { tooLarge: true };
    return { body: req.body };
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) return { tooLarge: true };
    try { return { body: JSON.parse(req.body) }; } catch { return { body: null }; }
  }
  return { body: {} };
}
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}
// ---- session cookie (Secure, HttpOnly, SameSite=Strict) -------------------
const COOKIE = 'arie_st';
function cookieSecure(req) {
  const p = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return p ? p === 'https' : true;   // default Secure unless proto explicitly says http
}
function setCookie(res, req, token, maxAgeS) {
  const parts = [
    COOKIE + '=' + token,
    'Path=/api/salestracker',
    'Max-Age=' + maxAgeS,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (cookieSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function sessionToken(req) {
  const c = req.headers.cookie || '';
  const m = c.match(/(?:^|;\s*)arie_st=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// sanitise a record coming from the client into the known fields (strings).
function cleanRecord(rec) {
  const out = {};
  for (const k of EDITABLE) {
    if (rec[k] === undefined || rec[k] === null) continue;
    out[k] = String(rec[k]).slice(0, 4000);
  }
  return out;
}

// ---- handler --------------------------------------------------------------
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (!REST_URL || !REST_TOKEN) {
    return res.status(503).json({ ok: false, error: 'storage_unconfigured' });
  }
  if (!PASSCODE) {
    return res.status(503).json({ ok: false, error: 'passcode_unconfigured' });
  }

  const method = req.method;
  const action = (req.query && req.query.action) ||
                 (method !== 'GET' ? (readBody(req).body || {}).action : '') || '';

  try {
    // ---- login: exchange passcode for a session token --------------------
    if (action === 'login') {
      if (method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method' }); }
      const ip = clientIp(req);
      const failKey = 'st:loginfail:' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24);
      const fails = parseInt(await redis(['GET', failKey]) || '0', 10);
      if (fails >= LOGIN_MAX_FAIL) return res.status(429).json({ ok: false, error: 'too_many_attempts' });

      const { body, tooLarge } = readBody(req);
      if (tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
      const supplied = body && typeof body.passcode === 'string' ? body.passcode : '';

      if (!supplied || !constEq(supplied, PASSCODE)) {
        const n = await redis(['INCR', failKey]);
        if (n === 1) await redis(['EXPIRE', failKey, LOGIN_WINDOW_S]);
        return res.status(401).json({ ok: false, error: 'invalid_passcode' });
      }
      await redis(['DEL', failKey]);
      const token = mintToken(await signKey());
      setCookie(res, req, token, Math.floor(TOKEN_TTL_MS / 1000));  // HttpOnly session cookie
      return res.status(200).json({ ok: true, exp: Date.now() + TOKEN_TTL_MS });
    }

    // ---- logout: clear the session cookie (idempotent) -------------------
    if (action === 'logout') {
      setCookie(res, req, '', 0);
      return res.status(200).json({ ok: true });
    }

    // ---- everything else requires a valid session cookie -----------------
    if (!verifyToken(sessionToken(req), await signKey())) {
      return res.status(401).json({ ok: false, error: 'unauthenticated' });
    }

    // ---- read the whole dataset -----------------------------------------
    if (action === 'data') {
      // 1) ordered ids per tab
      const idLists = await pipeline(TABS.map((t) => ['LRANGE', 'st:tab:' + t, 0, -1]));
      const flatIds = [];
      idLists.forEach((ids) => (ids || []).forEach((id) => flatIds.push(id)));
      // 2) each record in one pipeline
      const recs = flatIds.length
        ? await pipeline(flatIds.map((id) => ['HGETALL', 'st:rec:' + id]))
        : [];
      const byId = {};
      flatIds.forEach((id, i) => { const o = toObj(recs[i]); if (o) byId[id] = o; });
      const tabs = {};
      TABS.forEach((t, ti) => {
        tabs[t] = (idLists[ti] || []).map((id) => byId[id]).filter(Boolean);
      });
      return res.status(200).json({ ok: true, tabs, order: TABS });
    }

    // ---- update one or more fields of a single record -------------------
    if (action === 'update') {
      if (method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method' }); }
      const { body, tooLarge } = readBody(req);
      if (tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
      const id = body && body.id != null ? String(body.id) : '';
      const fields = body && body.fields && typeof body.fields === 'object' ? body.fields : null;
      if (!id || !fields) return res.status(400).json({ ok: false, error: 'bad_request' });

      const exists = await redis(['EXISTS', 'st:rec:' + id]);
      if (!exists) return res.status(404).json({ ok: false, error: 'not_found' });

      const pairs = [];
      for (const k of Object.keys(fields)) {
        if (!EDITABLE.has(k)) continue;
        pairs.push(k, String(fields[k] ?? '').slice(0, 4000));
      }
      if (!pairs.length) return res.status(400).json({ ok: false, error: 'no_valid_fields' });
      await redis(['HSET', 'st:rec:' + id, ...pairs]);  // atomic, only these fields
      return res.status(200).json({ ok: true, id, saved: pairs.length / 2 });
    }

    // ---- create a new lead in a tab -------------------------------------
    if (action === 'create') {
      if (method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method' }); }
      const { body, tooLarge } = readBody(req);
      if (tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
      const tab = body && body.tab ? String(body.tab) : '';
      if (!TABS.includes(tab)) return res.status(400).json({ ok: false, error: 'bad_tab' });
      const rec = cleanRecord((body && body.record) || {});
      const id = 'L-' + crypto.randomUUID();      // collision-free id (was Date.now())
      rec.id = id;
      if (rec.score === undefined) rec.score = '';
      const pairs = [];
      Object.keys(rec).forEach((k) => pairs.push(k, String(rec[k] ?? '')));
      // record first, then index — a half-written index entry would just skip a
      // missing record on read, never corrupt one.
      await redis(['HSET', 'st:rec:' + id, ...pairs]);
      await redis(['LPUSH', 'st:tab:' + tab, id]);
      return res.status(200).json({ ok: true, record: rec });
    }

    // ---- one-time seed of the initial dataset ---------------------------
    if (action === 'seed') {
      if (method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method' }); }
      const already = await redis(['GET', 'st:seeded']);
      if (already) return res.status(200).json({ ok: true, seeded: false, already: true });

      const { body, tooLarge } = readBody(req);
      if (tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
      const data = body && body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : null;
      if (!data) return res.status(400).json({ ok: false, error: 'no_data' });

      // VALIDATE the entire payload before writing a single key. Any unknown tab
      // or malformed record aborts with nothing changed — no half-seeded state.
      for (const key of Object.keys(data)) {
        if (!TABS.includes(key)) return res.status(400).json({ ok: false, error: 'unknown_tab:' + key });
        if (!Array.isArray(data[key])) return res.status(400).json({ ok: false, error: 'bad_tab_shape:' + key });
        for (const r of data[key]) {
          if (!r || typeof r !== 'object' || Array.isArray(r)) return res.status(400).json({ ok: false, error: 'bad_record_in:' + key });
        }
      }

      // Build every write up front (DEL clears any partial prior attempt so a
      // retry can never double-append). The seeded flag is NOT in this batch.
      const cmds = [];
      let count = 0;
      TABS.forEach((t) => cmds.push(['DEL', 'st:tab:' + t]));
      for (const tab of TABS) {
        const list = Array.isArray(data[tab]) ? data[tab] : [];
        for (const raw of list) {              // preserve source order via RPUSH
          const rec = cleanRecord(raw);
          rec.id = raw.id != null ? String(raw.id) : 'L-' + crypto.randomUUID();
          rec.score = raw.score != null ? String(raw.score) : '';
          const pairs = [];
          Object.keys(rec).forEach((k) => pairs.push(k, String(rec[k] ?? '')));
          cmds.push(['HSET', 'st:rec:' + rec.id, ...pairs]);
          cmds.push(['RPUSH', 'st:tab:' + tab, rec.id]);
          count++;
        }
      }
      // Write all data first; only if every chunk succeeds do we mark it seeded.
      for (let i = 0; i < cmds.length; i += 200) await pipeline(cmds.slice(i, i + 200));
      await redis(['SET', 'st:seeded', '1', 'NX']);
      return res.status(200).json({ ok: true, seeded: true, count });
    }

    return res.status(400).json({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};

module.exports.__test = { verifyToken, mintToken, toObj, cleanRecord, constEq, resolveRedisCreds, TABS, cookieSecure, sessionToken };
