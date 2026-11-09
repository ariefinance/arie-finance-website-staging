// Run: node --test tests/
// Synthetic tests for /api/feedback. Uses an in-memory fake of the Redis REST
// client and a fake mail transport: no network, no real data, no real email.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const handler = require('../api/feedback.js');
const { deps, decrypt, looksSensitive, config } = handler.__test;

const KEY = crypto.randomBytes(32).toString('base64');
const ENV = {
  FEEDBACK_ENABLED: 'true', FEEDBACK_REDIS_REST_URL: 'https://fake.upstash.io', FEEDBACK_REDIS_REST_TOKEN: 't',
  FEEDBACK_ENCRYPTION_KEY: KEY, FEEDBACK_RETENTION_DAYS: '30', FEEDBACK_TO_EMAIL: 'owner@example.test',
  COMPLAINTS_TO_EMAIL: 'complaints@example.test', SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587',
  SMTP_USER: 'u', SMTP_PASS: 'p', FORM_FROM_EMAIL: 'no-reply@example.test', ALLOWED_ORIGIN: 'https://www.example.test',
  VERCEL_ENV: 'preview',
};

function fakeRedis(opts = {}) {
  const kv = new Map(); const ttl = new Map(); const z = new Map();
  let setCalls = 0;
  return {
    kv, ttl, z,
    async incr(k) { const v = (Number(kv.get(k)) || 0) + 1; kv.set(k, String(v)); return v; },
    async expire(k, s) { ttl.set(k, s); return 1; },
    async get(k) { if (opts.failGet) throw new Error('down'); const v = kv.get(k); if (v == null) return null; try { return JSON.parse(v); } catch (_) { return v; } },
    async set(k, v, o = {}) {
      setCalls++;
      if (opts.failSet && k.includes(':rec:')) throw new Error('write failed');
      if (opts.collideFirst && k.includes(':rec:') && setCalls === 1) { kv.set(k, 'taken'); return null; }
      if (o.nx && kv.has(k)) return null;
      if (o.xx && !kv.has(k)) return null;
      kv.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      if (o.ex) ttl.set(k, o.ex);
      return 'OK';
    },
    async zadd(k, { score, member }) { if (opts.failZadd) throw new Error('index down'); if (!z.has(k)) z.set(k, new Map()); z.get(k).set(member, score); return 1; },
    async zremrangebyscore(k, min, max) { const m = z.get(k); if (!m) return 0; let n = 0; for (const [mem, s] of m) if (s >= min && s <= max) { m.delete(mem); n++; } return n; },
  };
}

function run({ env = ENV, method = 'POST', origin = 'https://www.example.test', ip = '203.0.113.7', fields = {}, redis, mail } = {}) {
  const saved = { ...process.env };
  for (const k of Object.keys(ENV)) delete process.env[k];
  Object.assign(process.env, env);
  deps.redis = () => redis;
  deps.transport = () => mail;
  const req = { method, headers: { origin, 'x-forwarded-for': ip }, body: { fields } };
  return new Promise((resolve) => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
      json(j) { process.env = saved; resolve({ code: this.code, body: j }); } };
    handler(req, res);
  });
}
const okMail = () => { const sent = []; return { sent, async sendMail(m) { sent.push(m); return { messageId: 'x' }; } }; };
const badMail = () => ({ sent: [], async sendMail() { const e = new Error('smtp down'); e.code = 'ECONNECTION'; throw e; } });
const valid = { type: 'Service experience', message: 'The onboarding was slow and nobody called me back.', name: 'Test Person', email: 'test.person@example.test' };
const recOf = (r, ref) => JSON.parse(r.kv.get('feedback:preview:rec:' + ref));

test('inactive by default: GET reports disabled, POST refuses', async () => {
  const r = fakeRedis();
  const g = await run({ env: {}, method: 'GET', redis: r, mail: okMail() });
  assert.deepEqual(g.body, { ok: true, enabled: false });
  const p = await run({ env: {}, fields: valid, redis: r, mail: okMail() });
  assert.equal(p.code, 503); assert.equal(p.body.error, 'feedback_not_enabled');
  assert.equal(r.kv.size, 0);
});

test('switch must be explicit, and every dependency present', () => {
  assert.equal(config({ ...ENV, FEEDBACK_ENABLED: 'false' }).enabled, false);
  assert.equal(config({ ...ENV, FEEDBACK_RETENTION_DAYS: '' }).enabled, false);
  assert.equal(config({ ...ENV, FEEDBACK_RETENTION_DAYS: 'two years' }).enabled, false);
  assert.equal(config({ ...ENV, COMPLAINTS_TO_EMAIL: '' }).enabled, false);
  assert.equal(config({ ...ENV, FEEDBACK_ENCRYPTION_KEY: 'short' }).enabled, false);
  assert.equal(config(ENV).enabled, true);
});

