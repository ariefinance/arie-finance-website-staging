// Shared, deterministic publication planning. This module performs NO writes,
// network calls or consent inference. Transport must apply entries atomically
// against baseSha. The caller supplies approval from the live user boundary;
// a matching fingerprint alone never authorises publication.
'use strict';
const crypto = require('crypto');
const L = require('./_lib');

const PATHS = Object.freeze({
  listing: 'insights/index.html', home: 'index.html', sitemap: 'sitemap.xml',
  manifest: 'insights/_articles.json', receipts: 'insights/_publication-receipts.json',
});
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const VERSION = /^v[1-9]\d*$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const DRAFT_KEYS = ['schemaVersion', 'id', 'version', 'title', 'category', 'summary', 'body', 'slug', 'url', 'fingerprint'];
const META_KEYS = ['slug', 'title', 'category', 'summary', 'published', 'lastReviewed', 'image', 'imageAlt'];
const RECEIPT_KEYS = ['id', 'version', 'fingerprint', 'slug', 'url', 'publicBodyDigest', 'publishedAt'];
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const validId = (value) => typeof value === 'string' && ID.test(value);
const validVersion = (value) => typeof value === 'string' && VERSION.test(value);
function fail(code, status = 400) { const e = new Error(code); e.code = code; e.status = status; throw e; }
function keysOnly(value, allowed, code) {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail(code);
}
function digest(value) { return 'sha256:' + crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function articlePath(slug) { return `insights/${slug}/index.html`; }
function articleUrl(slug) { return `${L.SITE}/insights/${slug}/`; }
function validImage(value) {
  return !value || (typeof value === 'string' && /^https:\/\/[^\s"'<>]+$/.test(value) && value.length <= 500);
}
function slugOK(slug) { return L.validSlug(slug) && !L.RESERVED.has(slug); }
function parseJSON(text, code) {
  if (typeof text !== 'string' || !text.trim()) fail(code);
  try { return JSON.parse(text); } catch { fail(code); }
}
function validateTextFields(value, code) {
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160 || value.title !== value.title.trim()) fail(code || 'bad_title');
  if (!L.CATEGORIES.includes(value.category)) fail(code || 'bad_category');
  if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 400 || value.summary !== value.summary.trim()) fail(code || 'bad_summary');
}

// Present-but-invalid data is never treated as an empty publication history.
// Only known public fields are accepted, so private notes cannot leak through
// a shared-file regeneration.
function parseManifest(text) {
  const data = parseJSON(text, 'invalid_manifest');
  keysOnly(data, ['articles'], 'invalid_manifest');
  if (!Array.isArray(data.articles)) fail('invalid_manifest');
  const seen = new Set();
  return data.articles.map((a) => {
    keysOnly(a, META_KEYS, 'invalid_manifest');
    validateTextFields(a, 'invalid_manifest');
    if (!slugOK(a.slug) || seen.has(a.slug) || !L.validDate(a.published)) fail('invalid_manifest');
    seen.add(a.slug);
    if (a.lastReviewed != null && (!L.validDate(a.lastReviewed) || a.lastReviewed <= a.published || a.category !== 'Guides')) fail('invalid_manifest');
    if (a.image != null && (typeof a.image !== 'string' || !a.image || !validImage(a.image))) fail('invalid_manifest');
    if (a.image && (typeof a.imageAlt !== 'string' || !a.imageAlt.trim())) fail('invalid_manifest');
    if (!a.image && a.imageAlt != null) fail('invalid_manifest');
    return { slug: a.slug, title: a.title, category: a.category, summary: a.summary,
      published: a.published, lastReviewed: a.lastReviewed || null,
      image: a.image || null, imageAlt: a.image ? a.imageAlt : null };
  });
}

function parseReceipts(text) {
  if (text === null) return Object.create(null);
  const data = parseJSON(text, 'invalid_receipts');
  keysOnly(data, ['schemaVersion', 'receipts'], 'invalid_receipts');
  if (data.schemaVersion !== 1 || !object(data.receipts)) fail('invalid_receipts');
  const records = Object.create(null);
  for (const [key, r] of Object.entries(data.receipts)) {
    keysOnly(r, RECEIPT_KEYS, 'invalid_receipts');
    if (!validId(r.id) || !validVersion(r.version) || key !== `${r.id}/${r.version}` ||
        !HASH.test(r.fingerprint) || !slugOK(r.slug) || r.url !== articleUrl(r.slug) ||
        !HASH.test(r.publicBodyDigest) || typeof r.publishedAt !== 'string' ||
        Number.isNaN(Date.parse(r.publishedAt)) || new Date(r.publishedAt).toISOString() !== r.publishedAt) fail('invalid_receipts');
    records[key] = { id: r.id, version: r.version, fingerprint: r.fingerprint,
      slug: r.slug, url: r.url, publicBodyDigest: r.publicBodyDigest, publishedAt: r.publishedAt };
  }
  return records;
}
function receiptsJSON(records) {
  const sorted = Object.fromEntries(Object.keys(records).sort().map((key) => [key, records[key]]));
  return JSON.stringify({ schemaVersion: 1, receipts: sorted }, null, 2) + '\n';
}
function snapshotFile(snapshot, path, nullable = false) {
  if (!snapshot || !object(snapshot.files) || !own(snapshot.files, path)) fail('snapshot_missing_file');
  const value = snapshot.files[path];
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || (!nullable && !value)) fail('snapshot_missing_file');
  return value;
}
function region(text, start, end) {
  // Reuse the renderer's uniqueness/order validation before examining a region.
  try { L.replaceRegion(text, start, end, ''); } catch { fail('markers_missing'); }
  return text.slice(text.indexOf(start) + start.length, text.indexOf(end));
}
function readSnapshotManifest(snapshot) {
  const text = snapshotFile(snapshot, PATHS.manifest, true);
  if (text !== null) return parseManifest(text);
  const receipts = parseReceipts(snapshotFile(snapshot, PATHS.receipts, true));
  if (!Array.isArray(snapshot.articlePaths) || snapshot.articlePaths.length || Object.keys(receipts).length) fail('missing_manifest');
  const list = region(snapshotFile(snapshot, PATHS.listing), L.MARK.listStart, L.MARK.listEnd);
  const home = region(snapshotFile(snapshot, PATHS.home), L.MARK.homeStart, L.MARK.homeEnd);
  const site = region(snapshotFile(snapshot, PATHS.sitemap), L.MARK.siteStart, L.MARK.siteEnd);
  if (!/class="ins-empty"/.test(list) || /<a\b/i.test(list) || home.trim() || site.trim()) fail('missing_manifest');
  return [];
}
function inspectSnapshot(snapshot) {
  if (!snapshot || !/^[a-f0-9]{40}$/.test(snapshot.baseSha)) fail('invalid_snapshot');
  for (const path of [PATHS.listing, PATHS.home, PATHS.sitemap]) snapshotFile(snapshot, path);
  const manifest = readSnapshotManifest(snapshot);
  const receipts = parseReceipts(snapshotFile(snapshot, PATHS.receipts, true));
  return { manifest, receipts };
}
function takenSlugs(snapshot, manifest, receipts) {
  const taken = new Set([...L.RESERVED, ...manifest.map((a) => a.slug), ...Object.values(receipts).map((r) => r.slug)]);
  for (const path of snapshot.articlePaths || []) {
    const m = /^insights\/([^/]+)\/index\.html$/.exec(path);
    if (m) taken.add(m[1]);
  }
  return taken;
}

