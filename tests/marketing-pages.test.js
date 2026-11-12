'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const pageApi = require('../api/marketing-page.js');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

function attrs(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) result[match[1]] = match[2] ?? '';
  return result;
}

function tags(source, tag) {
  return [...source.matchAll(new RegExp('<' + tag + '\\b[^>]*>', 'g'))].map(match => attrs(match[0]));
}

function meta(source, key) {
  return tags(source, 'meta').filter(tag => tag.name === key || tag.property === key).map(tag => tag.content);
}

function canonical(source) {
  return tags(source, 'link').filter(tag => tag.rel === 'canonical').map(tag => tag.href);
}

function visibleSections(source) {
  return tags(source, 'section').filter(tag => tag['data-page'] && !Object.hasOwn(tag, 'hidden'));
}

function call(query, url = '/api/marketing-page') {
  return new Promise((resolve, reject) => {
    const result = { code: 200, headers: {}, body: '' };
    const response = {
      setHeader(key, value) { result.headers[key.toLowerCase()] = value; },
      status(code) { result.code = code; return this; },
      send(body) { result.body = body; resolve(result); },
      end(body) { result.body = body || ''; resolve(result); },
      writeHead(code, headers) { result.code = code; Object.assign(result.headers, headers); return this; }
    };
    try { pageApi({ method: 'GET', query, url }, response); } catch (error) { reject(error); }
  });
}

for (const route of ['services', 'introducers']) {
  test('/' + route + ' has its own visible server-rendered content and consistent metadata', async () => {
    const response = await call({ route }, '/' + route + '?utm_source=partner');
    assert.equal(response.code, 200);
    assert.match(response.headers['content-type'], /text\/html/);
    const source = response.body;
    const url = 'https://www.ariefinance.com/' + route;
    assert.deepEqual(canonical(source), [url]);
    assert.deepEqual(meta(source, 'og:url'), [url]);
    const title = source.match(/<title>([^<]+)<\/title>/)[1];
    assert.ok(title.includes('ARIE Finance'));
    assert.notEqual(title, html.match(/<title>([^<]+)<\/title>/)[1]);
    assert.deepEqual(meta(source, 'og:title'), [title]);
    assert.deepEqual(meta(source, 'twitter:title'), [title]);
    assert.equal(meta(source, 'description').length, 1);
    assert.ok(meta(source, 'description')[0].length > 50);
    assert.deepEqual(meta(source, 'og:description'), meta(source, 'description'));
    assert.deepEqual(meta(source, 'twitter:description'), meta(source, 'description'));
    const visible = visibleSections(source);
    assert.equal(visible.length, 1, 'no homepage flash or multiple visible page sections');
    assert.equal(visible[0]['data-page'], route);
    assert.match(visible[0].class, /\bis-active\b/);
    assert.ok(!meta(source, 'robots').some(value => /noindex/.test(value)));
    assert.ok(!/noindex/.test(response.headers['x-robots-tag'] || ''));
    assert.match(source, /id="elig-root"/);
    assert.match(source, /data-form="contact"/);
    assert.equal(tags(source, 'section').filter(tag => tag['data-page']).length,
      tags(html, 'section').filter(tag => tag['data-page']).length, 'shared journeys remain available');
  });
}

test('marketing route allowlist rejects arbitrary or repeated query values', async () => {
  for (const route of [undefined, '', 'home', '../../internal/pricing', '<script>', ['services', 'introducers']]) {
    const response = await call({ route });
    assert.equal(response.code, 404);
    assert.match(response.headers['x-robots-tag'] || '', /noindex/);
    assert.ok(!response.body.includes('data-page="home"'));
  }
});

test('incomplete templates fail instead of publishing homepage content as a service page', () => {
  assert.throws(() => pageApi.__build(html.replace('id="arie-page-metadata"', 'id="missing-metadata"'), 'services'));
  assert.throws(() => pageApi.__build(html.replace('data-page="introducers" hidden=""', 'data-page="missing-introducers" hidden=""'), 'introducers'));
  assert.throws(() => pageApi.__build(html.replace(/<link rel="canonical"[^>]*>/, ''), 'services'));
});

test('searchable page links and sitemap point to real routes without redirecting them home', () => {
  for (const route of ['services', 'introducers']) {
    const links = tags(html, 'a').filter(tag => tag['data-route'] === route);
    assert.ok(links.length > 0);
    assert.ok(links.every(link => link.href === '/' + route));
    assert.ok(!config.redirects.some(redirect => redirect.source === '/' + route));
    assert.ok(config.rewrites.some(rewrite => rewrite.source === '/' + route && rewrite.destination.includes('/api/marketing-page')));
    assert.ok(config.redirects.some(redirect => redirect.source === '/' + route + '/' && redirect.destination === '/' + route));
  }
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  for (const route of ['services', 'introducers', 'eligibility']) assert.ok(sitemap.includes('<loc>https://www.ariefinance.com/' + route + '</loc>'));
  assert.match(sitemap, /ARIE_INSIGHTS_SITEMAP_START[\s\S]*ARIE_INSIGHTS_SITEMAP_END/);
  assert.match(fs.readFileSync(path.join(root, 'robots.txt'), 'utf8'), /Sitemap: https:\/\/www.ariefinance.com\/sitemap.xml/);
});

test('private tools and onboarding requirements retain their indexing restrictions', () => {
  for (const route of ['/salestracker', '/logout', '/managementreport', '/onboarding-requirements']) {
    const header = config.headers.find(item => item.source === route);
    assert.ok(header?.headers.some(item => item.key.toLowerCase() === 'x-robots-tag' && /noindex/.test(item.value)), route);
  }
});