test('valid submission: stored durably, encrypted, referenced, then notified', async () => {
  const r = fakeRedis(); const m = okMail();
  const out = await run({ fields: { ...valid, contact_ok: 'on', colleague: 'A Colleague' }, redis: r, mail: m });
  assert.equal(out.code, 200); assert.equal(out.body.ok, true);
  assert.match(out.body.reference, /^FB-\d{6}-[A-HJ-NP-Z2-9]{6}$/);
  const raw = r.kv.get('feedback:preview:rec:' + out.body.reference);
  assert.ok(raw, 'record exists');
  assert.ok(!raw.includes('nobody called me back') && !raw.includes('test.person@'), 'personal data not stored in plaintext');
  const rec = JSON.parse(raw);
  assert.deepEqual(decrypt(Buffer.from(KEY, 'base64'), rec.personal).message, valid.message);
  assert.equal(rec.type, 'Service experience'); assert.equal(rec.formalComplaint, false); assert.equal(rec.triage, 'pending');
  assert.deepEqual(rec.events.map((e) => e.event), ['received', 'notified']);
  assert.equal(r.ttl.get('feedback:preview:rec:' + out.body.reference), 30 * 86400, 'retention TTL applied');
  assert.ok(r.z.get('feedback:preview:index').has(out.body.reference), 'indexed');
  assert.equal(m.sent.length, 1);
  assert.equal(m.sent[0].to, 'owner@example.test'); assert.equal(m.sent[0].cc, undefined);
  assert.match(m.sent[0].subject, /^\[Feedback\] Service experience — FB-/);
  assert.match(m.sent[0].text, /assess any expression of dissatisfaction/i, 'triage instruction regardless of category');
  assert.equal(m.sent[0].replyTo, 'test.person@example.test');
});

test('formal complaint requires name and email, then copies the complaints handler', async () => {
  const r = fakeRedis(); const m = okMail();
  const bad = await run({ fields: { type: 'Compliment', message: 'Please treat this as a complaint.', complaint: 'on' }, redis: r, mail: m });
  assert.equal(bad.code, 400); assert.equal(bad.body.error, 'complaint_contact_required');
  const good = await run({ fields: { ...valid, type: 'Compliment', complaint: 'on' }, redis: r, mail: m, ip: '203.0.113.8' });
  assert.equal(good.code, 200);
  assert.match(m.sent[0].subject, /^\[COMPLAINT\] Compliment — /, 'category does not decide; flag does');
  assert.equal(m.sent[0].cc, 'complaints@example.test');
  assert.equal(recOf(r, good.body.reference).formalComplaint, true);
});

test('anonymous feedback is accepted', async () => {
  const r = fakeRedis(); const m = okMail();
  const out = await run({ fields: { type: 'Suggestion', message: 'Please add a dark mode to the portal.' }, redis: r, mail: m });
  assert.equal(out.code, 200); assert.match(m.sent[0].subject, /— Anonymous$/); assert.equal(m.sent[0].replyTo, undefined);
});

test('email failure: visitor still gets the reference, record kept and flagged for recovery', async () => {
  const r = fakeRedis();
  const out = await run({ fields: valid, redis: r, mail: badMail() });
  assert.equal(out.code, 200); assert.ok(out.body.reference);
  const rec = recOf(r, out.body.reference);
  assert.deepEqual(rec.events.map((e) => e.event), ['received', 'notification_failed']);
  assert.equal(rec.createdAt, rec.events[0].at, 'original timestamp preserved');
});

test('storage failure: no confirmation, no email', async () => {
  const r = fakeRedis({ failSet: true }); const m = okMail();
  const out = await run({ fields: valid, redis: r, mail: m });
  assert.equal(out.code, 503); assert.equal(out.body.ok, false); assert.equal(out.body.reference, undefined);
  assert.equal(m.sent.length, 0);
});

test('reference collision is retried, never overwritten', async () => {
  const r = fakeRedis({ collideFirst: true }); const m = okMail();
  const out = await run({ fields: valid, redis: r, mail: m });
  assert.equal(out.code, 200);
  assert.equal([...r.kv.values()].filter((v) => v === 'taken').length, 1, 'existing key untouched');
});

test('honeypot: silent success, nothing stored or sent', async () => {
  const r = fakeRedis(); const m = okMail();
  const out = await run({ fields: { ...valid, hp_url: 'http://spam' }, redis: r, mail: m });
  assert.equal(out.code, 200); assert.equal(out.body.reference, null); assert.equal(r.kv.size, 0); assert.equal(m.sent.length, 0);
});