// The fingerprint covers approved public content and the frozen URL, not
// private research or an inferred approval. Publication time is assigned later.
function publicDraft(value) {
  return { schemaVersion: 1, id: value.id, version: value.version,
    title: value.title, category: value.category, summary: value.summary,
    body: value.body, slug: value.slug, url: value.url };
}
function fingerprint(draft) { return digest(JSON.stringify(publicDraft(draft))); }
function prepareDraft(input, options = {}) {
  if (!object(input) || !validId(input.id) || !validVersion(input.version)) fail('bad_draft_id');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  const category = typeof input.category === 'string' ? input.category.trim() : '';
  validateTextFields({ title, summary, category });
  if (typeof input.body !== 'string' || Buffer.byteLength(input.body, 'utf8') > 1024 * 1024) fail('bad_body');
  const body = L.sanitizeBody(input.body);
  if (!L.bodyHasContent(body)) fail('empty_body');
  const state = options.snapshot ? inspectSnapshot(options.snapshot) : { manifest: [], receipts: {} };
  const taken = takenSlugs(options.snapshot || {}, state.manifest, state.receipts);
  const slug = input.slug == null ? L.uniqueSlug(title, taken) : input.slug;
  if (!slugOK(slug)) fail('bad_slug');
  if (taken.has(slug)) fail('slug_conflict', 409);
  const draft = { schemaVersion: 1, id: input.id, version: input.version, title, category, summary, body, slug, url: articleUrl(slug) };
  return Object.freeze({ ...draft, fingerprint: fingerprint(draft) });
}
function validateDraft(draft) {
  keysOnly(draft, DRAFT_KEYS, 'invalid_draft');
  if (draft.schemaVersion !== 1 || !validId(draft.id) || !validVersion(draft.version) ||
      !slugOK(draft.slug) || draft.url !== articleUrl(draft.slug)) fail('invalid_draft');
  validateTextFields(draft, 'invalid_draft');
  if (typeof draft.body !== 'string' || Buffer.byteLength(draft.body, 'utf8') > 1024 * 1024 ||
      !L.bodyHasContent(draft.body) || L.sanitizeBody(draft.body) !== draft.body) fail('invalid_draft');
  if (!HASH.test(draft.fingerprint) || draft.fingerprint !== fingerprint(draft)) fail('fingerprint_mismatch');
  return Object.freeze({ ...publicDraft(draft), fingerprint: draft.fingerprint });
}

