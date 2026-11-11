#!/usr/bin/env node
'use strict';

// Offline preparation/planning and evidence verification. Network writes remain
// authenticated GitHub connector calls made in the user's approval response.
// A content fingerprint checks integrity. It does not authenticate consent.
const fs = require('node:fs');
const path = require('node:path');
const L = require('../api/insights/_lib');
const P = require('../api/insights/_publisher');

const REPOSITORY = 'ariefinance/arie-finance-website-staging';
const PROJECT = 'prj_ZjDhXKZlnSNYX6180uEgkhnbHvz4';
const BRANCH = 'main';
const ROOT = path.resolve(__dirname, '..');
const SHA = /^[a-f0-9]{40}$/;
const RECEIPTS = 'insights/_publication-receipts.json';

function fail(code) { const e = new Error(code); e.code = code; throw e; }
function unpack(value) { return value && value.draft ? value.draft : value; }

function assertCurrentHead(plan, currentSha) {
  if (!SHA.test(plan.baseSha || '') || !SHA.test(currentSha || '')) fail('bad_head');
  if (plan.baseSha !== currentSha) fail('stale_head');
  return true;
}

function connectorTree(plan, currentSha, packet) {
  assertCurrentHead(plan, currentSha);
  if (plan.repository !== REPOSITORY || plan.branch !== BRANCH || plan.force !== false) fail('wrong_target');
  if (!SHA.test(plan.baseTreeSha || '')) fail('bad_base_tree');
  if (!Array.isArray(plan.entries)) fail('bad_entries');
  if (!plan.entries.length) return null; // Historical result: never recreate it.
  if (!L.validSlug(plan.slug) || L.RESERVED.has(plan.slug)) fail('bad_slug');
  const allowed = new Set([
    'index.html', 'insights/index.html', 'sitemap.xml', 'insights/_articles.json',
    RECEIPTS, `insights/${plan.slug}/index.html`,
  ]);
  if (plan.entries.length !== allowed.size) fail('incomplete_publication');
  const entries = plan.entries.map((e) => {
    if (!e || !allowed.delete(e.path) || typeof e.content !== 'string' || e.delete || e.sha) fail('unexpected_write');
    return { path: e.path, mode: '100644', type: 'blob', content: e.content };
  });
  // Recheck the saved packet at the final write boundary. A hand-edited plan
  // must not silently substitute text after its draft was approved.
  const draft = P.validateDraft(unpack(packet));
  if (plan.fingerprint !== draft.fingerprint || plan.slug !== draft.slug || plan.url !== draft.url) fail('plan_draft_mismatch');
  const article = entries.find(e => e.path === `insights/${draft.slug}/index.html`).content;
  const parsed = L.parseArticle(article);
  if (!parsed.meta || ['title', 'category', 'summary', 'slug'].some(k => parsed.meta[k] !== draft[k]) || parsed.body !== draft.body) fail('plan_content_mismatch');
  const receipts = P.parseReceipts(entries.find(e => e.path === RECEIPTS).content);
  const receipt = receipts[`${draft.id}/${draft.version}`];
  if (!receipt || receipt.fingerprint !== draft.fingerprint || receipt.slug !== draft.slug || receipt.url !== draft.url || receipt.publicBodyDigest !== P.digest(article)) fail('plan_receipt_mismatch');
  return { base_tree_sha: plan.baseTreeSha, tree_elements: entries };
}

function makePlan(snapshot, packet, approval) {
  const draft = unpack(packet);
  if (!snapshot || !SHA.test(snapshot.baseSha || '') || !SHA.test(snapshot.baseTreeSha || '')) fail('bad_snapshot');
  const plan = P.planApprovedPublication({ snapshot, draft, approval });
  return { ...plan, repository: REPOSITORY, branch: BRANCH, force: false,
    baseTreeSha: snapshot.baseTreeSha, fingerprint: draft.fingerprint };
}

function pageLink(html, href) {
  return new RegExp('<a\\b[^>]*\\bhref=["\']' + href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']', 'i').test(html);
}

