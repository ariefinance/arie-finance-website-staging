// ============================================================================
//  ARIE Insights Publisher — shared server-side library
//  (Underscore-prefixed: Vercel does NOT expose this as an endpoint.)
//
//  Provides, for the /api/insights/* functions:
//    - stateless HMAC session auth (keyed by INSIGHTS_SESSION_SECRET)
//    - constant-time admin-password check (INSIGHTS_ADMIN_PASSWORD)
//    - GitHub Git-Data REST helpers (one atomic commit per publish)
//    - server-side HTML sanitisation of article bodies (sanitize-html)
//    - deterministic rendering of the article page, the /insights listing
//      region, the homepage Latest-3 region and the sitemap region
//
//  Secrets live ONLY in env and never reach the browser. GitHub is the single
//  source of truth; a committed insights/_articles.json manifest is the
//  ordered index used to rebuild the listing/home/sitemap in the same commit.
// ----------------------------------------------------------------------------
//  REQUIRED ENV (Vercel → Project → Settings → Environment Variables):
//    INSIGHTS_ADMIN_PASSWORD   one admin password (secret)
//    INSIGHTS_SESSION_SECRET   random 32+ byte secret for signing sessions
//    INSIGHTS_GITHUB_TOKEN     fine-grained PAT, repo Contents: Read+Write
//    INSIGHTS_GITHUB_BRANCH    target branch (preview: claude/fervent-allen-4oqir0; prod: main)
// ============================================================================

'use strict';
const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');

const OWNER = 'ariefinance';
const REPO = 'arie-finance-website-staging';
const SITE = 'https://www.ariefinance.com';
const COOKIE = 'arie_ins';
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;      // ~8 hours
const MAX_BODY_BYTES = 1 * 1024 * 1024;        // 1 MB article payload cap
const CATEGORIES = ['Guides', 'Updates', 'ARIE News'];

const MARK = {
  listStart: '<!-- ARIE_INSIGHTS_LIST_START -->',
  listEnd: '<!-- ARIE_INSIGHTS_LIST_END -->',
  homeStart: '<!-- ARIE_INSIGHTS_HOME_START -->',
  homeEnd: '<!-- ARIE_INSIGHTS_HOME_END -->',
  bodyStart: '<!-- ARIE_ARTICLE_BODY_START -->',
  bodyEnd: '<!-- ARIE_ARTICLE_BODY_END -->',
  siteStart: '<!-- ARIE_INSIGHTS_SITEMAP_START -->',
  siteEnd: '<!-- ARIE_INSIGHTS_SITEMAP_END -->',
};

// Entries under insights/ that are NOT articles.
const RESERVED = new Set([
  '_template', '_email-template.html', '_email-helper.html', 'admin', 'assets',
  'index.html', 'insights.css', 'PUBLISHING.md', 'ADMIN.md', '_articles.json',
]);

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------
function env() {
  return {
    password: process.env.INSIGHTS_ADMIN_PASSWORD || '',
    secret: process.env.INSIGHTS_SESSION_SECRET || '',
    token: process.env.INSIGHTS_GITHUB_TOKEN || '',
    branch: process.env.INSIGHTS_GITHUB_BRANCH || '',
  };
}
function configured() {
  const e = env();
  return !!(e.password && e.secret && e.token && e.branch);
}

