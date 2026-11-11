'use strict';

// Local synthetic tests only: no live publishing, credentials or client data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const L = require('../api/insights/_lib');
const P = require('../api/insights/_publisher');

const ROOT = path.join(__dirname, '..');
const NOW = new Date('2026-11-13T06:00:00Z');
const HEAD = 'a'.repeat(40);
const NEXT_HEAD = 'b'.repeat(40);
const THIRD_HEAD = 'c'.repeat(40);
const MANIFEST = 'insights/_articles.json';
const RECEIPTS = 'insights/_publication-receipts.json';
const SHARED = ['insights/index.html', 'index.html', 'sitemap.xml'];
const SOURCE = Object.fromEntries(SHARED.map(p => [p, fs.readFileSync(path.join(ROOT, p), 'utf8')]));

function article(overrides = {}) {
  return {
    id: 'SYNTHETIC-ONLY-001', version: 'v1',
    title: 'Synthetic test payment checklist', category: 'Guides',
    summary: 'Synthetic copy used only to verify the publication workflow.',
    body: '<h2>Example checklist</h2><p>Fictional example for automated tests only.</p><p><a href="https://example.test/source">Synthetic source</a></p>',
    ...overrides,
  };
}

function draft(overrides = {}) { return P.prepareDraft(article(overrides), { now: NOW }); }
function approval(d) { return `Approve ${d.id}/${d.version} for publication`; }
function snapshot(overrides = {}) {
  return {
    baseSha: HEAD,
    baseTreeSha: 'd'.repeat(40),
    files: { ...SOURCE, [MANIFEST]: null, [RECEIPTS]: null },
    articlePaths: [],
    ...overrides,
  };
}
function plan(s, d, approvalText = approval(d)) {
  return P.planApprovedPublication({ snapshot: s, draft: d, approval: approvalText, now: NOW });
}
function fileFrom(p, name) {
  const entry = p.entries.find(e => e.path === name);
  assert.ok(entry, `Expected generated file ${name}`);
  assert.equal(typeof entry.content, 'string');
  return entry.content;
}
function applyPlan(s, p, sha = NEXT_HEAD) {
  const files = { ...s.files };
  const articlePaths = new Set(s.articlePaths);
  for (const entry of p.entries) {
    files[entry.path] = entry.delete ? null : entry.content;
    if (/^insights\/[a-z0-9]+(?:-[a-z0-9]+)*\/index\.html$/.test(entry.path)) {
      if (entry.delete) articlePaths.delete(entry.path);
      else articlePaths.add(entry.path);
    }
  }
  return { ...s, baseSha: sha, files, articlePaths: [...articlePaths] };
}
function expectCode(fn, code) {
  assert.throws(fn, e => e && e.code === code, `Expected ${code}`);
}
function region(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end);
  assert.ok(a >= 0 && b > a, 'Expected an intact publisher marker region');
  return text.slice(a + start.length, b);
}

test('the review draft is sanitized before approval and matches the published article body', () => {
  const d = draft({ body: '<h2 onclick="bad()">Synthetic heading</h2><p>Fictional example.</p><script>bad()</script><p><a href="javascript:bad()" onclick="bad()">Unsafe link</a></p>' });
  assert.doesNotMatch(d.body, /<script|onclick|javascript:/i);
  assert.match(d.body, /Fictional example/);
  assert.match(d.fingerprint, /^sha256:[a-f0-9]{64}$/);
  const p = plan(snapshot(), d);
  const published = L.parseArticle(fileFrom(p, `insights/${d.slug}/index.html`));
  assert.equal(published.body, d.body);
  assert.equal(published.meta.title, d.title);
  assert.equal(published.meta.summary, d.summary);
});

test('a table stays byte-identical through sanitizing, review validation and publication', () => {
  const raw = '<h2>Synthetic table</h2><table class="untrusted" onclick="bad()"><thead><tr><th>Example</th><th>Value</th></tr></thead><tbody><tr><td style="color:red">Fictional</td><td>Only</td></tr></tbody></table>';
  const cleaned = L.sanitizeBody(raw);
  assert.equal(L.sanitizeBody(cleaned), cleaned);
  assert.doesNotMatch(cleaned, /untrusted|onclick|style=/);
  assert.equal((cleaned.match(/class="ins-article__tablewrap"/g) || []).length, 1);
  const d = draft({ body: raw });
  assert.doesNotThrow(() => P.validateDraft(d));
  const p = plan(snapshot(), d);
  assert.equal(L.parseArticle(fileFrom(p, `insights/${d.slug}/index.html`)).body, d.body);
  assert.equal(d.body, cleaned);
});

