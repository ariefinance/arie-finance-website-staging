// POST /api/insights/publish
//   { action:"create"|"update"|"unpublish", ... }
// Every action is ONE atomic commit (article file + listing + homepage + sitemap
// + manifest). Non-fast-forward ref updates are reported as a conflict.
'use strict';
const L = require('./_lib');

function validImage(u) {
  if (!u) return true; // optional
  return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 500;
}

async function rebuildEntries(branch, manifest) {
  // Returns the tree entries for the shared files, rebuilt from `manifest`.
  const [listingSrc, homeSrc, sitemapSrc] = await Promise.all([
    L.getFile('insights/index.html', branch),
    L.getFile('index.html', branch),
    L.getFile('sitemap.xml', branch),
  ]);
  if (!listingSrc || !homeSrc || !sitemapSrc) throw new Error('missing_shared_file');
  const listing = L.replaceRegion(listingSrc, L.MARK.listStart, L.MARK.listEnd, L.renderListingRegion(manifest));
  const home = L.replaceRegion(homeSrc, L.MARK.homeStart, L.MARK.homeEnd, L.renderHomeRegion(manifest));
  const sitemap = L.replaceRegion(sitemapSrc, L.MARK.siteStart, L.MARK.siteEnd, L.renderSitemapRegion(manifest));
  return [
    { path: 'insights/index.html', content: listing },
    { path: 'index.html', content: home },
    { path: 'sitemap.xml', content: sitemap },
    { path: 'insights/_articles.json', content: L.manifestJSON(manifest) },
  ];
}

module.exports = async function handler(req, res) {
  L.sendSecurityHeaders(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method' }); }
  if (!L.configured()) return res.status(503).json({ ok: false, error: 'unconfigured' });
  if (!L.sameOrigin(req)) return res.status(403).json({ ok: false, error: 'forbidden_origin' });
  if (!L.isAuthed(req)) return res.status(401).json({ ok: false, error: 'unauthenticated' });

  const { body, tooLarge } = L.readBody(req);
  if (tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'bad_body' });
  const action = body.action;
  const branch = L.env().branch;

  try {
    const head = await L.getHead(branch);
    const manifest = await L.readManifest(branch);

    // ---------- UNPUBLISH ----------
    if (action === 'unpublish') {
      const slug = String(body.slug || '');
      if (!L.validSlug(slug)) return res.status(400).json({ ok: false, error: 'bad_slug' });
      const idx = manifest.findIndex((a) => a.slug === slug);
      if (idx < 0) return res.status(404).json({ ok: false, error: 'not_found' });
      const removed = manifest[idx];
      const next = manifest.filter((a) => a.slug !== slug);
      const entries = await rebuildEntries(branch, next);
      entries.push({ path: `insights/${slug}/index.html`, delete: true });
      const out = await L.commitAll(branch, head, `Unpublish ARIE Insights: ${removed.title}`, entries);
      if (out.conflict) return res.status(409).json({ ok: false, error: 'conflict' });
      return res.status(200).json({ ok: true, slug });
    }

    // ---------- CREATE / UPDATE ----------
    if (action !== 'create' && action !== 'update') return res.status(400).json({ ok: false, error: 'unknown_action' });

    const title = String(body.title || '').trim();
    const category = String(body.category || '').trim();
    const summary = String(body.summary || '').trim();
    const confirm = body.confirm === true;
    const image = body.image ? String(body.image).trim() : '';
    const imageAlt = body.imageAlt ? String(body.imageAlt).trim() : '';

    if (!title || title.length > 160) return res.status(400).json({ ok: false, error: 'bad_title' });
    if (!L.CATEGORIES.includes(category)) return res.status(400).json({ ok: false, error: 'bad_category' });
    if (!summary || summary.length > 400) return res.status(400).json({ ok: false, error: 'bad_summary' });
    if (!validImage(image)) return res.status(400).json({ ok: false, error: 'bad_image' });
    if (image && !imageAlt) return res.status(400).json({ ok: false, error: 'image_alt_required' });
    if (!confirm) return res.status(400).json({ ok: false, error: 'confirm_required' });

    const cleanBody = L.sanitizeBody(body.body);
    if (!L.bodyHasContent(cleanBody)) return res.status(400).json({ ok: false, error: 'empty_body' });

    if (action === 'create') {
      const slug = L.slugify(body.slug || title);
      if (!L.validSlug(slug) || L.RESERVED.has(slug)) return res.status(400).json({ ok: false, error: 'bad_slug' });
      if (manifest.some((a) => a.slug === slug)) return res.status(409).json({ ok: false, error: 'slug_exists' });
      const meta = { slug, title, category, summary, published: L.todayISO(), lastReviewed: null, image: image || null, imageAlt: image ? imageAlt : null };
      const next = manifest.concat([meta]);
      const entries = await rebuildEntries(branch, next);
      entries.push({ path: `insights/${slug}/index.html`, content: L.renderArticle(meta, cleanBody) });
      const out = await L.commitAll(branch, head, `Publish ARIE Insights: ${title}`, entries);
      if (out.conflict) return res.status(409).json({ ok: false, error: 'conflict' });
      return res.status(200).json({ ok: true, slug, url: `${L.SITE}/insights/${slug}/` });
    }

    // update
    const oldSlug = String(body.slug || '');
    if (!L.validSlug(oldSlug)) return res.status(400).json({ ok: false, error: 'bad_slug' });
    const existing = manifest.find((a) => a.slug === oldSlug);
    if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });

    // Slug may be intentionally changed; default to preserving it.
    let newSlug = oldSlug;
    if (body.newSlug) {
      newSlug = L.slugify(body.newSlug);
      if (!L.validSlug(newSlug) || L.RESERVED.has(newSlug)) return res.status(400).json({ ok: false, error: 'bad_slug' });
      if (newSlug !== oldSlug && manifest.some((a) => a.slug === newSlug)) return res.status(409).json({ ok: false, error: 'slug_exists' });
    }

    const published = existing.published; // preserve original publication date
    let lastReviewed = existing.lastReviewed || null;
    // Last Reviewed: Guides only, set to today ONLY on an explicit editorial review,
    // and only when today is genuinely later than the publication date.
    if (category === 'Guides' && body.recordReview === true) {
      const today = L.todayISO();
      if (today > published) lastReviewed = today;
    }
    if (category !== 'Guides') lastReviewed = null;

    const meta = { slug: newSlug, title, category, summary, published, lastReviewed, image: image || null, imageAlt: image ? imageAlt : null };
    const next = manifest.map((a) => (a.slug === oldSlug ? meta : a));
    const entries = await rebuildEntries(branch, next);
    entries.push({ path: `insights/${newSlug}/index.html`, content: L.renderArticle(meta, cleanBody) });
    if (newSlug !== oldSlug) entries.push({ path: `insights/${oldSlug}/index.html`, delete: true });
    const out = await L.commitAll(branch, head, `Update ARIE Insights: ${title}`, entries);
    if (out.conflict) return res.status(409).json({ ok: false, error: 'conflict' });
    return res.status(200).json({ ok: true, slug: newSlug, url: `${L.SITE}/insights/${newSlug}/` });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};

module.exports.__test = { validImage };
