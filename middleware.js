// ============================================================================
//  ARIE Finance — Routing Middleware
//  Enforces staff-only access at the request level for /internal/pricing/*
//  (the ARIE Document Builder). Runs on Vercel's Edge Runtime, before the
//  static CDN serves any file, so unauthenticated GETs to app.js, wiring.js,
//  render.js, exports.js, vendor/*, assets/*, styles.css, index.html and
//  MANIFEST.txt all return 401. The tool cannot be downloaded and
//  reassembled off-site without a valid session cookie.
//
//  Not authentication of the whole site — matcher is scoped to
//  /internal/pricing and /internal/pricing/:path* only. The rest of the
//  ARIE marketing site is untouched.
//
//  Verification only. Token minting lives in /api/internal/pricing.
//  Both sides HMAC-SHA-256 the same bytes: env INTERNAL_PRICING_SIGN_KEY is
//  64 hex characters representing 32 bytes; API side calls
//  Buffer.from(env,'hex'); middleware decodes hex → Uint8Array here.
// ============================================================================

export const config = {
  matcher: ['/internal/pricing', '/internal/pricing/:path*'],
};

const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/;
const COOKIE_NAME = 'ip_sess';
const GATE_HTML = '/internal/pricing/gate.html';
const GATE_JS = '/internal/pricing/gate.js';
const GATE_CSS = '/internal/pricing/gate.css';
const ALLOW_UNAUTH = new Set([GATE_HTML, GATE_JS, GATE_CSS]);
const APP_ROOTS = new Set(['/internal/pricing', '/internal/pricing/']);

let _keyPromise = null;
async function loadKey() {
  if (_keyPromise) return _keyPromise;
  const raw = (globalThis.process && process.env && process.env.INTERNAL_PRICING_SIGN_KEY) || '';
  if (!HEX_KEY_RE.test(raw)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(raw.substr(i * 2, 2), 16);
  _keyPromise = crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  ).catch(() => null);
  return _keyPromise;
}

function b64urlToBytes(s) {
  if (typeof s !== 'string' || !s) return null;
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (_) {
    return null;
  }
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  const parts = header.split(/;\s*/);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    if (p.slice(0, eq) === name) return p.slice(eq + 1);
  }
  return '';
}

async function tokenValid(token, key) {
  if (!key || !token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1 || dot === token.length - 1) return false;
  const payloadStr = token.slice(0, dot);
  const sigStr = token.slice(dot + 1);
  const sig = b64urlToBytes(sigStr);
  if (!sig) return false;
  const enc = new TextEncoder();
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', key, sig, enc.encode(payloadStr)); }
  catch (_) { return false; }
  if (!ok) return false;
  const payloadBytes = b64urlToBytes(payloadStr);
  if (!payloadBytes) return false;
  let json;
  try { json = JSON.parse(new TextDecoder().decode(payloadBytes)); }
  catch (_) { return false; }
  if (!json || typeof json.exp !== 'number') return false;
  if (Date.now() >= json.exp) return false;
  return true;
}

function deny(status) {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function toGate(request) {
  const url = new URL(GATE_HTML, request.url);
  return Response.redirect(url.toString(), 302);
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Login shell is always reachable — nothing sensitive lives here.
  if (ALLOW_UNAUTH.has(pathname)) return; // pass through to static CDN

  // Fail closed if signing key is missing/malformed.
  const key = await loadKey();
  if (!key) {
    if (APP_ROOTS.has(pathname)) {
      return new Response(
        '<!doctype html><meta charset="utf-8"><title>Unavailable</title>' +
        '<p style="font:14px system-ui;padding:24px">This tool is temporarily unavailable. ' +
        'Please contact the administrator.</p>',
        { status: 503, headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, max-age=0',
          'X-Robots-Tag': 'noindex, nofollow',
        } }
      );
    }
    return deny(503);
  }

  const token = readCookie(request, COOKIE_NAME);
  const ok = await tokenValid(token, key);
  if (ok) return; // pass through to static CDN

  // Unauthenticated: navigations to the app root land on the gate; every
  // other protected asset is a hard 401 with no body.
  if (APP_ROOTS.has(pathname)) return toGate(request);
  return deny(401);
}