test('no publication plan is created without approval for this exact article and version', () => {
  const d = draft();
  const s = snapshot();
  const untouched = structuredClone(s);
  for (const value of [undefined, null, '', 'Approved', `Approve ${d.id}/v2 for publication`, 'Approve DIFFERENT-ID/v1 for publication']) {
    expectCode(() => P.planApprovedPublication({ snapshot: s, draft: d, approval: value, now: NOW }), 'approval_required');
  }
  assert.deepEqual(s, untouched);
});

test('changing reviewed public copy or its fingerprint invalidates approval', () => {
  const d = draft();
  const changes = [
    { title: 'A different synthetic title' },
    { summary: 'Different synthetic summary.' },
    { category: 'Updates' },
    { body: d.body + '<p>New unapproved public sentence.</p>' },
    { fingerprint: '0'.repeat(64) },
  ];
  for (const change of changes) {
    expectCode(() => plan(snapshot(), { ...d, ...change }, approval(d)), 'fingerprint_mismatch');
  }
});

test('review preparation rejects unsupported fields and invalid article content', () => {
  for (const input of [
    { title: 'x'.repeat(161) },
    { category: 'Unsupported category' },
    { summary: 'x'.repeat(401) },
    { body: '<script>Nothing public remains</script>' },
    { id: '../unsafe' },
    { version: 'not-a-version' },
  ]) {
    assert.throws(() => draft(input));
  }
});

test('first publication generates one coherent article, listing, homepage, sitemap, manifest and receipt', () => {
  const d = draft();
  const p = plan(snapshot(), d);
  assert.equal(p.status, 'planned');
  assert.equal(p.baseSha, HEAD);
  assert.deepEqual(p.entries.map(e => e.path).sort(), [...SHARED, MANIFEST, RECEIPTS, `insights/${d.slug}/index.html`].sort());
  assert.equal(new Set(p.entries.map(e => e.path)).size, p.entries.length);

  const listing = fileFrom(p, 'insights/index.html');
  const home = fileFrom(p, 'index.html');
  const sitemap = fileFrom(p, 'sitemap.xml');
  const href = `/insights/${d.slug}/`;
  assert.ok(region(listing, L.MARK.listStart, L.MARK.listEnd).includes(href));
  assert.doesNotMatch(region(listing, L.MARK.listStart, L.MARK.listEnd), /Our first insights are on the way/);
  assert.ok(region(home, L.MARK.homeStart, L.MARK.homeEnd).includes(href));
  assert.ok(region(sitemap, L.MARK.siteStart, L.MARK.siteEnd).includes(d.url));
  const header = home.match(/<header\b[\s\S]*?<\/header>/i);
  const footer = home.match(/<footer\b[\s\S]*?<\/footer>/i);
  assert.ok(header && footer);
  assert.equal((header[0].match(/href="\/insights\/"/g) || []).length, 1);
  assert.equal((footer[0].match(/href="\/insights\/"/g) || []).length, 1);

  const manifest = JSON.parse(fileFrom(p, MANIFEST));
  assert.equal(manifest.articles.length, 1);
  assert.equal(manifest.articles[0].slug, d.slug);
  const receipts = JSON.parse(fileFrom(p, RECEIPTS));
  assert.equal(receipts.schemaVersion, 1);
  assert.equal(receipts.receipts[`${d.id}/${d.version}`].fingerprint, d.fingerprint);
  assert.equal(receipts.receipts[`${d.id}/${d.version}`].url, d.url);
});

test('a second distinct article preserves the first article and does not duplicate restored navigation', () => {
  const s = snapshot();
  const first = draft();
  const published = applyPlan(s, plan(s, first));
  const second = draft({ id: 'SYNTHETIC-ONLY-002', title: 'Second synthetic test guide' });
  const p = plan(published, second);
  assert.equal(JSON.parse(fileFrom(p, MANIFEST)).articles.length, 2);
  assert.ok(fileFrom(p, 'insights/index.html').includes(first.url.replace(L.SITE, '')));
  const home = fileFrom(p, 'index.html');
  assert.equal((home.match(/<header\b[\s\S]*?<\/header>/i)[0].match(/href="\/insights\/"/g) || []).length, 1);
  assert.equal((home.match(/<footer\b[\s\S]*?<\/footer>/i)[0].match(/href="\/insights\/"/g) || []).length, 1);
});