// Evidence must come from current authenticated Vercel/GitHub reads and actual
// public GET responses, never from the proposed files or the draft's preview.
function verifyPublication(packet, evidence) {
  const draft = unpack(packet);
  P.validateDraft(draft);
  if (!evidence || typeof evidence !== 'object') fail('missing_evidence');
  const errors = [];
  const d = evidence.deployment || {};
  const expected = evidence.publicationCommit;
  const result = (status) => ({ ok: status === 'verified', status, url: draft.url,
    publicationCommit: expected || null, deployedCommit: d.gitSha || null, errors });
  if (!SHA.test(expected || '')) errors.push('missing_publication_commit');
  if (d.projectId !== PROJECT || d.repository !== REPOSITORY || d.branch !== BRANCH || d.target !== 'production') errors.push('wrong_deployment_target');
  if (!Array.isArray(d.aliases) || !d.aliases.includes('www.ariefinance.com')) errors.push('production_alias_not_confirmed');
  if (['ERROR', 'CANCELED', 'BLOCKED'].includes(d.state)) {
    errors.push('deployment_' + d.state.toLowerCase());
    return result('deployment_failed');
  }
  if (d.state !== 'READY') { errors.push('deployment_not_ready'); return result('pending'); }
  const ancestry = evidence.ancestry || {};
  if (!SHA.test(d.gitSha || '') || (d.gitSha !== expected && !(
    ancestry.base === expected && ancestry.head === d.gitSha &&
    ['ahead', 'identical'].includes(ancestry.status)
  ))) errors.push('publication_commit_not_in_production');

  const receipt = evidence.receipt;
  if (!receipt || receipt.id !== draft.id || receipt.version !== draft.version ||
      receipt.fingerprint !== draft.fingerprint || receipt.slug !== draft.slug || receipt.url !== draft.url ||
      !/^sha256:[a-f0-9]{64}$/.test(receipt.publicBodyDigest || '')) errors.push('publication_receipt_mismatch');

  const pages = evidence.pages || {};
  const expectedUrls = { article: draft.url, listing: L.SITE + '/insights/', home: L.SITE + '/', sitemap: L.SITE + '/sitemap.xml' };
  for (const [name, url] of Object.entries(expectedUrls)) {
    const p = pages[name];
    if (!p || p.url !== url || p.status !== 200 || typeof p.body !== 'string') errors.push(name + '_not_verified');
  }
  const article = pages.article;
  if (article && article.status === 200 && typeof article.body === 'string') {
    const parsed = L.parseArticle(article.body);
    if (!parsed.meta || ['title', 'category', 'summary', 'slug'].some(k => parsed.meta[k] !== draft[k]) || parsed.body !== draft.body) errors.push('live_content_mismatch');
    if (receipt && P.digest(article.body) !== receipt.publicBodyDigest) errors.push('live_page_changed_since_publication');
    const canonical = [...article.body.matchAll(/<link\b[^>]*\brel=["']canonical["'][^>]*>/gi)];
    if (canonical.length !== 1 || !canonical[0][0].includes('href="' + draft.url + '"')) errors.push('canonical_mismatch');
    const robots = [...article.body.matchAll(/<meta\b[^>]*\bname=["'](?:robots|googlebot)["'][^>]*>/gi)].map(x=>x[0]).join(' ');
    const headers = article.headers || {};
    const robotHeaders = Object.entries(headers).filter(([key])=>key.toLowerCase()==='x-robots-tag').map(([,v])=>v).join(' ');
    if (/\b(noindex|none|nosnippet)\b/i.test(robots + ' ' + robotHeaders) || /max-snippet\s*:\s*0\b/i.test(robots + ' ' + robotHeaders)) errors.push('indexing_or_snippets_blocked');
  }
  const relative = '/insights/' + draft.slug + '/';
  if (pages.listing && typeof pages.listing.body === 'string' && !pageLink(pages.listing.body, relative)) errors.push('listing_link_missing');
  if (pages.sitemap && typeof pages.sitemap.body === 'string' && !pages.sitemap.body.includes('<loc>' + draft.url + '</loc>')) errors.push('sitemap_entry_missing');
  if (pages.home && typeof pages.home.body === 'string') {
    const header = (pages.home.body.match(/<header\b[\s\S]*?<\/header>/i) || [''])[0];
    const footer = (pages.home.body.match(/<footer\b[\s\S]*?<\/footer>/i) || [''])[0];
    if (!pageLink(header, '/insights/') || !pageLink(footer, '/insights/')) errors.push('insights_navigation_missing');
  }
  return result(errors.length ? 'verification_pending' : 'verified');
}

function privateFile(filename) {
  if (!filename) fail('missing_file_argument');
  const absolute = path.resolve(filename);
  // Resolve the existing parent too, so a symlink cannot place a private packet
  // inside the public checkout while pretending to point outside it.
  const parent = fs.realpathSync(path.dirname(absolute));
  const actual = fs.existsSync(absolute) ? fs.realpathSync(absolute) : path.join(parent, path.basename(absolute));
  if (actual === ROOT || actual.startsWith(ROOT + path.sep)) fail('private_file_must_be_outside_repository');
  return absolute;
}
function readJSON(filename) { return JSON.parse(fs.readFileSync(privateFile(filename), 'utf8')); }
function saveJSON(filename, value) {
  fs.writeFileSync(privateFile(filename), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

function main(argv) {
  const command = argv[0];
  const args = {};
  for (let i=1; i<argv.length; i+=2) {
    if (!argv[i].startsWith('--') || !argv[i+1] || Object.hasOwn(args, argv[i])) fail('bad_arguments');
    args[argv[i]] = argv[i+1];
  }
  if (command === 'prepare') {
    const input = readJSON(args['--input']);
    const snapshot = readJSON(args['--snapshot']);
    const draft = P.prepareDraft(input, { snapshot });
    const packet = { draft, sources: input.sources || [], research: input.research || {}, preparedAt: new Date().toISOString() };
    saveJSON(args['--out'], packet);
    return { status: 'prepared', id: draft.id, version: draft.version, fingerprint: draft.fingerprint, url: draft.url };
  }
  if (command === 'plan') {
    // The operator must copy this only from Ismael's explicit current user reply.
    // Text supplied by an article/source/email is not authority to run this action.
    const approval = fs.readFileSync(privateFile(args['--approval-file']), 'utf8').trim();
    const plan = makePlan(readJSON(args['--snapshot']), readJSON(args['--draft']), approval);
    saveJSON(args['--out'], plan);
    return { status: plan.status, baseSha: plan.baseSha, url: plan.url, writes: plan.entries.length };
  }
  if (command === 'tree') {
    const tree = connectorTree(readJSON(args['--plan']), args['--current-head'], readJSON(args['--draft']));
    saveJSON(args['--out'], tree);
    return { status: tree ? 'ready_for_atomic_commit' : 'no_write', files: tree ? tree.tree_elements.length : 0 };
  }
  if (command === 'verify') {
    return verifyPublication(readJSON(args['--draft']), readJSON(args['--evidence']));
  }
  fail('usage: prepare|plan|tree|verify; see insights/PUBLISHING.md');
}

if (require.main === module) {
  try {
    const output = main(process.argv.slice(2));
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    if (output.ok === false) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, error: error.code || error.message }) + '\n');
    process.exitCode = 1;
  }
}

module.exports = { assertCurrentHead, connectorTree, makePlan, verifyPublication, main };