// ---------------------------------------------------------------------------
// auth: constant-time compare + stateless HMAC session token
// ---------------------------------------------------------------------------
function constEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; }
  return crypto.timingSafeEqual(x, y);
}
function b64url(s) { return Buffer.from(s).toString('base64url'); }
function mintToken(secret) {
  const payload = b64url(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS }));
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function verifyToken(token, secret) {
  if (!secret || !token || typeof token !== 'string' || token.indexOf('.') < 0) return false;
  const [p, sig] = token.split('.');
  const expSig = crypto.createHmac('sha256', secret).update(p).digest('base64url');
  const a = Buffer.from(sig || ''), b = Buffer.from(expSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  let data; try { data = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return false; }
  return data && typeof data.exp === 'number' && Date.now() < data.exp;
}

// ---------------------------------------------------------------------------
// cookies / request helpers
// ---------------------------------------------------------------------------
function cookieSecure(req) {
  const p = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return p ? p === 'https' : true;
}
function setCookie(res, req, token, maxAgeS) {
  const parts = [COOKIE + '=' + token, 'Path=/', 'Max-Age=' + maxAgeS, 'HttpOnly', 'SameSite=Strict'];
  if (cookieSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function sessionToken(req) {
  const c = req.headers.cookie || '';
  const m = c.match(/(?:^|;\s*)arie_ins=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function isAuthed(req) { return verifyToken(sessionToken(req), env().secret); }

function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY_BYTES) return { tooLarge: true };
    return { body: req.body };
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) return { tooLarge: true };
    try { return { body: JSON.parse(req.body) }; } catch { return { body: null }; }
  }
  return { body: {} };
}
function clientIp(req) {
  const x = req.headers['x-forwarded-for'];
  if (x) return String(x).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
// Same-origin check for state-changing requests: the Origin host must match the
// host the request arrived on. Best-effort; skipped only when no Origin header.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser / same-origin fetches may omit it
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  const reqHost = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return !!reqHost && host === reqHost;
}
function sendSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

// ---------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }
// Safe to embed inside <script type="application/json|ld+json"> — prevents a
// "</script>" (or any tag) in the data from breaking out of the element.
function jsonForScript(obj) { return JSON.stringify(obj).replace(/</g, '\\u003c'); }
function slugify(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')  // strip accents (café -> cafe)
    .toLowerCase().trim()
    .replace(/['’‘"“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');  // avoid a trailing dash left by the slice
}
// A unique, valid slug derived from the title. Auto-suffixes (-2, -3, …) on
// collision and falls back to "article" when the title yields nothing usable.
// `taken` is a Set of slugs already in use (manifest slugs + reserved names).
function uniqueSlug(title, taken) {
  let base = slugify(title);
  if (!validSlug(base)) base = 'article';
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(base + '-' + n)) n++;
  return base + '-' + n;
}
function validSlug(s) { return typeof s === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 80; }
function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')); }
// Calendar date in Mauritius (UTC+4), as YYYY-MM-DD. ARIE operates in Mauritius,
// so publication/review dates use the local date, not the UTC date. `date` is
// injectable for tests; normal callers pass nothing.
function todayISO(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Indian/Mauritius', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function formatDate(iso) {
  if (!validDate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return d + ' ' + MONTHS[m - 1] + ' ' + y;
}

// ---------------------------------------------------------------------------
// sanitisation: allow ONLY the approved article elements
// ---------------------------------------------------------------------------
function sanitizeBody(html) {
  const clean = sanitizeHtml(String(html || ''), {
    allowedTags: ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'blockquote', 'br',
      'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    allowedAttributes: { a: ['href', 'title', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href'],
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (tagName, attribs) => ({
        tagName: 'a',
        attribs: Object.assign({}, attribs, { rel: 'noopener noreferrer' }),
      }),
      b: 'strong', i: 'em', // normalise legacy editor output
      div: 'p', // contenteditable sometimes emits <div> lines
    },
    // No class/style/id/event handlers survive (not in allowedAttributes).
  }).trim();
  // Wrap tables for mobile horizontal scroll, matching the article template.
  return clean.replace(/<table>/g, '<div class="ins-article__tablewrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
}
function bodyHasContent(cleanHtml) { return sanitizeHtml(cleanHtml, { allowedTags: [], allowedAttributes: {} }).trim().length > 0; }

// ---------------------------------------------------------------------------
// GitHub REST (Git Data API) — one atomic commit per operation
// ---------------------------------------------------------------------------
async function gh(path, opts) {
  const e = env();
  const r = await fetch('https://api.github.com' + path, {
    method: (opts && opts.method) || 'GET',
    headers: {
      Authorization: 'Bearer ' + e.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'arie-insights-publisher',
      'Content-Type': 'application/json',
    },
    body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { ok: r.ok, status: r.status, json };
}
async function getHead(branch) {
  const ref = await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (!ref.ok || !ref.json || !ref.json.object) throw new Error('head_ref');
  const commitSha = ref.json.object.sha;
  const commit = await gh(`/repos/${OWNER}/${REPO}/git/commits/${commitSha}`);
  if (!commit.ok || !commit.json) throw new Error('head_commit');
  return { commitSha, treeSha: commit.json.tree.sha };
}
// Read a file's current text at a ref (returns null if missing).
async function getFile(path, ref) {
  const r = await gh(`/repos/${OWNER}/${REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
  if (r.status === 404) return null;
  if (!r.ok || !r.json || typeof r.json.content !== 'string') throw new Error('get_file:' + path);
  return Buffer.from(r.json.content, 'base64').toString('utf8');
}
async function makeBlob(contentUtf8) {
  const r = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, { method: 'POST', body: { content: contentUtf8, encoding: 'utf-8' } });
  if (!r.ok || !r.json || !r.json.sha) throw new Error('blob');
  return r.json.sha;
}
// entries: [{path, content}] to add/replace; [{path, delete:true}] to remove.
async function commitAll(branch, head, message, entries) {
  const tree = [];
  for (const e of entries) {
    if (e.delete) { tree.push({ path: e.path, mode: '100644', type: 'blob', sha: null }); }
    else { tree.push({ path: e.path, mode: '100644', type: 'blob', sha: await makeBlob(e.content) }); }
  }
  const t = await gh(`/repos/${OWNER}/${REPO}/git/trees`, { method: 'POST', body: { base_tree: head.treeSha, tree } });
  if (!t.ok || !t.json || !t.json.sha) throw new Error('tree');
  const c = await gh(`/repos/${OWNER}/${REPO}/git/commits`, { method: 'POST', body: { message, tree: t.json.sha, parents: [head.commitSha] } });
  if (!c.ok || !c.json || !c.json.sha) throw new Error('commit');
  // Non-force update: fails (422) if the branch advanced since we read head → conflict.
  const u = await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: c.json.sha, force: false } });
  if (u.status === 422) return { conflict: true };
  if (!u.ok) throw new Error('update_ref:' + u.status);
  return { commit: c.json.sha };
}

// ---------------------------------------------------------------------------
// manifest (insights/_articles.json) — ordered index, source-of-truth in git
// ---------------------------------------------------------------------------
async function readManifest(branch) {
  const txt = await getFile('insights/_articles.json', branch);
  if (!txt) return [];
  try { const j = JSON.parse(txt); return Array.isArray(j.articles) ? j.articles : (Array.isArray(j) ? j : []); }
  catch { return []; }
}
function sortArticles(list) {
  return list.slice().sort((a, b) => {
    if (a.published !== b.published) return a.published < b.published ? 1 : -1; // newest first
    return (a.title || '').localeCompare(b.title || '');
  });
}
function manifestJSON(list) { return JSON.stringify({ articles: sortArticles(list) }, null, 2) + '\n'; }

// ---------------------------------------------------------------------------
// rendering: article page
// ---------------------------------------------------------------------------
function renderArticle(meta, bodyHtml) {
  const title = escapeHtml(meta.title);
  const summary = escapeHtml(meta.summary);
  const cat = escapeHtml(meta.category);
  const slug = meta.slug;
  const pubHuman = formatDate(meta.published);
  const showReviewed = meta.category === 'Guides' && meta.lastReviewed && meta.lastReviewed > meta.published;
  const reviewedHuman = showReviewed ? formatDate(meta.lastReviewed) : '';
  const dateModified = showReviewed ? meta.lastReviewed : meta.published;
  const ogImage = meta.image ? escapeAttr(meta.image) : (SITE + '/og-image.png');
  const figure = meta.image
    ? `\n    <figure class="ins-article__figure">\n      <img src="${escapeAttr(meta.image)}" alt="${escapeAttr(meta.imageAlt || meta.title)}" width="1200" height="630">\n    </figure>`
    : '';
  const reviewedLine = showReviewed
    ? `\n    <div class="ins-article__reviewed">Last reviewed ${reviewedHuman}</div>`
    : '';
  const metaClass = showReviewed ? 'ins-article__meta ins-article__meta--tight' : 'ins-article__meta';
  const publicMeta = {
    slug, title: meta.title, category: meta.category, summary: meta.summary,
    published: meta.published, lastReviewed: showReviewed ? meta.lastReviewed : null,
    image: meta.image || null, imageAlt: meta.image ? (meta.imageAlt || '') : null,
  };
  const ld = {
    '@context': 'https://schema.org', '@type': 'BlogPosting',
    headline: meta.title, description: meta.summary,
    datePublished: meta.published, dateModified,
    articleSection: meta.category,
    mainEntityOfPage: `${SITE}/insights/${slug}/`, url: `${SITE}/insights/${slug}/`,
    publisher: { '@type': 'Organization', name: 'ARIE Finance Ltd', url: SITE + '/', logo: SITE + '/favicon.png' },
    author: { '@type': 'Organization', name: 'ARIE Finance Ltd' },
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="index, follow, max-image-preview:large">
<title>${title} | ARIE Insights</title>
<meta name="description" content="${summary}">
<link rel="canonical" href="${SITE}/insights/${slug}/">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/favicon.png">
<meta property="og:type" content="article">
<meta property="og:site_name" content="ARIE Finance">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${summary}">
<meta property="og:url" content="${SITE}/insights/${slug}/">
<meta property="og:image" content="${ogImage}">
<meta property="article:published_time" content="${meta.published}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${summary}">
<meta name="twitter:image" content="${ogImage}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/insights/insights.css">
</head>
<body>
<div class="page">

  <header class="ins-header">
    <div class="ins-header__inner">
      <a class="ins-header__logo" href="https://www.ariefinance.com/" aria-label="ARIE Finance home">
        <img src="/insights/assets/arie-logo.svg" alt="ARIE Finance" width="118" height="28">
      </a>
      <a class="ins-header__contact" href="https://www.ariefinance.com/#contact">Contact</a>
    </div>
  </header>

  <article class="ins-article">
    <span class="ins-cat ins-article__cat">${cat}</span>
    <h1>${title}</h1>
    <p class="ins-article__summary">${summary}</p>
    <div class="${metaClass}">Published ${pubHuman}</div>${reviewedLine}${figure}
    <div class="article-body">
      ${MARK.bodyStart}
${bodyHtml}
      ${MARK.bodyEnd}
    </div>

    <div class="ins-disclaimer">
      <p class="ins-disclaimer__label">Information Disclaimer</p>
      <p class="ins-disclaimer__text">This material is provided for general information only and does not constitute financial, investment, legal or tax advice. ARIE Finance Ltd does not provide foreign exchange brokerage services. Readers should seek appropriate professional advice before taking any action based on information contained in these articles.</p>
    </div>

    <div class="ins-cta">
      <p>Discuss your international payment requirements</p>
      <a href="https://www.ariefinance.com/#contact">Speak to ARIE Finance</a>
    </div>

    <div class="ins-back">
      <a href="/insights/">&larr; Back to Insights</a>
    </div>
  </article>

  <footer class="ins-footer">
    <div class="ins-footer__inner">
      <div class="ins-footer__logo">
        <img src="/insights/assets/arie-logo-white.svg" alt="ARIE Finance" width="110" height="26">
      </div>
      <p class="ins-footer__reg">ARIE Finance Ltd is a licensed Payment Intermediary Services company regulated by the Financial Services Commission of Mauritius. Licence No. GB25205028. ARIE Finance Ltd is not a bank. Client funds are held in safeguarded accounts and are not covered by any deposit guarantee scheme.</p>
      <div class="ins-footer__links">
        <a href="https://www.ariefinance.com/#compliance">Compliance &amp; Legal</a>
        <a href="https://www.ariefinance.com/#contact">Contact</a>
      </div>
      <div class="ins-footer__base">
        <p>&copy; 2026 ARIE Finance Ltd. All rights reserved.</p>
      </div>
    </div>
  </footer>

</div>
<script type="application/json" id="arie-insights-meta">
${jsonForScript(publicMeta)}
</script>
<script type="application/ld+json">
${jsonForScript(ld)}
</script>
</body>
</html>
`;
}

// Parse the embedded public meta + body out of a generated article page.
function parseArticle(html) {
  const meta = extractMeta(html);
  let body = '';
  const s = html.indexOf(MARK.bodyStart), e = html.indexOf(MARK.bodyEnd);
  if (s >= 0 && e > s) body = html.slice(s + MARK.bodyStart.length, e).trim();
  return { meta, body };
}
function extractMeta(html) {
  const m = html.match(/<script type="application\/json" id="arie-insights-meta">\s*([\s\S]*?)\s*<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// ---------------------------------------------------------------------------
// rendering: /insights listing region (between LIST markers)
// ---------------------------------------------------------------------------
function cardLatest(a) {
  return `<section class="ins-latest">
    <div class="ins-latest__inner">
      <span class="ins-eyebrow">Latest Insight</span>
      <a class="ins-latest__card" href="/insights/${a.slug}/">
        <span class="ins-cat">${escapeHtml(a.category)}</span>
        <h2>${escapeHtml(a.title)}</h2>
        <p>${escapeHtml(a.summary)}</p>
        <span class="ins-date">${formatDate(a.published)}</span>
      </a>
    </div>
  </section>`;
}
function cardItem(a) {
  return `<a class="ins-item" href="/insights/${a.slug}/">
      <span class="ins-cat">${escapeHtml(a.category)}</span>
      <h2>${escapeHtml(a.title)}</h2>
      <p>${escapeHtml(a.summary)}</p>
      <span class="ins-date">${formatDate(a.published)}</span>
    </a>`;
}
function renderListingRegion(articles) {
  const list = sortArticles(articles);
  if (list.length === 0) {
    return `
  <section class="ins-empty">
    <div class="ins-empty__inner">
      <h2>Our first insights are on the way</h2>
      <p>ARIE Insights will publish practical guidance on international payments, financial developments and global business. Please check back soon.</p>
    </div>
  </section>
`;
  }
  const latest = list[0];
  const rest = list.slice(1);
  const restHtml = rest.length
    ? `
  <section class="ins-list">
    <div class="ins-list__inner">
    ${rest.map(cardItem).join('\n    ')}
    </div>
  </section>`
    : '';
  return `
  ${cardLatest(latest)}${restHtml}
`;
}

// ---------------------------------------------------------------------------
// rendering: homepage Latest-3 region (between HOME markers)
// ---------------------------------------------------------------------------
function renderHomeRegion(articles) {
  const list = sortArticles(articles).slice(0, 3);
  if (list.length === 0) return '';
  const cards = list.map((a) => `      <a href="/insights/${a.slug}/" style="display:block;text-decoration:none;background:#fff;border:1px solid #E8E4DA;border-radius:6px;padding:22px;">
        <span style="font-family:'Hanken Grotesk',sans-serif;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#6B5D30;display:block;margin-bottom:8px;">${escapeHtml(a.category)}</span>
        <span style="font-family:'Newsreader',Georgia,serif;font-size:19px;font-weight:500;color:#06113A;line-height:1.3;display:block;margin-bottom:8px;">${escapeHtml(a.title)}</span>
        <span style="font-size:13px;color:#6B6456;">${formatDate(a.published)}</span>
      </a>`).join('\n');
  return `
<section style="background:#F9F6EF;padding:56px 24px;">
  <div style="max-width:1080px;margin:0 auto;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px;">
      <h2 style="font-family:'Newsreader',Georgia,serif;font-size:28px;font-weight:400;color:#06113A;margin:0;">Latest Insights</h2>
      <a href="/insights/" style="font-size:14px;font-weight:600;color:#06113A;text-decoration:none;">View all insights &rarr;</a>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;">
${cards}
    </div>
  </div>
</section>
`;
}

// ---------------------------------------------------------------------------
// rendering: sitemap region (between SITEMAP markers)
// ---------------------------------------------------------------------------
function renderSitemapRegion(articles) {
  const list = sortArticles(articles);
  if (list.length === 0) return '\n';
  return '\n' + list.map((a) =>
    `  <url>\n    <loc>${SITE}/insights/${a.slug}/</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`
  ).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// marker replacement — fail safe if markers are missing
// ---------------------------------------------------------------------------
function replaceRegion(content, startMark, endMark, inner) {
  const s = content.indexOf(startMark), e = content.indexOf(endMark);
  if (s < 0 || e < 0 || e < s) throw new Error('markers_missing');
  return content.slice(0, s + startMark.length) + inner + content.slice(e);
}

module.exports = {
  OWNER, REPO, SITE, CATEGORIES, MARK, RESERVED,
  env, configured,
  constEq, mintToken, verifyToken, setCookie, sessionToken, isAuthed,
  cookieSecure, readBody, clientIp, sameOrigin, sendSecurityHeaders,
  escapeHtml, slugify, uniqueSlug, validSlug, validDate, todayISO, formatDate,
  sanitizeBody, bodyHasContent,
  gh, getHead, getFile, commitAll,
  readManifest, sortArticles, manifestJSON,
  renderArticle, parseArticle, extractMeta,
  renderListingRegion, renderHomeRegion, renderSitemapRegion, replaceRegion,
};
