// ============================================================================
//  ARIE Finance — Document Builder Access API  (Vercel serverless)
//  Route:  /api/internal/pricing
//
//  Actions:
//    POST {action:"login", passcode}                        -> sets cookie
//    POST {action:"logout"}                                 -> clears cookie
//    GET  ?action=session                                   -> session check
//    POST {action:"allocate_ref", brand, clientName,
//          idempotencyKey, staff?}                          -> allocate a CFS reference
//    GET  ?action=register_search&q=<text>&brand=<brand>    -> search allocated refs
//    GET  ?action=register_lookup&reference=<ref>           -> single-ref lookup
//
//  Env vars:
//    INTERNAL_PRICING_PASSCODE   — shared staff passcode (required)
//    UPSTASH_REDIS_REST_URL      — Upstash Redis REST endpoint
//    UPSTASH_REDIS_REST_TOKEN    — Upstash Redis REST token
//
//  Keys (all namespaced by VERCEL_ENV so preview and production never collide):
//    pricing:ref:<brand>:<year>:counter:<env>    integer, INCR'd per allocation
//    pricing:ref:<brand>:<year>:idem:<env>:<k>   idempotency map (24h TTL)
//    pricing:ref:<brand>:<year>:register:<env>   hash: reference -> JSON entry
//
//  Year configuration is explicit — a year not listed here is REFUSED with a
//  412 error. This prevents an unintended "ARIE-FS-2027-1" allocation when
//  the first 2027 allocation is attempted; the admin confirms the convention
//  and extends CONFIGURED_YEARS before the first run of a new year.
// ============================================================================

const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

// ARIE Finance's 2026 counter starts at 129 so the first allocation returns 130.
// Add a new year here only after confirming the starting-sequence convention.
const CONFIGURED_YEARS = {
  arie: { 2026: { seed: 129 } }
  // acbm: intentionally omitted — ACBM reference numbering is unchanged for now.
};
// Idempotency keys are PERMANENT: the same key always resolves to the same reference, even weeks
// later, so a slow retry can never create a second reference for a client that already has one.

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const COOKIE = 'arie_ip';

function passcodeRaw() { return process.env.INTERNAL_PRICING_PASSCODE || ''; }
function signKey() {
  const p = passcodeRaw();
  if (!p) return null;
  // Deriving the HMAC key from the passcode means rotating the passcode
  // invalidates every live cookie automatically. No key material lives
  // outside this env var.
  return crypto.createHash('sha256').update('arie-ip-signkey:' + p).digest();
}

function b64url(s) { return Buffer.from(s).toString('base64url'); }
function mintToken(key) {
  const payload = b64url(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS }));
  return payload + '.' + crypto.createHmac('sha256', key).update(payload).digest('base64url');
}
function verifyToken(token, key) {
  if (!key) return false;
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return false;
  const [p, sig] = token.split('.');
  const exp = crypto.createHmac('sha256', key).update(p).digest('base64url');
  const a = Buffer.from(sig || ''), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  let data; try { data = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return false; }
  return data && typeof data.exp === 'number' && Date.now() < data.exp;
}
function constEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; }
  return crypto.timingSafeEqual(x, y);
}

