// ============================================================================
//  ARIE Finance — Document Builder Access API  (Vercel serverless)
//  Route:  /api/internal/pricing
//  Purpose: LOGIN / LOGOUT ONLY for the staff Document Builder served at
//           /internal/pricing/. Session verification lives in the Edge
//           middleware (middleware.js) — the cookie's Path=/internal/pricing
//           means it is not sent to /api/internal/pricing, so verification
//           here would be impossible even if it were wanted. Middleware is
//           the sole session verifier.
//
//  Redis keys (throttle infrastructure ONLY — no document/customer data):
//    ip:loginfail:<hashed-ip>   STR  failed-login throttle counter (TTL)
//
//  ENV (production Vercel project):
//    INTERNAL_PRICING_PASSCODE            staff passcode (secret; never in source)
//    INTERNAL_PRICING_SIGN_KEY            64 hex chars = 32 raw bytes; identical
//                                         bytes are used by /middleware.js to
//                                         verify tokens minted here
//    KV_REST_API_URL / KV_REST_API_TOKEN  (or UPSTASH_REDIS_REST_URL/TOKEN)
//
//  Actions:
//    POST {action:"login", passcode}   -> sets HttpOnly ip_sess cookie
//    POST {action:"logout"}            -> clears ip_sess cookie
//
//  There is deliberately NO session action. The middleware verifies every
//  request under /internal/pricing/*.
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
function signKeyRaw() { return process.env.INTERNAL_PRICING_SIGN_KEY || ''; }
function signKeyBytes() {
  const raw = signKeyRaw();
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
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || String(req.headers['x-real-ip'] || '') || (req.socket && req.socket.remoteAddress) || '0.0.0.0';
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

function constantTimeEqStrings(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // still do a compare to keep timing stable
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { req.destroy(); reject(new Error('too_large')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (_) { resolve({}); }
    });
    req.on('error', reject);
  });
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

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(body));
}

async function throttleCheck(ip) {
  const key = 'ip:loginfail:' + hashedIp(ip);
  const cur = parseInt((await redis(['GET', key])) || '0', 10) || 0;
  return cur >= LOGIN_MAX_FAIL;
}
async function throttleBump(ip) {
  const key = 'ip:loginfail:' + hashedIp(ip);
  await redis(['INCR', key]);
  await redis(['EXPIRE', key, String(LOGIN_WINDOW_S)]);
}
async function throttleClear(ip) {
  const key = 'ip:loginfail:' + hashedIp(ip);
  try { await redis(['DEL', key]); } catch (_) { /* ignore */ }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const action = String(body.action || '').toLowerCase();

      if (action === 'logout') {
        // Cookie is scoped to /internal/pricing, so it is not sent here.
        // Simply expire it unconditionally.
        setCookie(res, '', 0);
        return json(res, 200, { ok: true });
      }

      if (action === 'login') {
        const passcode = String(body.passcode || '');
        const keyBytes = signKeyBytes();
        const truth = passcodeRaw();
        if (!keyBytes || !truth) return json(res, 500, { ok: false, code: 'not_configured' });

        const ip = clientIp(req);
        try {
          if (await throttleCheck(ip)) return json(res, 429, { ok: false, code: 'throttled' });
        } catch (_) {
          return json(res, 500, { ok: false, code: 'storage_unconfigured' });
        }

        if (!passcode || !constantTimeEqStrings(passcode, truth)) {
          try { await throttleBump(ip); } catch (_) { /* ignore */ }
          return json(res, 401, { ok: false, code: 'invalid_passcode' });
        }

        try { await throttleClear(ip); } catch (_) { /* ignore */ }
        setCookie(res, mintToken(keyBytes), Math.floor(TOKEN_TTL_MS / 1000));
        return json(res, 200, { ok: true });
      }

      return json(res, 400, { ok: false, code: 'bad_action' });
    }

    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, code: 'method_not_allowed' });
  } catch (err) {
    return json(res, 500, { ok: false, code: 'internal_error' });
  }
};
