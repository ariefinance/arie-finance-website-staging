// ============================================================================
//  ARIE Finance — Document Builder Access API  (Vercel serverless)
//  Route:  /api/internal/pricing
//  Purpose: AUTHENTICATION / SESSION ONLY for the stateless tool at
//           /internal/pricing. Direct sibling of /api/managementreport:
//           same passcode → HMAC-session-cookie pattern, no document,
//           customer, or client data ever touches this API.
//
//  Redis keys (session infrastructure ONLY — never document content):
//    ip:signkey          STR  server HMAC key for session tokens
//    ip:loginfail:<ip>   STR  failed-login throttle counter (TTL)
//
//  ENV (production Vercel project):
//    INTERNAL_PRICING_PASSCODE               staff passcode (secret; never in source)
//    KV_REST_API_URL / KV_REST_API_TOKEN     (or UPSTASH_REDIS_REST_URL/TOKEN)
//  These KV creds are the same session store already configured for the site;
//  no document content is written under them.
//
//  Actions:
//    POST {action:"login", passcode}   -> sets HttpOnly cookie
//    POST {action:"logout"}            -> clears cookie
//    GET  ?action=session              -> { ok:true } when the cookie is valid
// ============================================================================

const crypto = require('crypto');

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
const PASSCODE = process.env.INTERNAL_PRICING_PASSCODE || '';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;   // login body is tiny; nothing large is posted
const LOGIN_WINDOW_S = 900;
const LOGIN_MAX_FAIL = 12;

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

// ---- session tokens (HMAC, server-side key) -------------------------------
let _signKey = null;
async function signKey() {
  if (_signKey) return _signKey;
  let k = await redis(['GET', 'ip:signkey']);
  if (!k) { const fresh = crypto.randomBytes(32).toString('hex'); await redis(['SET', 'ip:signkey', fresh, 'NX']); k = await redis(['GET', 'ip:signkey']); }
  _signKey = k; return k;
}
function b64url(s) { return Buffer.from(s).toString('base64url'); }
function mintToken(key) {
  const payload = b64url(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS }));
  return payload + '.' + crypto.createHmac('sha256', key).update(payload).digest('base64url');
}
function verifyToken(token, key) {
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

// ---- cookies (own namespace, scoped to this API path) ---------------------
const COOKIE = 'arie_ip';
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
function clientIp(req) { const x = req.headers['x-forwarded-for']; if (x) return String(x).split(',')[0].trim(); return (req.socket && req.socket.remoteAddress) || 'unknown'; }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (!REST_URL || !REST_TOKEN) return res.status(503).json({ ok: false, error: 'storage_unconfigured' });
  if (!PASSCODE) return res.status(503).json({ ok: false, error: 'passcode_unconfigured' });

  const method = req.method;
  const action = (req.query && req.query.action) || (method !== 'GET' ? (readBody(req).body || {}).action : '') || '';

  try {
    if (action === 'login') {
      if (method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method' }); }
      const ip = clientIp(req);
      const failKey = 'ip:loginfail:' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24);
      const fails = parseInt(await redis(['GET', failKey]) || '0', 10);
      if (fails >= LOGIN_MAX_FAIL) return res.status(429).json({ ok: false, error: 'too_many_attempts' });
      const { body, tooLarge } = readBody(req);
      if (tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
      const supplied = body && typeof body.passcode === 'string' ? body.passcode : '';
      if (!supplied || !constEq(supplied, PASSCODE)) {
        const n = await redis(['INCR', failKey]); if (n === 1) await redis(['EXPIRE', failKey, LOGIN_WINDOW_S]);
        return res.status(401).json({ ok: false, error: 'invalid_passcode' });
      }
      await redis(['DEL', failKey]);
      setCookie(res, req, mintToken(await signKey()), Math.floor(TOKEN_TTL_MS / 1000));
      return res.status(200).json({ ok: true, exp: Date.now() + TOKEN_TTL_MS });
    }

    if (action === 'logout') { setCookie(res, req, '', 0); return res.status(200).json({ ok: true }); }

    // Any other action requires a valid session. The only such action is a
    // lightweight session check so a returning operator within TTL is not
    // forced to sign in again. No document data is ever read or written here.
    if (!verifyToken(sessionToken(req), await signKey())) return res.status(401).json({ ok: false, error: 'unauthenticated' });

    if (action === 'session' && method === 'GET') return res.status(200).json({ ok: true });

    return res.status(400).json({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};

module.exports.__test = { verifyToken, mintToken, constEq, resolveRedisCreds, cookieSecure, sessionToken };
