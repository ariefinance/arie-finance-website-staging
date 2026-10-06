// POST /api/insights/login  { password }  -> sets HttpOnly session cookie
'use strict';
const L = require('./_lib');

// Best-effort in-memory login throttle (resets on cold start; Vercel is stateless).
const FAILS = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAIL = 10;
function throttled(ip) { const r = FAILS.get(ip); return r && r.exp > Date.now() && r.n >= MAX_FAIL; }
function bump(ip) { const now = Date.now(); const r = FAILS.get(ip); if (!r || r.exp <= now) FAILS.set(ip, { n: 1, exp: now + WINDOW_MS }); else r.n++; }
function clear(ip) { FAILS.delete(ip); }

module.exports = async function handler(req, res) {
  L.sendSecurityHeaders(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method' }); }
  if (!L.configured()) return res.status(503).json({ ok: false, error: 'unconfigured' });
  if (!L.sameOrigin(req)) return res.status(403).json({ ok: false, error: 'forbidden_origin' });

  const ip = L.clientIp(req);
  if (throttled(ip)) return res.status(429).json({ ok: false, error: 'too_many_attempts' });

  const { body, tooLarge } = L.readBody(req);
  if (tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
  const supplied = body && typeof body.password === 'string' ? body.password : '';
  const e = L.env();
  if (!supplied || !L.constEq(supplied, e.password)) {
    bump(ip);
    return res.status(401).json({ ok: false, error: 'invalid_password' });
  }
  clear(ip);
  L.setCookie(res, req, L.mintToken(e.secret), Math.floor((8 * 60 * 60 * 1000) / 1000));
  return res.status(200).json({ ok: true });
};
