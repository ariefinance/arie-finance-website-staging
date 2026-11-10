// ============================================================================
//  ARIE Finance — preliminary eligibility check   (Vercel serverless function)
//  Route:  POST /api/eligibility   body: { answers: {...} }
//  Returns ONLY a public route ('standard' | 'continue_review' | 'hold') or the
//  country-specific follow-up questions still needed. Stores nothing, sends
//  nothing, and never returns risk lists, reasons or scores.
// ============================================================================
'use strict';
const { evaluate } = require('./_lib/eligibility-rules');
const { originAllowed, getIp, readBody } = require('./website-form').__shared;

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;            // applicants may edit and re-check answers
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed' }); }
  if (!originAllowed(req)) return res.status(403).json({ ok: false, error: 'forbidden_origin' });
  if (limited(getIp(req))) return res.status(429).json({ ok: false, error: 'rate_limited' });
  const parsed = await readBody(req);
  if (parsed.tooLarge) return res.status(413).json({ ok: false, error: 'payload_too_large' });
  const body = parsed.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'invalid_body' });
  const r = evaluate(body.answers);
  if (r.error) return res.status(400).json({ ok: false, error: r.error });
  if (r.followUps) return res.status(200).json({ ok: true, followUps: r.followUps.map((f) => ({ type: f.type, countries: f.countries })) });
  return res.status(200).json({ ok: true, route: r.route });
};
