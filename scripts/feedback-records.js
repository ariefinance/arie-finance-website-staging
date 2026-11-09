#!/usr/bin/env node
// ============================================================================
//  ARIE Finance — feedback record recovery (authorised staff only)
//
//  Reads the dedicated feedback database. Use it to recover submissions whose
//  notification email failed, or to retrieve a record by reference.
//  Requires the same variables as /api/feedback:
//    FEEDBACK_REDIS_REST_URL, FEEDBACK_REDIS_REST_TOKEN, FEEDBACK_ENCRYPTION_KEY
//    VERCEL_ENV (production | preview | development) selects the namespace.
//
//  Usage:
//    node scripts/feedback-records.js list [--failed]   # metadata only, no personal data
//    node scripts/feedback-records.js show <reference>  # decrypts one record
//    node scripts/feedback-records.js mark <reference> <event> [note]
//        appends an event, e.g. "triaged", "complaint_logged", "replied"
//        (events are append-only; createdAt is never changed)
// ============================================================================
const { Redis } = require('@upstash/redis');
const { decrypt } = require('../api/feedback.js').__test;

const env = process.env;
for (const k of ['FEEDBACK_REDIS_REST_URL', 'FEEDBACK_REDIS_REST_TOKEN', 'FEEDBACK_ENCRYPTION_KEY']) {
  if (!env[k]) { console.error('Missing ' + k); process.exit(2); }
}
const key = Buffer.from(env.FEEDBACK_ENCRYPTION_KEY, 'base64');
const ns = 'feedback:' + (env.VERCEL_ENV || 'development') + ':';
const redis = new Redis({ url: env.FEEDBACK_REDIS_REST_URL, token: env.FEEDBACK_REDIS_REST_TOKEN });
const parse = (raw) => (typeof raw === 'string' ? JSON.parse(raw) : raw);
const [cmd, a, b, c] = process.argv.slice(2);

(async () => {
  if (cmd === 'list') {
    const refs = await redis.zrange(ns + 'index', 0, -1);
    for (const ref of refs) {
      const r = parse(await redis.get(ns + 'rec:' + ref));
      if (!r) continue; // expired under the retention period
      const last = r.events[r.events.length - 1].event;
      if (a === '--failed' && !r.events.some((e) => e.event === 'notification_failed') ) continue;
      console.log([ref, r.createdAt, r.type, r.formalComplaint ? 'COMPLAINT' : '-', last].join('\t'));
    }
  } else if (cmd === 'show' && a) {
    const r = parse(await redis.get(ns + 'rec:' + a));
    if (!r) { console.error('Not found (or expired): ' + a); process.exit(1); }
    console.log(JSON.stringify({ reference: a, ...r, personal: decrypt(key, r.personal) }, null, 2));
  } else if (cmd === 'mark' && a && b) {
    const r = parse(await redis.get(ns + 'rec:' + a));
    if (!r) { console.error('Not found (or expired): ' + a); process.exit(1); }
    r.events.push({ at: new Date().toISOString(), event: String(b), note: c ? String(c).slice(0, 300) : undefined });
    await redis.set(ns + 'rec:' + a, JSON.stringify(r), { xx: true, keepTtl: true });
    console.log('Appended ' + b + ' to ' + a);
  } else {
    console.log('Usage: list [--failed] | show <reference> | mark <reference> <event> [note]');
    process.exit(2);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
