// ============================================================================
//  ARIE Finance — preliminary eligibility check   (Vercel serverless function)
//  Route:  POST /api/eligibility   body: { answers: {...} }
//  Returns ONLY a public route ('standard' | 'continue_review' | 'hold') or the
//  country-specific follow-up questions still needed. Stores nothing, sends
//  nothing, and never returns risk lists, reasons or scores.
//
//  Probing: the three coarse routes can still be inferred by repeated queries,
//  so the rules are not secret. A per-IP limit shared across instances (the
//  project's existing Upstash Redis store) slows systematic probing; if Redis is
//  unavailable it falls back to a per-instance in-memory limit.
// ============================================================================
'use strict';
const { evaluate } = require('./_lib/eligibility-rules');
const { originAllowed, getIp, readBody } = require('./website-form').__shared;

const LIMITS = [
  { name: 'm', windowSec: 60, max: 8 },       // a person editing answers rarely needs more
  { name: 'h', windowSec: 3600, max: 30 },
];

let redis = null;
function getRedis() {
  if (redis !== null) return redis || null;
  const url = process.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;
  if (!url || !token) { redis = false; return null; }
  const { Redis } = require('@upstash/redis');
  redis = new Redis({ url, token });
  return redis;
}

const mem = new Map();
function memLimited(ip) {
  const now = Date.now();
  const arr = (mem.get(ip) || []).filter((t) => now - t < 3600 * 1000);
  arr.push(now); mem.set(ip, arr);
  if (mem.size > 5000) mem.clear();
  return LIMITS.some((l) => arr.filter((t) => now - t < l.windowSec * 1000).length > l.max);
}

async function limited(ip) {
  const r = getRedis();
  if (!r) return memLimited(ip);
  try {
    const env = (process.env.VERCEL_ENV || 'development').toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    for (const l of LIMITS) {
      const key = 'elig:rl:' + env + ':' + l.name + ':' + Math.floor(now / l.windowSec) + ':' + ip;
      const n = await r.incr(key);
      if (n === 1) await r.expire(key, l.windowSec + 5);
      if (n > l.max) return true;
    }
    return false;
  } catch (_) {
    return memLimited(ip);          // never fail open to unlimited; never fail closed for everyone
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed' }); }
  if (!originAllowed(req)) return res.status(403).json({ ok: false, error: 'forbidden_origin' });
  if (await limited(getIp(req))) return res.status(429).json({ ok: false, error: 'rate_limited' });
  const parsed = await readBody(req);
  if (parsed.tooLarge) return res.status(413).json({ ok: false, error: 'payload_too_large' });
  const body = parsed.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'invalid_body' });
  const r = evaluate(body.answers);
  if (r.error) return res.status(400).json({ ok: false, error: r.error });
  if (r.followUps) return res.status(200).json({ ok: true, followUps: r.followUps.map((f) => ({ type: f.type, countries: f.countries })) });
  return res.status(200).json(r.notice ? { ok: true, route: r.route, notice: r.notice } : { ok: true, route: r.route });
};

module.exports.__test = { LIMITS, memLimited };
