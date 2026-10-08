// GET /api/insights/session  -> { authenticated: boolean }
'use strict';
const L = require('./_lib');

module.exports = async function handler(req, res) {
  L.sendSecurityHeaders(res);
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ ok: false, error: 'method' }); }
  return res.status(200).json({ ok: true, authenticated: L.isAuthed(req), configured: L.configured() });
};