test('retrying after a lost publication response returns the existing URL without new files or another slug', () => {
  const s = snapshot();
  const d = draft();
  const firstPlan = plan(s, d);
  const remoteAfterLostResponse = applyPlan(s, firstPlan);
  const retry = plan(remoteAfterLostResponse, JSON.parse(JSON.stringify(d)));
  assert.equal(retry.status, 'current');
  assert.deepEqual(retry.entries, []);
  assert.equal(retry.url, firstPlan.url);
  assert.equal(retry.slug, firstPlan.slug);
  assert.equal(remoteAfterLostResponse.articlePaths.length, 1);
});

test('old approval never overwrites an article subsequently changed in the browser publisher', () => {
  const s = snapshot();
  const d = draft();
  const published = applyPlan(s, plan(s, d));
  const browserEdit = P.planApiAction({
    snapshot: published, action: 'update', now: NOW,
    input: { ...article(), slug: d.slug, title: 'Edited synthetic article', body: '<p>Fictional later browser edit.</p>', confirm: true },
  });
  const edited = applyPlan(published, browserEdit, THIRD_HEAD);
  const retry = plan(edited, d);
  assert.equal(retry.status, 'edited');
  assert.deepEqual(retry.entries, []);
  assert.equal(edited.files[RECEIPTS], published.files[RECEIPTS]);
  assert.match(edited.files[`insights/${d.slug}/index.html`], /Fictional later browser edit/);
});

test('old approval never resurrects an article subsequently unpublished in the browser publisher', () => {
  const s = snapshot();
  const d = draft();
  const published = applyPlan(s, plan(s, d));
  const withdrawal = P.planApiAction({ snapshot: published, action: 'unpublish', input: { slug: d.slug }, now: NOW });
  const withdrawn = applyPlan(published, withdrawal, THIRD_HEAD);
  const retry = plan(withdrawn, d);
  assert.equal(retry.status, 'withdrawn');
  assert.deepEqual(retry.entries, []);
  assert.equal(withdrawn.files[RECEIPTS], published.files[RECEIPTS]);
  assert.equal(withdrawn.files[`insights/${d.slug}/index.html`], null);
});

test('the create-only pilot refuses a new version of an already published article ID', () => {
  const s = snapshot();
  const first = draft();
  const published = applyPlan(s, plan(s, first));
  const replacement = draft({ version: 'v2', title: 'Revised synthetic test guide' });
  expectCode(() => plan(published, replacement), 'published_id_exists');
});

test('damaged or wrongly shaped manifests cannot be treated as an empty article collection', () => {
  const d = draft();
  for (const text of ['{broken', JSON.stringify({ articles: 'not-an-array' }), JSON.stringify({ articles: [{}] }), JSON.stringify({ unexpected: [] })]) {
    const s = snapshot();
    s.files[MANIFEST] = text;
    assert.throws(() => plan(s, d));
  }
});

test('duplicate manifest entries and inconsistent receipt IDs are rejected', () => {
  const s = snapshot();
  const first = draft();
  const published = applyPlan(s, plan(s, first));
  const next = draft({ id: 'SYNTHETIC-ONLY-002', title: 'Second synthetic test guide' });

  const duplicateManifest = structuredClone(published);
  const meta = JSON.parse(duplicateManifest.files[MANIFEST]).articles[0];
  duplicateManifest.files[MANIFEST] = JSON.stringify({ articles: [meta, { ...meta, title: 'A duplicated slug' }] });
  assert.throws(() => plan(duplicateManifest, next));

  const inconsistentReceipts = structuredClone(published);
  const saved = JSON.parse(inconsistentReceipts.files[RECEIPTS]);
  saved.receipts['OTHER-ID/v1'] = { ...saved.receipts[`${first.id}/${first.version}`] };
  inconsistentReceipts.files[RECEIPTS] = JSON.stringify(saved);
  assert.throws(() => plan(inconsistentReceipts, next));
});

