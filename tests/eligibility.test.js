// Run: npm test
// Synthetic tests for the website eligibility check: server-side routes (rules ported from v0.9),
// the /api/eligibility endpoint (route only, nothing sent) and the Further Review email.
// nodemailer is replaced with a capturing fake: no network, no real email.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const sent = [];
const realLoad = Module._load;
const redisStore = new Map(); let redisDown = false;
Module._load = function (req, ...rest) {
  if (req === 'nodemailer') return { createTransport: () => ({ async sendMail(m) { sent.push(m); return {}; } }) };
  if (req === '@upstash/redis') return { Redis: class { async incr(k) { if (redisDown) throw new Error('down'); const n = (redisStore.get(k) || 0) + 1; redisStore.set(k, n); return n; } async expire() { return 1; } } };
  return realLoad.call(this, req, ...rest);
};
process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = 'https://redis.example.test';
process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = 't';
const rules = require('../api/_lib/eligibility-rules.js');
const evaluateApi = require('../api/eligibility.js');
const formApi = require('../api/website-form.js');

Object.assign(process.env, {
  SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USER: 'u', SMTP_PASS: 'p',
  FORM_FROM_EMAIL: 'no-reply@example.test', FORM_TO_EMAIL: 'customercare@example.test', ALLOWED_ORIGIN: 'https://www.example.test',
});

const base = { company: 'Example Trading Ltd', incorp: 'MU', opsMode: 'no', sector: 'wholesale', activityMode: 'no', owners: ['MU'], incoming: ['GB'], outgoing: ['CN'] };
const route = (a) => rules.evaluate(a).route;

test('standard: no listed factor', () => { assert.equal(route(base), 'standard'); });
test('high-risk jurisdiction only: may continue with review', () => { assert.equal(route({ ...base, incoming: ['NG'] }), 'continue_review'); });
test('high-risk activity only: may continue with review', () => { assert.equal(route({ ...base, activityMode: 'yes', activities: ['H07'] }), 'continue_review'); });
test('restricted activity (v0.9 "unable"): hold, never rejection', () => { assert.equal(route({ ...base, activityMode: 'yes', activities: ['R08'] }), 'hold'); });
test('restricted jurisdiction connection: hold', () => { assert.equal(route({ ...base, outgoing: ['IR'] }), 'hold'); });
test('uncertain answers: hold', () => {
  assert.equal(route({ ...base, activityMode: 'unsure' }), 'hold');
  assert.equal(route({ ...base, owners: [], ownerUnknown: true }), 'hold');
  assert.equal(route({ ...base, sector: 'other' }), 'hold');
  assert.equal(route({ ...base, sector: 'financial' }), 'hold');
});
test('country-specific follow-up is required before a route, then applied', () => {
  const r = rules.evaluate({ ...base, outgoing: ['LY'] });
  assert.deepEqual(r.followUps.map((f) => f.type), ['government', 'oilgas']);
  assert.equal(route({ ...base, outgoing: ['LY'], government: 'no', oilgas: 'no' }), 'continue_review');
  assert.equal(route({ ...base, outgoing: ['LY'], government: 'yes', oilgas: 'no' }), 'hold');
});
test('invalid input is rejected', () => {
  assert.equal(rules.evaluate({ ...base, incorp: 'XX' }).error, 'invalid_incorporation');
  assert.equal(rules.evaluate({ ...base, owners: [] }).error, 'invalid_owners');
});
test('company name is optional, as in v0.9', () => { assert.equal(route({ ...base, company: '' }), 'standard'); });

let ipN = 1;
function call(handler, body, origin = 'https://www.example.test') {
  const req = { method: 'POST', headers: { origin, 'x-forwarded-for': '198.51.100.' + (ipN++) }, body };
  return new Promise((resolve) => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, body: j, headers: this.headers }); } };
    handler(req, res);
  });
}