test('homepage search identity includes Mauritius and factual organization structured data', () => {
  assert.match(html.match(/<title>([^<]+)<\/title>/)[1], /Mauritius/);
  const jsonld = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  const organizations = jsonld.flatMap(value => value['@graph'] || [value]).filter(value => value['@type'] === 'Organization');
  assert.equal(organizations.length, 1);
  assert.match(organizations[0].name, /ARIE Finance/);
  assert.equal(organizations[0].url, 'https://www.ariefinance.com/');
  assert.ok(!jsonld.some(value => JSON.stringify(value).includes('aggregateRating')));
});

// Exercise the actual router functions against a minimal browser history/DOM.
// Full visual and enquiry-journey checks also run in the deployment preview.
function routerAt(url) {
  const routeSource = html.split('/* ---------- public paths and legacy section router ---------- */')[1].split('  routeLinks.forEach(function(link){')[0];
  const metadata = html.match(/<script id="arie-page-metadata" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const pages = tags(html, 'section').filter(tag => tag['data-page']).map(tag => ({
    dataset: { page: tag['data-page'] }, hidden: true, classList: { toggle() {} }
  }));
  const validRoutes = Object.fromEntries(pages.map(page => [page.dataset.page, true]));
  const metaTags = new Map();
  const events = [];
  let location = new URL(url, 'https://www.ariefinance.com');
  const stack = [{ url: location.href, state: null }];
  let cursor = 0;
  const history = {
    state: null,
    replaceState(state, unused, next) { this.state = state; location.href = new URL(next, location).href; stack[cursor] = { state, url: location.href }; },
    pushState(state, unused, next) { this.state = state; location.href = new URL(next, location).href; stack.splice(++cursor); stack.push({ state, url: location.href }); }
  };
  const window = { pageYOffset: 0, scrollTo(value) { this.pageYOffset = value.top; }, dispatchEvent(event) { events.push(event); } };
  const targets = {
    'home-services': { route: 'home', top: 1400 },
    safeguarding: { route: 'compliance', top: 850 }
  };
  const doc = {
    title: '',
    getElementById(id) {
      if (id === 'arie-page-metadata') return { textContent: metadata };
      const target = targets[id];
      return target ? { closest: () => pages.find(page => page.dataset.page === target.route), getBoundingClientRect: () => ({ top: target.top - window.pageYOffset }) } : null;
    },
    querySelector(selector) { return { setAttribute(attribute, value) { metaTags.set(selector + ':' + attribute, value); } }; }
  };
  const context = { doc, document: doc, location, history, window, pages, validRoutes,
    routeLinks: [], header: null, menuToggle: null, boot() {}, requestAnimationFrame(callback) { callback(); },
    titles: { contact: 'Contact — ARIE Finance', compliance: 'Compliance & Legal Information — ARIE Finance' },
    CustomEvent: class { constructor(type, data) { this.type = type; this.detail = data.detail; } }
  };
  vm.createContext(context);
  vm.runInContext(routeSource, context);
  context.restoreLocation();
  return {
    context, location, history, pages, metaTags, events, window,
    active: () => pages.find(page => !page.hidden).dataset.page,
    move(delta) { cursor += delta; const entry = stack[cursor]; location.href = entry.url; history.state = entry.state; context.restoreLocation(); }
  };
}

test('public paths, enquiry navigation and Back/Forward keep URL, content and metadata aligned', () => {
  const h = routerAt('/services?utm_source=partner');
  assert.equal(h.active(), 'services');
  assert.equal(h.location.pathname, '/services');
  assert.equal(h.location.search, '?utm_source=partner');
  assert.equal(h.metaTags.get('link[rel="canonical"]:href'), 'https://www.ariefinance.com/services');
  h.context.setRoute('contact', true);
  assert.equal(h.active(), 'contact');
  assert.equal(h.location.pathname, '/');
  assert.equal(h.location.hash, '#contact');
  h.move(-1);
  assert.equal(h.active(), 'services');
  assert.equal(h.location.pathname, '/services');
  h.move(1);
  assert.equal(h.active(), 'contact');
  h.context.setRoute('eligibility', true);
  h.history.pushState({ route: 'eligibility', elig: 'form' }, '', h.location.href);
  h.context.restoreLocation();
  assert.equal(h.history.state.elig, 'form', 'questionnaire history is retained');
  assert.equal(h.active(), 'eligibility');
  assert.equal(h.metaTags.get('link[rel="canonical"]:href'), 'https://www.ariefinance.com/eligibility');
  assert.ok(h.events.some(event => event.type === 'arie:routechange' && event.detail.route === 'services'));
});

test('legacy page hashes normalize while in-page deep links preserve their fragment and position', () => {
  for (const route of ['services', 'introducers']) {
    const h = routerAt('/#' + route);
    assert.equal(h.active(), route);
    assert.equal(h.location.pathname, '/' + route);
    assert.equal(h.location.hash, '');
  }
  for (const [fragment, owner, top] of [['home-services', 'home', 1320], ['safeguarding', 'compliance', 770]]) {
    assert.ok(html.includes('id="' + fragment + '"'), 'real target exists');
    const h = routerAt('/#' + fragment);
    assert.equal(h.active(), owner);
    assert.equal(h.location.hash, '#' + fragment);
    assert.equal(h.window.pageYOffset, top);
    h.context.setRoute('services', true);
    h.move(-1);
    assert.equal(h.active(), owner);
    assert.equal(h.location.hash, '#' + fragment);
    assert.equal(h.window.pageYOffset, top);
  }
});