function cookieSecure(req) { const p = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim(); return p ? p === 'https' : true; }
function setCookie(res, req, token, maxAgeS) {
  const parts = [COOKIE + '=' + token, 'Path=/api/internal/pricing', 'Max-Age=' + maxAgeS, 'HttpOnly', 'SameSite=Strict'];
  if (cookieSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function sessionToken(req) { const c = req.headers.cookie || ''; const m = c.match(/(?:^|;\s*)arie_ip=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }

function readBody(req) {
  if (req.body && typeof req.body === 'object') { if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY_BYTES) return { tooLarge: true }; return { body: req.body }; }
  if (typeof req.body === 'string') { if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) return { tooLarge: true }; try { return { body: JSON.parse(req.body) }; } catch { return { body: null }; } }
  return { body: {} };
}

// ---------- Redis + register ---------------------------------------------

let _redisInstance = null;
function getRedis() {
  if (_redisInstance) return _redisInstance;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redisInstance = new Redis({ url, token });
  return _redisInstance;
}

function env() { return (process.env.VERCEL_ENV || 'development').toLowerCase(); }
function keyCounter(brand, year)  { return 'pricing:ref:' + brand + ':' + year + ':counter:'  + env(); }
function keyIdem(brand, year, k)  { return 'pricing:ref:' + brand + ':' + year + ':idem:'     + env() + ':' + k; }
function keyRegister(brand, year) { return 'pricing:ref:' + brand + ':' + year + ':register:' + env(); }

// Preview and development references carry a visible "-PREVIEW-" segment so
// a reference from a non-production environment can never be visually
// confused with a production allocation, even if its key somehow leaked.
function referencePrefix(brand, year) {
  const brandPrefix = brand.toUpperCase();
  const prod = env() === 'production';
  return prod ? (brandPrefix + '-FS-' + year + '-') : (brandPrefix + '-FS-' + year + '-PREVIEW-');
}

// Atomic allocation via Lua on Upstash. Returns {reference, isNew, storedEntry}.
// Flow:
//   1. If the idempotency key already carries a reference, return it with the stored register
//      entry (double-click / network retry safe; the caller then checks the stored clientName
//      against the request's clientName and refuses on mismatch).
//   2. Otherwise INCR the counter, format the reference, record the register entry, and bind
//      the idempotency key PERMANENTLY to the new reference (no TTL — a retry weeks later
//      still returns the same reference, never a new one).
// The counter is seeded with SETNX before the script runs — one-time bootstrap, no-op after.
const ALLOC_SCRIPT = [
  "local existing = redis.call('GET', KEYS[1])",
  "if existing then",
  "  local stored = redis.call('HGET', KEYS[3], existing)",
  "  return {existing, '0', stored or ''}",
  "end",
  "local n = redis.call('INCR', KEYS[2])",
  "local ref = ARGV[1] .. n",
  "redis.call('SET', KEYS[1], ref)",
  "redis.call('HSET', KEYS[3], ref, ARGV[2])",
  "return {ref, '1', ARGV[2]}"
].join('\n');

async function allocateRef(redis, brand, year, seed, idempotencyKey, clientName, staff) {
  const counterKey = keyCounter(brand, year);
  const idemKey = keyIdem(brand, year, idempotencyKey);
  const registerKey = keyRegister(brand, year);
  const prefix = referencePrefix(brand, year);
  await redis.set(counterKey, seed, { nx: true });
  const allocatedAt = new Date().toISOString();
  const entry = JSON.stringify({ clientName, entity: brand, allocatedAt, staff: staff || '', env: env() });
  const resp = await redis.eval(ALLOC_SCRIPT, [idemKey, counterKey, registerKey], [prefix, entry]);
  const reference = Array.isArray(resp) ? String(resp[0]) : String(resp);
  const isNew = Array.isArray(resp) && String(resp[1]) === '1';
  const storedRaw = Array.isArray(resp) ? String(resp[2] || '') : '';
  let storedEntry = null;
  if (storedRaw) { try { storedEntry = JSON.parse(storedRaw); } catch (e) { storedEntry = null; } }
  return { reference, allocatedAt: isNew ? allocatedAt : (storedEntry && storedEntry.allocatedAt) || null, reused: !isNew, storedEntry };
}

async function registerSearch(redis, q, brandFilter) {
  const brands = brandFilter ? [brandFilter] : Object.keys(CONFIGURED_YEARS);
  const out = [];
  for (const brand of brands) {
    if (!CONFIGURED_YEARS[brand]) continue;
    const years = Object.keys(CONFIGURED_YEARS[brand]);
    for (const year of years) {
      const key = keyRegister(brand, year);
      const all = await redis.hgetall(key);
      if (!all) continue;
      for (const [ref, raw] of Object.entries(all)) {
        let obj;
        try { obj = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); } catch (e) { continue; }
        if (q) {
          const hay = (ref + ' ' + (obj.clientName || '') + ' ' + (obj.staff || '')).toLowerCase();
          if (hay.indexOf(q) < 0) continue;
        }
        out.push({ reference: ref, clientName: obj.clientName || '', entity: obj.entity || brand, allocatedAt: obj.allocatedAt || '', staff: obj.staff || '', env: obj.env || '' });
      }
    }
  }
  out.sort((a, b) => (b.allocatedAt || '').localeCompare(a.allocatedAt || ''));
  return out.slice(0, 200);
}

async function registerLookup(redis, reference) {
  for (const brand of Object.keys(CONFIGURED_YEARS)) {
    for (const year of Object.keys(CONFIGURED_YEARS[brand])) {
      const raw = await redis.hget(keyRegister(brand, year), reference);
      if (raw == null) continue;
      try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
    }
  }
  return null;
}