test('origin, validation and rate limit', async () => {
  const r = fakeRedis(); const m = okMail();
  assert.equal((await run({ origin: 'https://evil.test', fields: valid, redis: r, mail: m })).code, 403);
  assert.equal((await run({ fields: { ...valid, type: 'Complaint' }, redis: r, mail: m })).body.error, 'invalid_type');
  assert.equal((await run({ fields: { ...valid, message: 'short' }, redis: r, mail: m })).body.error, 'invalid_message');
  assert.equal((await run({ fields: { ...valid, email: 'not-an-email' }, redis: r, mail: m })).body.error, 'invalid_email');
  const r2 = fakeRedis(); let last;
  for (let i = 0; i < 6; i++) last = await run({ fields: { ...valid, message: 'Distinct message number ' + i }, redis: r2, mail: okMail(), ip: '198.51.100.9' });
  assert.equal(last.code, 429);
  assert.ok(![...r2.kv.keys()].some((k) => k.includes('198.51.100.9')), 'raw IP never stored');
});

test('identical resubmission returns the same reference (double-click safe)', async () => {
  const r = fakeRedis(); const m = okMail();
  const a = await run({ fields: valid, redis: r, mail: m });
  const b = await run({ fields: valid, redis: r, mail: m });
  assert.equal(a.body.reference, b.body.reference); assert.equal(b.body.duplicate, true); assert.equal(m.sent.length, 1);
});

test('possible card/IBAN numbers are flagged, not rejected', async () => {
  assert.equal(looksSensitive('My card 4111 1111 1111 1111 was charged'), true);
  assert.equal(looksSensitive('IBAN GB82 WEST 1234 5698 7654 32 please'), true);
  assert.equal(looksSensitive('Great service from the team in 2026'), false);
});

test('preview and production namespaces never collide', () => {
  assert.equal(config({ ...ENV, VERCEL_ENV: 'production' }).ns, 'feedback:production:');
  assert.equal(config(ENV).ns, 'feedback:preview:');
});

test('review fix: adding the complaint flag on resubmission is NOT treated as a duplicate', async () => {
  const r = fakeRedis(); const m = okMail();
  const a = await run({ fields: valid, redis: r, mail: m });
  const b = await run({ fields: { ...valid, complaint: 'on' }, redis: r, mail: m });
  assert.notEqual(a.body.reference, b.body.reference); assert.equal(b.body.duplicate, undefined);
  assert.equal(recOf(r, b.body.reference).formalComplaint, true);
  assert.match(m.sent[1].subject, /^\[COMPLAINT\]/); assert.equal(m.sent[1].cc, 'complaints@example.test');
});

test('review fix: index/dedupe failure after the record is stored still confirms with the reference', async () => {
  const r = fakeRedis({ failZadd: true }); const m = okMail();
  const out = await run({ fields: valid, redis: r, mail: m });
  assert.equal(out.code, 200); assert.ok(out.body.reference);
  assert.ok(r.kv.get('feedback:preview:rec:' + out.body.reference), 'record exists for SCAN recovery');
  assert.equal(m.sent.length, 1, 'notification still sent');
});

test('review fix: ALLOWED_ORIGIN required; shared internal database refused', () => {
  const { ALLOWED_ORIGIN, ...noOrigin } = ENV;
  assert.equal(config(noOrigin).enabled, false);
  assert.equal(config({ ...ENV, UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io/' }).reason, 'shared_database');
  assert.equal(config({ ...ENV, KV_REST_API_URL: 'https://fake.upstash.io' }).enabled, false);
  assert.equal(config({ ...ENV, UPSTASH_REDIS_REST_URL: 'https://other-db.upstash.io' }).enabled, true);
});

test('review fix: rate-limit key and index always carry a TTL; IP hash is keyed', async () => {
  const r = fakeRedis();
  const out = await run({ fields: valid, redis: r, mail: okMail() });
  const rl = [...r.kv.keys()].find((k) => k.includes(':rl:'));
  assert.equal(r.ttl.get(rl), 600); assert.equal(r.ttl.get('feedback:preview:index'), 30 * 86400);
  const plainSha = crypto.createHash('sha256').update('203.0.113.7|feedback:preview:').digest('hex').slice(0, 32);
  assert.ok(!rl.endsWith(plainSha), 'not an unkeyed hash');
  assert.ok(out.body.reference);
});

test('review fix: GET status is briefly cacheable, POST is no-store', async () => {
  const g = await run({ method: 'GET', redis: fakeRedis(), mail: okMail() });
  assert.equal(g.body.enabled, true);
  const saved = { ...process.env }; Object.assign(process.env, ENV);
  const res = { h: {}, code: 0, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json() {} };
  await handler({ method: 'GET', headers: {} }, res); process.env = saved;
  assert.equal(res.h['Cache-Control'], 'public, max-age=60');
  const r = fakeRedis(); const res2 = { h: {}, setHeader(k, v) { this.h[k] = v; }, status() { return this; }, json() {} };
  Object.assign(process.env, ENV); deps.redis = () => r; deps.transport = () => okMail();
  await handler({ method: 'POST', headers: { origin: 'https://www.example.test', 'x-forwarded-for': '192.0.2.1' }, body: { fields: valid } }, res2); process.env = saved;
  assert.equal(res2.h['Cache-Control'], 'no-store');
});
