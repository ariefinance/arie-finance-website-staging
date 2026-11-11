// POST /api/insights/publish { action:"create"|"update"|"unpublish", ... }
// Authentication remains here; deterministic validation/rendering is shared
// with the approved-draft publisher. One non-force Git commit applies the plan.
'use strict';
const L = require('./_lib');
const P = require('./_publisher');

module.exports = async function handler(req, res) {
  L.sendSecurityHeaders(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method' }); }
  if (!L.configured()) return res.status(503).json({ ok: false, error: 'unconfigured' });
  if (!L.sameOrigin(req)) return res.status(403).json({ ok: false, error: 'forbidden_origin' });
  if (!L.isAuthed(req)) return res.status(401).json({ ok: false, error: 'unauthenticated' });

  const { body, tooLarge } = L.readBody(req);
  if (tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ ok: false, error: 'bad_body' });
  const action = body.action;
  if (!['create', 'update', 'unpublish'].includes(action)) return res.status(400).json({ ok: false, error: 'unknown_action' });
  if (action !== 'create' && (!L.validSlug(body.slug) || L.RESERVED.has(body.slug))) return res.status(400).json({ ok: false, error: 'bad_slug' });

  const branch = L.env().branch;
  try {
    const head = await L.getHead(branch);
    const snapshot = await L.getPublicationSnapshot(head, action === 'create' ? [] : [body.slug]);
    const plan = P.planApiAction({ snapshot, action, input: body });
    const out = await L.commitAll(branch, head, plan.message, plan.entries);
    if (out.conflict) return res.status(409).json({ ok: false, error: 'conflict' });
    if (action === 'unpublish') return res.status(200).json({ ok: true, slug: plan.slug });
    return res.status(200).json({ ok: true, slug: plan.slug, url: plan.url });
  } catch (err) {
    if (err && err.code && err.status) return res.status(err.status).json({ ok: false, error: err.code });
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};

module.exports.__test = { validImage: P.validImage };