test('/api/eligibility returns only the route — no reasons, lists or scores; sends nothing', async () => {
  sent.length = 0;
  const r = await call(evaluateApi, { answers: { ...base, activityMode: 'yes', activities: ['R08'] } });
  assert.equal(r.code, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['ok', 'route']);
  assert.equal(r.body.route, 'hold');
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.equal(sent.length, 0);
});
test('/api/eligibility adds only the v0.9 restricted-country wording flag on hold', async () => {
  const r = await call(evaluateApi, { answers: { ...base, outgoing: ['IR'] } });
  assert.deepEqual(r.body, { ok: true, route: 'hold', notice: 'restricted_country' });
  const c = await call(evaluateApi, { answers: { ...base, incoming: ['NG'] } });
  assert.deepEqual(c.body, { ok: true, route: 'continue_review' });
});
test('/api/eligibility enforces origin', async () => { assert.equal((await call(evaluateApi, { answers: base }, 'https://evil.test')).code, 403); });
test('preview deployments accept only their own URL; production does not', async () => {
  const saved = { e: process.env.VERCEL_ENV, b: process.env.VERCEL_BRANCH_URL };
  process.env.VERCEL_BRANCH_URL = 'site-git-branch.vercel.app';
  process.env.VERCEL_ENV = 'preview';
  assert.equal((await call(evaluateApi, { answers: base }, 'https://site-git-branch.vercel.app')).code, 200);
  assert.equal((await call(evaluateApi, { answers: base }, 'https://other-git-x.vercel.app')).code, 403);
  process.env.VERCEL_ENV = 'production';
  assert.equal((await call(evaluateApi, { answers: base }, 'https://site-git-branch.vercel.app')).code, 403);
  process.env.VERCEL_ENV = saved.e || ''; if (!saved.e) delete process.env.VERCEL_ENV; if (saved.b) process.env.VERCEL_BRANCH_URL = saved.b; else delete process.env.VERCEL_BRANCH_URL;
});

const contact = { name: 'Test Person', email: 'test.person@example.test', phone: '', note: 'Fictional test.', tcs: true };
test('Further Review email reaches the inbox with answers, contact details and the server-computed route', async () => {
  sent.length = 0;
  const answers = { ...base, activityMode: 'yes', activities: ['R08'], incoming: ['GB', 'ZA'] };
  const r = await call(formApi, { form: 'eligibility_review', url: 'https://www.example.test/#eligibility', fields: contact, answers });
  assert.equal(r.code, 200); assert.equal(r.body.ok, true);
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, 'customercare@example.test');
  assert.equal(m.replyTo, 'test.person@example.test');
  assert.match(m.subject, /^ARIE Eligibility — Further Review — Example Trading Ltd — Test Person$/);
  for (const s of ['ON HOLD', 'Restricted activity R08', 'Online or interactive gambling', 'Country of incorporation: MU', 'Incoming payment countries: GB, ZA', 'Fictional test.', 'Consent: Yes', 'not an application or compliance decision']) assert.ok(m.text.includes(s), 'missing: ' + s);
  assert.equal(r.body.reference, undefined);   // no invented reference numbers
});
test('Further Review ignores any client-claimed route (re-computed server-side)', async () => {
  sent.length = 0;
  await call(formApi, { form: 'eligibility_review', fields: contact, answers: { ...base, route: 'hold' }, route: 'hold' });
  assert.match(sent[0].text, /Preliminary route \(server\): Standard/);
});
test('Further Review requires consent and valid contact details', async () => {
  assert.equal((await call(formApi, { form: 'eligibility_review', fields: { ...contact, tcs: false }, answers: base })).body.error, 'consent_required');
  assert.equal((await call(formApi, { form: 'eligibility_review', fields: { ...contact, email: 'nope' }, answers: base })).body.error, 'invalid_email');
  assert.equal((await call(formApi, { form: 'eligibility_review', fields: contact, answers: { ...base, incorp: '' } })).body.error, 'invalid_incorporation');
});