function activateNavigation(home) {
  const navPattern = /<nav\b[^>]*class="nav-links"[^>]*>[\s\S]*?<\/nav>/;
  const nav = home.match(navPattern);
  if (!nav) fail('navigation_marker_missing');
  if (!/href="\/insights\/"/.test(nav[0])) {
    const marker = /<!-- ARIE_INSIGHTS_NAV:[\s\S]*?-->/;
    if (!marker.test(nav[0])) fail('navigation_marker_missing');
    home = home.replace(nav[0], nav[0].replace(marker,
      '<!-- ARIE_INSIGHTS_NAV: Activated with the first approved article. -->\n          <a href="/insights/">Insights</a>'));
  }
  const companyPattern = /(<span class="footer-title">Company<\/span>\s*<div class="footer-list">)([\s\S]*?)(<\/div>)/;
  const company = home.match(companyPattern);
  if (!company) fail('navigation_marker_missing');
  if (!/href="\/insights\/"/.test(company[2])) {
    const careers = /<a\b[^>]*href="\/?#careers"[^>]*>Careers<\/a>/;
    if (!careers.test(company[2])) fail('navigation_marker_missing');
    const links = company[2].replace(careers, (a) => a + '<a href="/insights/">Insights</a>');
    home = home.replace(company[0], company[1] + links + company[3]);
  }
  return home;
}
function sharedEntries(snapshot, previous, next) {
  let home = snapshotFile(snapshot, PATHS.home);
  if (!previous.length && next.length) home = activateNavigation(home);
  try {
    return [
      { path: PATHS.listing, content: L.replaceRegion(snapshotFile(snapshot, PATHS.listing), L.MARK.listStart, L.MARK.listEnd, L.renderListingRegion(next)) },
      { path: PATHS.home, content: L.replaceRegion(home, L.MARK.homeStart, L.MARK.homeEnd, L.renderHomeRegion(next)) },
      { path: PATHS.sitemap, content: L.replaceRegion(snapshotFile(snapshot, PATHS.sitemap), L.MARK.siteStart, L.MARK.siteEnd, L.renderSitemapRegion(next)) },
      { path: PATHS.manifest, content: L.manifestJSON(next) },
    ];
  } catch { fail('markers_missing'); }
}
function clock(now) {
  const value = now === undefined ? new Date() : new Date(now);
  if (Number.isNaN(value.getTime())) fail('invalid_date');
  return value;
}
function initialMeta(content, slug, now) {
  return { slug, title: content.title, category: content.category, summary: content.summary,
    published: L.todayISO(now), lastReviewed: null, image: null, imageAlt: null };
}