test('missing manifests cannot hide existing article files or populated shared regions', () => {
  const d = draft();
  const orphan = snapshot();
  orphan.articlePaths = ['insights/orphan-synthetic-article/index.html'];
  orphan.files[orphan.articlePaths[0]] = '<p>Synthetic orphan only.</p>';
  assert.throws(() => plan(orphan, d));

  const s = snapshot();
  const published = applyPlan(s, plan(s, d));
  const concealed = { ...published, articlePaths: [], files: { ...published.files, [MANIFEST]: null, [RECEIPTS]: null } };
  assert.throws(() => plan(concealed, draft({ id: 'SYNTHETIC-ONLY-002', title: 'Another synthetic guide' })));
});

test('a stale head is rejected and replanning preserves another article and unrelated homepage edits', () => {
  const { assertCurrentHead } = require('../scripts/insights-pilot');
  const s = snapshot();
  const pending = draft();
  const stale = plan(s, pending);
  const concurrent = draft({ id: 'SYNTHETIC-ONLY-OTHER', title: 'Concurrent synthetic guide' });
  const updated = applyPlan(s, plan(s, concurrent));
  updated.files['index.html'] = updated.files['index.html'].replace('</head>', '<!-- unrelated concurrent homepage edit -->\n</head>');

  expectCode(() => assertCurrentHead(stale, updated.baseSha), 'stale_head');
  const rebuilt = plan(updated, pending);
  assert.doesNotThrow(() => assertCurrentHead(rebuilt, updated.baseSha));
  assert.equal(rebuilt.baseSha, NEXT_HEAD);
  assert.match(fileFrom(rebuilt, 'index.html'), /unrelated concurrent homepage edit/);
  assert.deepEqual(new Set(JSON.parse(fileFrom(rebuilt, MANIFEST)).articles.map(a => a.slug)), new Set([pending.slug, concurrent.slug]));
});

test('the connector plan permits only the complete atomic publication at the intended repository and branch', () => {
  const { connectorTree, makePlan } = require('../scripts/insights-pilot');
  const d = draft();
  const p = makePlan(snapshot(), d, approval(d));
  const tree = connectorTree(p, HEAD, d);
  assert.equal(tree.base_tree_sha, p.baseTreeSha);
  assert.equal(tree.tree_elements.length, 6);
  assert.deepEqual(new Set(tree.tree_elements.map(e => e.path)), new Set(p.entries.map(e => e.path)));
  expectCode(() => connectorTree(p, NEXT_HEAD, d), 'stale_head');
  for (const change of [{ branch: 'other-branch' }, { repository: 'other/repository' }, { force: true }]) {
    expectCode(() => connectorTree({ ...p, ...change }, HEAD, d), 'wrong_target');
  }
  expectCode(() => connectorTree({ ...p, entries: p.entries.slice(1) }, HEAD, d), 'incomplete_publication');
  const unexpected = structuredClone(p);
  unexpected.entries[0].path = 'api/unrelated.js';
  expectCode(() => connectorTree(unexpected, HEAD, d), 'unexpected_write');
});

test('the final connector boundary rejects a missing review packet or article text altered after planning', () => {
  const { connectorTree, makePlan } = require('../scripts/insights-pilot');
  const d = draft();
  const p = makePlan(snapshot(), d, approval(d));
  expectCode(() => connectorTree(p, HEAD), 'invalid_draft');
  const altered = structuredClone(p);
  const articleEntry = altered.entries.find(e => e.path === `insights/${d.slug}/index.html`);
  articleEntry.content = articleEntry.content.replace('Fictional example for automated tests only.', 'Unapproved synthetic replacement text.');
  expectCode(() => connectorTree(altered, HEAD, d), 'plan_content_mismatch');
  const wrongPacket = draft({ id: 'SYNTHETIC-OTHER-APPROVAL', title: 'Different synthetic approved article' });
  expectCode(() => connectorTree(p, HEAD, wrongPacket), 'plan_draft_mismatch');
});

