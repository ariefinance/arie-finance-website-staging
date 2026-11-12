// Searchable entry points reuse the approved site template and navigation.
// The requested section is visible in the HTTP response, before JavaScript runs.
const fs = require('node:fs');
const path = require('node:path');

const ROUTES = new Set(['services', 'introducers']);
const ORIGIN = 'https://www.ariefinance.com';
const cache = new Map();

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function build(html, route) {
  if (!ROUTES.has(route)) throw new Error('Unsupported marketing route');
  const match = html.match(/<script id="arie-page-metadata" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Missing marketing page metadata');
  const page = JSON.parse(match[1])[route];
  if (!page || page.path !== '/' + route || !page.title || !page.description) {
    throw new Error('Invalid marketing page metadata');
  }
  const canonical = ORIGIN + page.path;
  const swaps = [
    [/<title>[^<]*<\/title>/, '<title>' + escapeHtml(page.title) + '</title>'],
    [/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + escapeHtml(page.description) + '">'],
    [/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + canonical + '">'],
    [/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + canonical + '">'],
    [/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + escapeHtml(page.title) + '">'],
    [/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + escapeHtml(page.description) + '">'],
    [/<meta name="twitter:title" content="[^"]*">/, '<meta name="twitter:title" content="' + escapeHtml(page.title) + '">'],
    [/<meta name="twitter:description" content="[^"]*">/, '<meta name="twitter:description" content="' + escapeHtml(page.description) + '">'],
  ];
  let out = html;
  for (const [pattern, value] of swaps) {
    if (!pattern.test(out)) throw new Error('Missing marketing metadata tag');
    out = out.replace(pattern, () => value);
  }
  let selected = 0;
  out = out.replace(/<section class="page(?: is-active)?" data-page="([^"]+)"(?: hidden="")?>/g,
    (tag, name) => {
      if (name === route) {
        selected++;
        return '<section class="page is-active" data-page="' + name + '">';
      }
      return '<section class="page" data-page="' + name + '" hidden="">';
    });
  if (selected !== 1) throw new Error('Missing or duplicate marketing section');
  return out;
}

module.exports = (req, res) => {
  const route = req.query && req.query.route;
  if (!ROUTES.has(route)) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    return res.status(404).send('Not found');
  }
  try {
    if (!cache.has(route)) {
      cache.set(route, build(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), route));
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400');
    return res.status(200).send(cache.get(route));
  } catch (error) {
    // A broken template must not silently serve the homepage under a new URL.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    return res.status(500).send('This page is temporarily unavailable. Please visit www.ariefinance.com.');
  }
};
module.exports.__build = build;