function callFrom(handler, body, ip) {
  const req = { method: 'POST', headers: { origin: 'https://www.example.test', 'x-forwarded-for': ip }, body };
  return new Promise((resolve) => { const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, body: j }); } }; handler(req, res); });
}
test('rate limit: shared Redis counter allows 8 checks a minute per IP, then 429', async () => {
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await callFrom(evaluateApi, { answers: base }, '192.0.2.10')).code);
  assert.deepEqual(codes.slice(0, 8), Array(8).fill(200));
  assert.equal(codes[8], 429);
  assert.equal((await callFrom(evaluateApi, { answers: base }, '192.0.2.11')).code, 200);   // other visitors unaffected
  const keys = [...redisStore.keys()].filter((k) => k.includes('192.0.2.10'));
  assert.ok(keys.length === 2 && keys.every((k) => k.startsWith('elig:rl:')), keys.join(','));   // minute + hour counters in Redis
});
test('rate limit: Redis failure falls back to the in-memory limit (never unlimited)', async () => {
  redisDown = true;
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await callFrom(evaluateApi, { answers: base }, '192.0.2.20')).code);
  redisDown = false;
  assert.equal(codes[8], 429);
});

// ---------- /eligibility shareable page (api/eligibility-page.js) ----------
const pageApi = require('../api/eligibility-page.js');
test('/eligibility serves the site with eligibility social-preview metadata and opens the checker', async () => {
  const html = await new Promise((resolve) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { resolve({ code: this.code, body: b, headers: this.headers }); } };
    pageApi({ url: '/eligibility?utm_source=introducer' }, res);
  });
  assert.equal(html.code, 200);
  const b = html.body;
  assert.match(b, /<title>ARIE Finance — Check Your Eligibility<\/title>/);
  assert.match(b, /<meta property="og:title" content="ARIE Finance — Check Your Eligibility">/);
  assert.match(b, /<meta property="og:description" content="Complete a preliminary business eligibility check, explore indicative pricing and understand the next steps.">/);
  assert.match(b, /<meta property="og:url" content="https:\/\/www.ariefinance.com\/eligibility">/);
  assert.match(b, /<meta property="og:image" content="https:\/\/www.ariefinance.com\/assets\/og-eligibility.jpg">/);
  assert.match(b, /<link rel="canonical" href="https:\/\/www.ariefinance.com\/eligibility">/);
  assert.match(b, /history.replaceState\(null,"",location.pathname\+location.search\+"#eligibility"\)/);
  assert.ok(b.includes('id="elig-root"'));
  const socialImages = [...b.matchAll(/<meta (?:property="og:image"|name="twitter:image") content="([^"]*)">/g)].map(match => match[1]);
  assert.deepEqual(socialImages, Array(2).fill('https://www.ariefinance.com/assets/og-eligibility.jpg'), 'active social-preview tags must use the eligibility image');
});

// ---------- Share button: clean URL for every method ----------
test('share button uses the clean /eligibility URL for every method, whatever the visitor arrived with', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const base = html.match(/var SHARE_BASE='([^']+)';/)[1];
  const fn = html.match(/function shareUrl\([^)]*\)\{[\s\S]*?\}/)[0];
  assert.equal(base, 'https://www.ariefinance.com/eligibility');
  for (const search of ['', '?utm_source=introducer&utm_campaign=ABC12', '?utm_source=instagram&utm_medium=social', '?utm_source=share&utm_medium=copy']) {
    const shareUrl = new Function('location', 'SHARE_BASE', fn + '; return shareUrl;')({ search }, base);
    for (const m of ['native', 'copy', 'whatsapp', 'email']) assert.equal(shareUrl(m), base);
  }
  // Sharing is still measured, once per method.
  for (const m of ['native', 'copy']) assert.ok(html.includes("track('elig_share',{share_method:'" + m + "'})"), m);
});
