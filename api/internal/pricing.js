// ============================================================================
//  ARIE Finance — Document Builder Access API  (Vercel serverless)
//  Route:  /api/internal/pricing
//  Purpose: LOGIN / LOGOUT ONLY. The Edge middleware (/middleware.js) is the
//           sole session verifier — the cookie's Path=/internal/pricing means
//           it is never sent to /api/internal/pricing, so verification here
//           is impossible even if wanted.
//
//  Redis keys (throttle infrastructure ONLY — no document/customer data):
//    ip:loginfail:<hashed-ip>   STR  failed-login throttle counter (TTL)
//
//  ENV (Vercel project):
//    INTERNAL_PRICING_PASSCODE            staff passcode (secret; never in source)
//    INTERNAL_PRICING_SIGN_KEY            64 hex chars = 32 raw bytes; identical
//                                         bytes are used by /middleware.js to
//                                         verify tokens minted here
//    KV_REST_API_URL / KV_REST_API_TOKEN  (or UPSTASH_REDIS_REST_URL/TOKEN)
//
//  Actions:
//    POST {action:"login", passcode}   -> sets HttpOnly ip_sess cookie
//    POST {action:"logout"}            -> clears ip_sess cookie
// ============================================================================

const crypto = require('crypto');

const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const LOGIN_WINDOW_S = 900;
const LOGIN_MAX_FAIL = 12;
const COOKIE_NAME = 'ip_sess';
const COOKIE_PATH = '/internal/pricing';

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
const REST_URL = _creds.url;
const REST_TOKEN = _creds.token;

function passcodeRaw() { return process.env.INTERNAL_PRICING_PASSCODE || ''; }
function signKeyBytes() {
  const raw = process.env.INTERNAL_PRICING_SIGN_KEY || '';
  if (!HEX_KEY_RE.test(raw)) return null;
  return Buffer.from(raw, 'hex');
}

async function redis(cmd) {
  if (!REST_URL || !REST_TOKEN) throw new Error('redis:unconfigured');
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('redis: ' + (j.error || r.status));
  return j.result;
}

function clientIp(req) {
  const x = req.headers['x-forwarded-for'];
  if (x) return String(x).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function hashedIp(ip) {
  return crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 24);
}

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function mintToken(keyBytes) {
  const payloadStr = b64url(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS }));
  const sig = crypto.createHmac('sha256', keyBytes).update(payloadStr).digest();
  return payloadStr + '.' + b64url(sig);
}

function constEq(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) { crypto.timingSafeEqual(ab, ab); return false; }
  return crypto.timingSafeEqual(ab, bb);
}

// Same shape as api/managementreport.js — reads req.body when Vercel has
// already parsed it (object) or delivered it as a raw string. Never falls
// back to consuming the stream, so the body-parse contract matches the
// other proven tools in this repo.
function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY_BYTES) return { tooLarge: true };
    return { body: req.body };
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) return { tooLarge: true };
    try { return { body: JSON.parse(req.body) }; } catch (_) { return { body: null }; }
  }
  return { body: {} };
}

function setCookie(res, value, maxAgeSec) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    `Path=${COOKIE_PATH}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAgeSec}`,
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method' });
  }

  const parsed = readBody(req);
  if (parsed.tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
  const body = parsed.body || {};
  const action = String(body.action || '').toLowerCase();

  if (action === 'logout') {
    // The cookie's Path scopes it away from this endpoint anyway; expire it
    // unconditionally so clients that reach here always get a clean state.
    setCookie(res, '', 0);
    return res.status(200).json({ ok: true });
  }

  if (action !== 'login') return res.status(400).json({ ok: false, error: 'bad_action' });

  const truth = passcodeRaw();
  const keyBytes = signKeyBytes();
  if (!truth) return res.status(503).json({ ok: false, error: 'passcode_unconfigured' });
  if (!keyBytes) return res.status(503).json({ ok: false, error: 'sign_key_unconfigured' });

  const ip = clientIp(req);
  const failKey = 'ip:loginfail:' + hashedIp(ip);
  let fails = 0;
  try { fails = parseInt((await redis(['GET', failKey])) || '0', 10) || 0; }
  catch (_) { return res.status(503).json({ ok: false, error: 'storage_unconfigured' }); }
  if (fails >= LOGIN_MAX_FAIL) return res.status(429).json({ ok: false, error: 'too_many_attempts' });

  const supplied = typeof body.passcode === 'string' ? body.passcode : '';
  if (!supplied || !constEq(supplied, truth)) {
    try {
      const n = await redis(['INCR', failKey]);
      if (n === 1) await redis(['EXPIRE', failKey, LOGIN_WINDOW_S]);
    } catch (_) { /* ignore */ }
    return res.status(401).json({ ok: false, error: 'invalid_passcode' });
  }

  try { await redis(['DEL', failKey]); } catch (_) { /* ignore */ }
  setCookie(res, mintToken(keyBytes), Math.floor(TOKEN_TTL_MS / 1000));
  return res.status(200).json({ ok: true, exp: Date.now() + TOKEN_TTL_MS });
};