// -------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  const truth = passcodeRaw();
  if (!truth) return res.status(503).json({ ok: false, error: 'passcode_unconfigured' });
  const key = signKey();

  const method = req.method;
  const action = (req.query && req.query.action) || (method !== 'GET' ? (readBody(req).body || {}).action : '') || '';

  try {
    if (action === 'login') {
      if (method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method' }); }
      const { body, tooLarge } = readBody(req);
      if (tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
      const supplied = body && typeof body.passcode === 'string' ? body.passcode : '';
      if (!supplied || !constEq(supplied, truth)) {
        return res.status(401).json({ ok: false, error: 'invalid_passcode' });
      }
      setCookie(res, req, mintToken(key), Math.floor(TOKEN_TTL_MS / 1000));
      return res.status(200).json({ ok: true, exp: Date.now() + TOKEN_TTL_MS });
    }

    if (action === 'logout') { setCookie(res, req, '', 0); return res.status(200).json({ ok: true }); }

    if (!verifyToken(sessionToken(req), key)) return res.status(401).json({ ok: false, error: 'unauthenticated' });

    if (action === 'session' && method === 'GET') return res.status(200).json({ ok: true });

    if (action === 'allocate_ref') {
      if (method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method' }); }
      const { body, tooLarge } = readBody(req);
      if (tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
      const brand = String((body && body.brand) || '').toLowerCase();
      const clientName = String((body && body.clientName) || '').trim();
      const idempotencyKey = String((body && body.idempotencyKey) || '').trim();
      const staff = String((body && body.staff) || '').trim().slice(0, 120);
      if (!CONFIGURED_YEARS[brand]) return res.status(400).json({ ok: false, error: 'brand_not_configured', message: 'This brand is not configured for automatic reference allocation.' });
      if (!clientName) return res.status(400).json({ ok: false, error: 'client_name_required', message: 'Enter the client legal name before allocating a reference.' });
      if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128 || !/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) return res.status(400).json({ ok: false, error: 'bad_idempotency_key' });
      const redis = getRedis();
      if (!redis) return res.status(503).json({ ok: false, error: 'redis_unconfigured', message: 'Reference register is not configured yet. Ask the administrator to connect Upstash Redis in Vercel.' });
      const year = new Date().getUTCFullYear();
      const cfg = CONFIGURED_YEARS[brand][year];
      if (!cfg) return res.status(412).json({ ok: false, error: 'year_not_configured', message: 'Year ' + year + ' is not configured for ' + brand.toUpperCase() + '. Confirm the starting-sequence convention with the administrator before allocating the first reference of a new year.' });
      try {
        const result = await allocateRef(redis, brand, year, cfg.seed, idempotencyKey, clientName, staff);
        // Enforce one-key-per-client. If the idempotency key already carries a reference bound
        // to a different client name, refuse — never silently reassign or hand back a reference
        // registered against someone else. This is the server-side guarantee behind the UI lock.
        if (result.reused && result.storedEntry && String(result.storedEntry.clientName || '').trim() && String(result.storedEntry.clientName).trim().toLowerCase() !== clientName.toLowerCase()) {
          return res.status(409).json({ ok: false, error: 'allocation_key_bound_to_other_client', message: 'This allocation attempt is already bound to a different client (' + result.storedEntry.clientName + ') and reference ' + result.reference + '. To allocate a new reference, start a new client record.' });
        }
        return res.status(200).json({ ok: true, reference: result.reference, allocatedAt: result.allocatedAt, reused: result.reused });
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'allocate_failed', message: 'Could not allocate a reference. Please try again.' });
      }
    }

    if (action === 'register_search' && method === 'GET') {
      const redis = getRedis();
      if (!redis) return res.status(503).json({ ok: false, error: 'redis_unconfigured' });
      const q = String((req.query && req.query.q) || '').trim().toLowerCase().slice(0, 200);
      const brandFilter = String((req.query && req.query.brand) || '').toLowerCase();
      try {
        const results = await registerSearch(redis, q, brandFilter);
        return res.status(200).json({ ok: true, results });
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'search_failed' });
      }
    }

    if (action === 'register_lookup' && method === 'GET') {
      const redis = getRedis();
      if (!redis) return res.status(503).json({ ok: false, error: 'redis_unconfigured' });
      const reference = String((req.query && req.query.reference) || '').trim();
      if (!/^[A-Z0-9-]{6,80}$/i.test(reference)) return res.status(400).json({ ok: false, error: 'bad_reference' });
      try {
        const entry = await registerLookup(redis, reference);
        if (!entry) return res.status(404).json({ ok: false, error: 'not_found' });
        return res.status(200).json({ ok: true, reference, entry });
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'lookup_failed' });
      }
    }

    return res.status(400).json({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};

module.exports.__test = { verifyToken, mintToken, constEq, signKey, sessionToken, cookieSecure };