// These are clearly synthetic observations for unit tests, not evidence of an
// actual deployment. Production verification must collect real connector/HTTP
// results, as documented in scripts/insights-pilot.js.
function syntheticEvidence() {
  const d = draft();
  const p = plan(snapshot(), d);
  const evidence = {
    publicationCommit: NEXT_HEAD,
    deployment: {
      projectId: 'prj_ZjDhXKZlnSNYX6180uEgkhnbHvz4',
      repository: 'ariefinance/arie-finance-website-staging',
      branch: 'main', target: 'production', state: 'READY',
      gitSha: NEXT_HEAD, aliases: ['www.ariefinance.com'],
    },
    receipt: JSON.parse(fileFrom(p, RECEIPTS)).receipts[`${d.id}/${d.version}`],
    pages: {
      article: { url: d.url, status: 200, headers: {}, body: fileFrom(p, `insights/${d.slug}/index.html`) },
      listing: { url: L.SITE + '/insights/', status: 200, body: fileFrom(p, 'insights/index.html') },
      home: { url: L.SITE + '/', status: 200, body: fileFrom(p, 'index.html') },
      sitemap: { url: L.SITE + '/sitemap.xml', status: 200, body: fileFrom(p, 'sitemap.xml') },
    },
  };
  return { d, evidence };
}

test('verification accepts matching production deployment, approved content and discoverability evidence', () => {
  const { verifyPublication } = require('../scripts/insights-pilot');
  const { d, evidence } = syntheticEvidence();
  const result = verifyPublication(d, evidence);
  assert.equal(result.ok, true, result.errors.join(', '));
  assert.equal(result.status, 'verified');
  assert.equal(result.url, d.url);
  assert.deepEqual(result.errors, []);
});

test('READY is insufficient when the deployment belongs to another commit or lacks the production alias', () => {
  const { verifyPublication } = require('../scripts/insights-pilot');
  const { d, evidence } = syntheticEvidence();
  const wrongCommit = structuredClone(evidence);
  wrongCommit.deployment.gitSha = THIRD_HEAD;
  const commitResult = verifyPublication(d, wrongCommit);
  assert.equal(commitResult.ok, false);
  assert.ok(commitResult.errors.includes('publication_commit_not_in_production'));

  const wrongAlias = structuredClone(evidence);
  wrongAlias.deployment.aliases = ['synthetic-preview.example.test'];
  const aliasResult = verifyPublication(d, wrongAlias);
  assert.equal(aliasResult.ok, false);
  assert.ok(aliasResult.errors.includes('production_alias_not_confirmed'));

  const wrongProject = structuredClone(evidence);
  wrongProject.deployment.projectId = 'prj_synthetic_other_project';
  assert.ok(verifyPublication(d, wrongProject).errors.includes('wrong_deployment_target'));
});

test('a newer production commit requires matching ancestry evidence and unchanged approved public content', () => {
  const { verifyPublication } = require('../scripts/insights-pilot');
  const { d, evidence } = syntheticEvidence();
  evidence.deployment.gitSha = THIRD_HEAD;
  assert.equal(verifyPublication(d, evidence).ok, false);
  evidence.ancestry = { base: NEXT_HEAD, head: THIRD_HEAD, status: 'ahead' };
  const descended = verifyPublication(d, evidence);
  assert.equal(descended.ok, true, descended.errors.join(', '));
  evidence.ancestry.base = HEAD;
  assert.equal(verifyPublication(d, evidence).ok, false);
  evidence.ancestry = { base: NEXT_HEAD, head: THIRD_HEAD, status: 'diverged' };
  assert.equal(verifyPublication(d, evidence).ok, false);
});

test('pending or failed deployments are reported truthfully and never verified', () => {
  const { verifyPublication } = require('../scripts/insights-pilot');
  const { d, evidence } = syntheticEvidence();
  for (const state of ['QUEUED', 'BUILDING', 'INITIALIZING']) {
    const result = verifyPublication(d, { ...evidence, deployment: { ...evidence.deployment, state } });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'pending');
  }
  const failed = verifyPublication(d, { ...evidence, deployment: { ...evidence.deployment, state: 'ERROR' } });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 'deployment_failed');
});

test('changed live article copy or a mismatched publication receipt cannot pass verification', () => {
  const { verifyPublication } = require('../scripts/insights-pilot');
  const { d, evidence } = syntheticEvidence();
  const changed = structuredClone(evidence);
  changed.pages.article.body = changed.pages.article.body.replace('Fictional example for automated tests only.', 'Changed synthetic text not in the approved packet.');
  const result = verifyPublication(d, changed);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('live_content_mismatch'));
  assert.ok(result.errors.includes('live_page_changed_since_publication'));

  const wrongReceipt = structuredClone(evidence);
  wrongReceipt.receipt.fingerprint = '0'.repeat(64);
  assert.ok(verifyPublication(d, wrongReceipt).errors.includes('publication_receipt_mismatch'));
});

