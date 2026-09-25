// ============================================================================
//  ARIE Finance — Wire Transfer Tool Access API  (Vercel serverless)
//  Route:  /api/internal/wire-transfer
//  Purpose: LOGIN / LOGOUT / SESSION-CHECK only.
//
//  This tool has ONE dependency: the environment variable
//    INTERNAL_WIRE_TRANSFER_PASSCODE   — the shared staff passcode.
//
//  No Redis. No database. No signing-key env var. The HMAC session-signing
//  key is derived from the passcode itself (SHA-256), so rotating the
//  passcode automatically invalidates every live cookie.
//
//  Cookie:
//    arie_iwt=<token>; Path=/api/internal/wire-transfer; HttpOnly; Secure;
//            SameSite=Strict; Max-Age=43200
//
//  Actions:
//    POST {action:"login", passcode}   -> sets cookie
//    POST {action:"logout"}            -> clears cookie
//    GET  ?action=session              -> { ok:true } when the cookie is valid
// ============================================================================

const crypto = require('crypto');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const COOKIE = 'arie_iwt';

function passcodeRaw() { return process.env.INTERNAL_WIRE_TRANSFER_PASSCODE || ''; }
function signKey() {
  const p = passcodeRaw();
  if (!p) return null;
  // Deriving the HMAC key from the passcode means rotating the passcode
  // invalidates every live cookie automatically. No key material lives
  // outside this env var.
  return crypto.createHash('sha256').update('arie-iwt-signkey:' + p).digest();
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
  const parts = [COOKIE + '=' + token, 'Path=/api/internal/wire-transfer', 'Max-Age=' + maxAgeS, 'HttpOnly', 'SameSite=Strict'];
  if (cookieSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function sessionToken(req) { const c = req.headers.cookie || ''; const m = c.match(/(?:^|;\s*)arie_iwt=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }

function readBody(req) {
  if (req.body && typeof req.body === 'object') { if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY_BYTES) return { tooLarge: true }; return { body: req.body }; }
  if (typeof req.body === 'string') { if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) return { tooLarge: true }; try { return { body: JSON.parse(req.body) }; } catch { return { body: null }; } }
  return { body: {} };
}

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

    return res.status(400).json({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};

module.exports.__test = { verifyToken, mintToken, constEq, signKey, sessionToken, cookieSecure };
