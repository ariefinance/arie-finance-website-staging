// POST /api/insights/logout  -> clears the session cookie
'use strict';
const L = require('./_lib');

module.exports = async function handler(req, res) {
  L.sendSecurityHeaders(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method' }); }
  L.setCookie(res, req, '', 0);
  return res.status(200).json({ ok: true });
};