test('verification rejects missing canonical, listing, sitemap, navigation or blocked indexing', () => {
  const { verifyPublication } = require('../scripts/insights-pilot');
  const { d, evidence } = syntheticEvidence();
  const cases = [
    ['canonical_mismatch', e => { e.pages.article.body = e.pages.article.body.replace(/<link\b[^>]*\brel="canonical"[^>]*>/, ''); }],
    ['listing_link_missing', e => { e.pages.listing.body = e.pages.listing.body.replaceAll(`/insights/${d.slug}/`, '/synthetic-missing-link/'); }],
    ['sitemap_entry_missing', e => { e.pages.sitemap.body = e.pages.sitemap.body.replace(`<loc>${d.url}</loc>`, ''); }],
    ['insights_navigation_missing', e => { e.pages.home.body = e.pages.home.body.replaceAll('href="/insights/"', 'href="/synthetic-missing-link/"'); }],
    ['indexing_or_snippets_blocked', e => { e.pages.article.headers['X-Robots-Tag'] = 'noindex'; }],
    ['article_not_verified', e => { e.pages.article.status = 404; }],
  ];
  for (const [error, change] of cases) {
    const altered = structuredClone(evidence);
    change(altered);
    const result = verifyPublication(d, altered);
    assert.equal(result.ok, false, error);
    assert.ok(result.errors.includes(error), error);
  }
});

function configureSyntheticApi(t) {
  const values = {
    INSIGHTS_ADMIN_PASSWORD: 'synthetic-password-not-for-use',
    INSIGHTS_SESSION_SECRET: 'synthetic-test-session-secret-not-a-real-credential',
    INSIGHTS_GITHUB_TOKEN: 'synthetic-test-token-never-sent',
    INSIGHTS_GITHUB_BRANCH: 'synthetic-test-branch',
  };
  const previous = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return values;
}

async function invokeApi(input, headers = {}) {
  const handler = require('../api/insights/publish');
  const req = { method: 'POST', headers: { host: 'publisher.example.test', origin: 'https://publisher.example.test', ...headers }, body: input };
  let response;
  const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { response = { code: this.code, body }; return response; } };
  await handler(req, res);
  return response;
}

test('browser API still rejects missing authentication and a foreign origin before repository access', async t => {
  const env = configureSyntheticApi(t);
  let reads = 0, writes = 0;
  t.mock.method(L, 'getHead', async () => { reads++; throw new Error('unexpected read'); });
  t.mock.method(L, 'commitAll', async () => { writes++; throw new Error('unexpected write'); });
  const body = { action: 'create', ...article(), confirm: true };
  const unauthenticated = await invokeApi(body);
  assert.equal(unauthenticated.code, 401);
  assert.equal(unauthenticated.body.error, 'unauthenticated');
  const cookie = `arie_ins=${L.mintToken(env.INSIGHTS_SESSION_SECRET)}`;
  const foreignOrigin = await invokeApi(body, { cookie, origin: 'https://other.example.test' });
  assert.equal(foreignOrigin.code, 403);
  assert.equal(foreignOrigin.body.error, 'forbidden_origin');
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

test('authenticated browser API still requires its explicit review confirmation before a commit', async t => {
  const env = configureSyntheticApi(t);
  let writes = 0;
  const s = snapshot();
  t.mock.method(L, 'getHead', async () => ({ commitSha: HEAD, treeSha: 'd'.repeat(40) }));
  t.mock.method(L, 'getPublicationSnapshot', async () => s);
  t.mock.method(L, 'getFile', async name => s.files[name] ?? null);
  t.mock.method(L, 'readManifest', async () => []);
  t.mock.method(L, 'gh', async () => ({ ok: true, status: 200, json: { tree: [] } }));
  t.mock.method(L, 'commitAll', async () => { writes++; throw new Error('unexpected commit'); });
  const cookie = `arie_ins=${L.mintToken(env.INSIGHTS_SESSION_SECRET)}`;
  const result = await invokeApi({ action: 'create', ...article(), confirm: false }, { cookie });
  assert.equal(result.code, 400);
  assert.equal(result.body.error, 'confirm_required');
  assert.equal(writes, 0);
});
