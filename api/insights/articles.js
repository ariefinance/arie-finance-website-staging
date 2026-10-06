// GET /api/insights/articles           -> { articles: [...] }  (list, from manifest)
// GET /api/insights/articles?slug=xyz   -> { meta, body }        (single, for editing)
'use strict';
const L = require('./_lib');

module.exports = async function handler(req, res) {
  L.sendSecurityHeaders(res);
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ ok: false, error: 'method' }); }
  if (!L.configured()) return res.status(503).json({ ok: false, error: 'unconfigured' });
  if (!L.isAuthed(req)) return res.status(401).json({ ok: false, error: 'unauthenticated' });

  const branch = L.env().branch;
  const slug = req.query && req.query.slug ? String(req.query.slug) : '';

  try {
    if (slug) {
      if (!L.validSlug(slug)) return res.status(400).json({ ok: false, error: 'bad_slug' });
      const html = await L.getFile(`insights/${slug}/index.html`, branch);
      if (!html) return res.status(404).json({ ok: false, error: 'not_found' });
      const parsed = L.parseArticle(html);
      if (!parsed.meta) return res.status(422).json({ ok: false, error: 'unreadable_article' });
      return res.status(200).json({ ok: true, meta: parsed.meta, body: parsed.body });
    }
    const manifest = await L.readManifest(branch);
    return res.status(200).json({ ok: true, articles: L.sortArticles(manifest) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};