function planApprovedPublication({ snapshot, draft, approval, now } = {}) {
  const checked = validateDraft(draft);
  if (approval !== `Approve ${checked.id}/${checked.version} for publication`) fail('approval_required', 403);
  const { manifest, receipts } = inspectSnapshot(snapshot);
  const key = `${checked.id}/${checked.version}`;
  const previous = receipts[key];
  if (previous) {
    if (previous.fingerprint !== checked.fingerprint || previous.slug !== checked.slug || previous.url !== checked.url) fail('receipt_mismatch', 409);
    const current = snapshotFile(snapshot, articlePath(checked.slug), true);
    const listed = manifest.some((a) => a.slug === checked.slug);
    if ((current === null) !== !listed) fail('publication_state_mismatch', 409);
    const status = current === null ? 'withdrawn' : digest(current) === previous.publicBodyDigest ? 'current' : 'edited';
    return { status, baseSha: snapshot.baseSha, entries: [], slug: checked.slug, url: checked.url, receipt: previous };
  }
  // This pilot creates a new article only. An existing ID requires an explicit
  // future update contract; a new version must not silently overwrite/recreate it.
  if (Object.values(receipts).some((r) => r.id === checked.id)) fail('published_id_exists', 409);
  if (takenSlugs(snapshot, manifest, receipts).has(checked.slug)) fail('slug_conflict', 409);
  const date = clock(now);
  const meta = initialMeta(checked, checked.slug, date);
  const html = L.renderArticle(meta, checked.body);
  const receipt = { id: checked.id, version: checked.version, fingerprint: checked.fingerprint,
    slug: checked.slug, url: checked.url, publicBodyDigest: digest(html), publishedAt: date.toISOString() };
  const entries = sharedEntries(snapshot, manifest, manifest.concat([meta]));
  entries.push({ path: articlePath(checked.slug), content: html });
  entries.push({ path: PATHS.receipts, content: receiptsJSON({ ...receipts, [key]: receipt }) });
  return { status: 'planned', baseSha: snapshot.baseSha, entries, slug: checked.slug, url: checked.url, receipt,
    message: `Publish ARIE Insights: ${checked.title} [${key}]` };
}

// Staff API keeps its existing authentication and checkbox gate. It shares the
// same renderer/rebuild logic; its updates and withdrawals leave receipts intact.
function planApiAction({ snapshot, action, input, now } = {}) {
  if (!object(input)) fail('bad_body');
  if (!['create', 'update', 'unpublish'].includes(action)) fail('unknown_action');
  const { manifest, receipts } = inspectSnapshot(snapshot);
  if (action === 'unpublish') {
    if (!slugOK(input.slug)) fail('bad_slug');
    const existing = manifest.find((a) => a.slug === input.slug);
    if (!existing) fail('not_found', 404);
    const entries = sharedEntries(snapshot, manifest, manifest.filter((a) => a.slug !== input.slug));
    entries.push({ path: articlePath(input.slug), delete: true });
    return { status: 'planned', baseSha: snapshot.baseSha, entries, slug: input.slug,
      message: `Unpublish ARIE Insights: ${existing.title}` };
  }
  const title = String(input.title || '').trim();
  const category = String(input.category || '').trim();
  const summary = String(input.summary || '').trim();
  validateTextFields({ title, category, summary });
  const imageProvided = own(input, 'image');
  const image = imageProvided && input.image ? String(input.image).trim() : '';
  const imageAlt = input.imageAlt ? String(input.imageAlt).trim() : '';
  if (imageProvided && !validImage(image)) fail('bad_image');
  if (imageProvided && image && !imageAlt) fail('image_alt_required');
  if (input.confirm !== true) fail('confirm_required');
  const body = L.sanitizeBody(input.body);
  if (!L.bodyHasContent(body)) fail('empty_body');
  const date = clock(now);
  let meta;
  if (action === 'create') {
    const slug = L.uniqueSlug(title, takenSlugs(snapshot, manifest, receipts));
    meta = initialMeta({ title, category, summary }, slug, date);
    meta.image = image || null;
    meta.imageAlt = image ? imageAlt : null;
  } else {
    if (!slugOK(input.slug)) fail('bad_slug');
    const existing = manifest.find((a) => a.slug === input.slug);
    if (!existing) fail('not_found', 404);
    let lastReviewed = existing.lastReviewed;
    if (category === 'Guides' && input.recordReview === true && L.todayISO(date) > existing.published) lastReviewed = L.todayISO(date);
    if (category !== 'Guides') lastReviewed = null;
    const finalImage = imageProvided ? image || null : existing.image;
    meta = { slug: existing.slug, title, category, summary, published: existing.published, lastReviewed,
      image: finalImage, imageAlt: imageProvided ? (image ? imageAlt : null) : existing.imageAlt };
  }
  const next = action === 'create' ? manifest.concat([meta]) : manifest.map((a) => a.slug === meta.slug ? meta : a);
  const entries = sharedEntries(snapshot, manifest, next);
  entries.push({ path: articlePath(meta.slug), content: L.renderArticle(meta, body) });
  return { status: 'planned', baseSha: snapshot.baseSha, entries, slug: meta.slug, url: articleUrl(meta.slug),
    message: `${action === 'create' ? 'Publish' : 'Update'} ARIE Insights: ${title}` };
}

module.exports = { PATHS, prepareDraft, fingerprint, validateDraft, planApprovedPublication, planApiAction,
  parseManifest, parseReceipts, readSnapshotManifest, receiptsJSON, validImage, digest };
