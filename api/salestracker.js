// ============================================================================
//  ARIE Finance — Sales Pipeline & Revenue Board API  (Vercel serverless)
//  Route:  /api/salestracker
//  Shared, authenticated store for the board served at /salestracker.
// ----------------------------------------------------------------------------
//  The board keeps a single state object { v, savedAt, settings, data }. This
//  API stores it in Upstash Redis behind a passcode login (HttpOnly cookie).
//  Writes use a server-side compare-and-set on a version counter, so two
//  people saving at once cannot silently clobber: a stale save is rejected and
//  the client merges its own changes onto the latest and retries.
//
//  Redis keys:
//    st:board             STR  current state blob (JSON)
//    st:board:ver          STR  monotonic version counter
//    st:board:savedAt      STR  ISO timestamp of last save
//    st:board:seed         STR  original seed (leads by segment) for Reset/merge
//    st:board:histz        ZSET score=save-time-ms, member=version           (backups)
//    st:board:hist:v:<ver> STR  historical state blob (JSON, TTL 30d)         (backups)
//    st:board:hist:lastAt  STR  ms timestamp of last kept snapshot (throttle)
//    st:signkey            STR  server HMAC key for session tokens
//    st:loginfail:<ip>     STR  failed-login throttle counter (TTL)
// ----------------------------------------------------------------------------
//  ENV (production Vercel project):
//    SALESTRACKER_PASSCODE           staff passcode (secret; never in source)
//    KV_REST_API_URL / KV_REST_API_TOKEN   (or UPSTASH_REDIS_REST_URL/TOKEN)
// ----------------------------------------------------------------------------
//  Actions (JSON body or ?action=; all except login/logout need the cookie):
//    POST {action:"login", passcode}                       -> sets cookie
//    POST {action:"logout"}                                -> clears cookie
//    GET  ?action=board                                    -> { state, version, savedAt }
//    POST {action:"board", state, baseVersion}             -> { version } | 409 conflict
//    GET  ?action=ver                                      -> { version }
//    GET  ?action=seed                                     -> { seed }
//    POST {action:"board-seed", state, seed}               -> { seeded } (once only)
//    GET  ?action=history                                  -> { snapshots:[{version,savedAt}] }
//    POST {action:"restore", version, baseVersion}         -> { version } | 404 | 409
// ============================================================================

const crypto = require('crypto');

function resolveRedisCreds() {
  const env = process.env;
  const known = [
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ];
  for (const [u, t] of known) if (env[u] && env[t]) return { url: env[u], token: env[t] };
  return { url: '', token: '' };
}
const _creds = resolveRedisCreds();
const REST_URL = _creds.url;
const REST_TOKEN = _creds.token;
const PASSCODE = process.env.SALESTRACKER_PASSCODE || '';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;   // board blob can be a few hundred KB
const LOGIN_WINDOW_S = 900;
const LOGIN_MAX_FAIL = 12;

// Strict structural validation of the canonical 1,186-record dataset.
// Returns null when valid, or a short reason string when not.
const SEED_SEGMENTS = ['uae', 'mauritius', 'uk', 'existing', 'africa', 'luca', 'onboarding', 'film'];
const SEED_TOTAL = 1186;
function validateCanonical(seed) {
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) return 'not_object';
  for (const k of SEED_SEGMENTS) if (!Array.isArray(seed[k])) return 'segment:' + k;
  for (const k of Object.keys(seed)) if (!SEED_SEGMENTS.includes(k)) return 'unexpected:' + k;
  const ids = new Set(); let total = 0;
  for (const k of SEED_SEGMENTS) {
    for (const r of seed[k]) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) return 'record:' + k;
      const id = String(r.id == null ? '' : r.id).trim();
      const co = String(r.company == null ? '' : r.company).trim();
      if (!id) return 'noid:' + k;
      if (!co) return 'nocompany:' + k;
      if (ids.has(id)) return 'dupe:' + id;
      ids.add(id); total++;
    }
  }
  if (total !== SEED_TOTAL) return 'count:' + total;
  return null;
}

async function redis(cmd) {
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('redis: ' + (j.error || r.status));
  return j.result;
}

// ---- session tokens (HMAC, server-side key) -------------------------------
let _signKey = null;
async function signKey() {
  if (_signKey) return _signKey;
  let k = await redis(['GET', 'st:signkey']);
  if (!k) { const fresh = crypto.randomBytes(32).toString('hex'); await redis(['SET', 'st:signkey', fresh, 'NX']); k = await redis(['GET', 'st:signkey']); }
  _signKey = k; return k;
}
function b64url(s) { return Buffer.from(s).toString('base64url'); }
function mintToken(key) {
  const payload = b64url(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS }));
  return payload + '.' + crypto.createHmac('sha256', key).update(payload).digest('base64url');
}
function verifyToken(token, key) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return false;
  const [p, sig] = token.split('.');
  const exp = crypto.createHmac('sha256', key).update(p).digest('base64url');
  const a = Buffer.from(sig || ''), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  let data; try { data = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return false; }
  return data && typeof data.exp === 'number' && Date.now() < data.exp;
}
function constEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; }
  return crypto.timingSafeEqual(x, y);
}

// ---- cookies --------------------------------------------------------------
const COOKIE = 'arie_st';
function cookieSecure(req) { const p = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim(); return p ? p === 'https' : true; }
function setCookie(res, req, token, maxAgeS) {
  const parts = [COOKIE + '=' + token, 'Path=/api/salestracker', 'Max-Age=' + maxAgeS, 'HttpOnly', 'SameSite=Strict'];
  if (cookieSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function sessionToken(req) { const c = req.headers.cookie || ''; const m = c.match(/(?:^|;\s*)arie_st=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }

function readBody(req) {
  if (req.body && typeof req.body === 'object') { if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY_BYTES) return { tooLarge: true }; return { body: req.body }; }
  if (typeof req.body === 'string') { if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) return { tooLarge: true }; try { return { body: JSON.parse(req.body) }; } catch { return { body: null }; } }
  return { body: {} };
}
function clientIp(req) { const x = req.headers['x-forwarded-for']; if (x) return String(x).split(',')[0].trim(); return (req.socket && req.socket.remoteAddress) || 'unknown'; }

// Lua: compare-and-set the board blob against a version. Returns {1,newVer} on
// success or {0,currentVer} when the caller's baseVersion is stale.
const CAS_LUA =
  "local v=redis.call('GET',KEYS[2]); v=(v and tonumber(v)) or 0;" +
  "if v~=tonumber(ARGV[2]) then return {0,v} end;" +
  "redis.call('SET',KEYS[1],ARGV[1]); local nv=v+1;" +
  "redis.call('SET',KEYS[2],tostring(nv)); redis.call('SET',KEYS[3],ARGV[3]);" +
  "return {1,nv}";
// Lua: seed once — only if the board does not exist yet.
const SEED_LUA =
  "if redis.call('EXISTS',KEYS[1])==1 then return 0 end;" +
  "redis.call('SET',KEYS[1],ARGV[1]); redis.call('SET',KEYS[2],ARGV[2]);" +
  "redis.call('SET',KEYS[3],'1'); redis.call('SET',KEYS[4],ARGV[3]); return 1";

// ---- backup / restore (rolling history of saved board snapshots) -----------
// A snapshot is taken on every successful save, throttled to at most one per
// HIST_MIN_INTERVAL_MS so a burst of edits does not churn out identical entries;
// oldest entries beyond HIST_KEEP are dropped. Each snapshot is a separate
// Redis STRING with a 30-day TTL, indexed in the ZSET st:board:histz by save
// timestamp so history() returns metadata without shipping the state bodies.
const HIST_KEEP             = 30;
const HIST_MIN_INTERVAL_MS  = 5 * 60 * 1000;       // 5 min throttle between snapshots
const HIST_TTL_S            = 60 * 60 * 24 * 30;   // 30 days
function histKey(version) { return 'st:board:hist:v:' + String(version); }
async function snapshotBoard(stateJson, version, savedAt, opts) {
  try {
    const now = Date.now();
    if (!(opts && opts.force)) {
      const lastAtRaw = await redis(['GET', 'st:board:hist:lastAt']);
      const lastAt = lastAtRaw ? parseInt(lastAtRaw, 10) : 0;
      if (Number.isFinite(lastAt) && lastAt > 0 && now - lastAt < HIST_MIN_INTERVAL_MS) return { kept: false, throttled: true };
    }
    const key = histKey(version);
    // Record the snapshot: state blob (TTL'd), index it in the ZSET by timestamp,
    // and stamp the throttle marker. Best-effort — a partial failure at worst
    // leaves an orphan key that expires on its own.
    await redis(['SET', key, stateJson, 'EX', String(HIST_TTL_S)]);
    // Score is the save timestamp in ms; if savedAt is a valid ISO string use it,
    // otherwise fall back to now so the history stays ordered even without one.
    let ts = Date.parse(String(savedAt || '')); if (!Number.isFinite(ts)) ts = now;
    await redis(['ZADD', 'st:board:histz', String(ts), String(version)]);
    await redis(['SET', 'st:board:hist:lastAt', String(now)]);
    // Prune oldest entries once the cap is exceeded.
    const size = parseInt(await redis(['ZCARD', 'st:board:histz']), 10) || 0;
    if (size > HIST_KEEP) {
      const excess = size - HIST_KEEP;
      const drop = await redis(['ZRANGE', 'st:board:histz', '0', String(excess - 1)]);
      if (Array.isArray(drop) && drop.length) {
        // Delete each old snapshot key and remove it from the index. Sequential
        // is fine — pruning runs off the request's happy path.
        for (const v of drop) { try { await redis(['DEL', histKey(v)]); } catch (_) {} try { await redis(['ZREM', 'st:board:histz', String(v)]); } catch (_) {} }
      }
    }
    return { kept: true };
  } catch (_) {
    // Backups are best-effort: never fail the user's save because of a snapshot error.
    return { kept: false, error: true };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (!REST_URL || !REST_TOKEN) return res.status(503).json({ ok: false, error: 'storage_unconfigured' });
  if (!PASSCODE) return res.status(503).json({ ok: false, error: 'passcode_unconfigured' });

  const method = req.method;
  const action = (req.query && req.query.action) || (method !== 'GET' ? (readBody(req).body || {}).action : '') || '';

  try {
    if (action === 'login') {
      if (method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method' }); }
      const ip = clientIp(req);
      const failKey = 'st:loginfail:' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24);
      const fails = parseInt(await redis(['GET', failKey]) || '0', 10);
      if (fails >= LOGIN_MAX_FAIL) return res.status(429).json({ ok: false, error: 'too_many_attempts' });
      const { body, tooLarge } = readBody(req);
      if (tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
      const supplied = body && typeof body.passcode === 'string' ? body.passcode : '';
      if (!supplied || !constEq(supplied, PASSCODE)) {
        const n = await redis(['INCR', failKey]); if (n === 1) await redis(['EXPIRE', failKey, LOGIN_WINDOW_S]);
        return res.status(401).json({ ok: false, error: 'invalid_passcode' });
      }
      await redis(['DEL', failKey]);
      setCookie(res, req, mintToken(await signKey()), Math.floor(TOKEN_TTL_MS / 1000));
      return res.status(200).json({ ok: true, exp: Date.now() + TOKEN_TTL_MS });
    }

    if (action === 'logout') { setCookie(res, req, '', 0); return res.status(200).json({ ok: true }); }

    if (!verifyToken(sessionToken(req), await signKey())) return res.status(401).json({ ok: false, error: 'unauthenticated' });

    // ---- read the shared board state ------------------------------------
    if (action === 'board' && method === 'GET') {
      const [state, ver, savedAt] = await Promise.all([
        redis(['GET', 'st:board']), redis(['GET', 'st:board:ver']), redis(['GET', 'st:board:savedAt']),
      ]);
      return res.status(200).json({ ok: true, state: state ? JSON.parse(state) : null, version: ver ? parseInt(ver, 10) : 0, savedAt: savedAt || null });
    }

    // ---- read the original seed (for Reset / merge) ---------------------
    if (action === 'seed' && method === 'GET') {
      const seed = await redis(['GET', 'st:board:seed']);
      return res.status(200).json({ ok: true, seed: seed ? JSON.parse(seed) : null });
    }

    // ---- lightweight version poll (avoids fetching the whole board) -----
    if (action === 'ver' && method === 'GET') {
      const ver = await redis(['GET', 'st:board:ver']);
      return res.status(200).json({ ok: true, version: ver ? parseInt(ver, 10) : 0 });
    }

    // ---- save the shared board state (compare-and-set) ------------------
    if (action === 'board' && method === 'POST') {
      const { body, tooLarge } = readBody(req);
      if (tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
      if (!body || typeof body.state !== 'object' || body.state === null) return res.status(400).json({ ok: false, error: 'bad_state' });
      const baseVersion = Number.isFinite(body.baseVersion) ? body.baseVersion : parseInt(body.baseVersion, 10);
      if (!Number.isFinite(baseVersion)) return res.status(400).json({ ok: false, error: 'bad_base_version' });
      // Reject state carrying lead ids in a shape that could smuggle markup into the
      // pipeline row template. The client escapes them too; this is defence in depth.
      // Deliberately permissive on the character set (existing seeded ids vary), but
      // blocks anything unsafe in an HTML attribute or as a script/style break-out,
      // plus control characters, and caps length.
      const ID_BAD = /[<>"'`&\u0000-\u001F\u007F]/;
      const stateData = body.state && body.state.data;
      if (stateData && typeof stateData === 'object') {
        for (const k of Object.keys(stateData)) {
          const arr = stateData[k];
          if (!Array.isArray(arr)) continue;
          for (const r of arr) {
            if (!r || typeof r !== 'object') return res.status(400).json({ ok: false, error: 'bad_lead' });
            const id = String(r.id == null ? '' : r.id);
            if (!id || id.length > 128 || ID_BAD.test(id)) {
              return res.status(400).json({ ok: false, error: 'bad_lead_id' });
            }
          }
        }
      }
      const savedAt = new Date().toISOString();
      const stateJson = JSON.stringify(body.state);
      const out = await redis(['EVAL', CAS_LUA, '3', 'st:board', 'st:board:ver', 'st:board:savedAt',
        stateJson, String(baseVersion), savedAt]);
      // out = [ok, ver]
      if (Array.isArray(out) && Number(out[0]) === 1) {
        const newVer = Number(out[1]);
        // Fire-and-forget backup snapshot — never delay the user's save on it.
        snapshotBoard(stateJson, newVer, savedAt).catch(() => {});
        return res.status(200).json({ ok: true, version: newVer, savedAt });
      }
      // conflict: hand back the current state so the client can merge + retry
      const cur = await redis(['GET', 'st:board']);
      return res.status(409).json({ ok: false, error: 'conflict', state: cur ? JSON.parse(cur) : null, version: Array.isArray(out) ? Number(out[1]) : 0 });
    }

    // ---- list historical snapshots (metadata only, no state bodies) -----
    if (action === 'history' && method === 'GET') {
      // Newest first, capped to HIST_KEEP just in case the ZSET grew past it.
      const raw = await redis(['ZREVRANGE', 'st:board:histz', '0', String(HIST_KEEP - 1), 'WITHSCORES']);
      const snapshots = [];
      if (Array.isArray(raw)) {
        for (let i = 0; i + 1 < raw.length; i += 2) {
          const version = parseInt(raw[i], 10);
          const ts = parseInt(raw[i + 1], 10);
          if (Number.isFinite(version) && Number.isFinite(ts)) snapshots.push({ version, savedAt: new Date(ts).toISOString() });
        }
      }
      return res.status(200).json({ ok: true, snapshots });
    }

    // ---- restore a historical snapshot -----------------------------------
    // The caller must supply the version to restore AND their current
    // baseVersion so restore uses the same CAS discipline as a normal save.
    // Before the write, we FORCE-snapshot the current state so an unwanted
    // restore is itself recoverable.
    if (action === 'restore' && method === 'POST') {
      const { body, tooLarge } = readBody(req);
      if (tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
      if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'bad_body' });
      const target = Number.isFinite(body.version) ? body.version : parseInt(body.version, 10);
      const baseVersion = Number.isFinite(body.baseVersion) ? body.baseVersion : parseInt(body.baseVersion, 10);
      if (!Number.isFinite(target) || !Number.isFinite(baseVersion)) return res.status(400).json({ ok: false, error: 'bad_version' });
      // Force a snapshot of the CURRENT state (so this restore itself is undo-able).
      const [curStateRaw, curVerRaw, curSavedAt] = await Promise.all([
        redis(['GET', 'st:board']), redis(['GET', 'st:board:ver']), redis(['GET', 'st:board:savedAt']),
      ]);
      if (curStateRaw) {
        const curVer = curVerRaw ? parseInt(curVerRaw, 10) : 0;
        await snapshotBoard(curStateRaw, curVer, curSavedAt || new Date().toISOString(), { force: true });
      }
      // Pull the requested snapshot and CAS it into place.
      const snap = await redis(['GET', histKey(target)]);
      if (!snap) return res.status(404).json({ ok: false, error: 'snapshot_missing' });
      const savedAt = new Date().toISOString();
      const out = await redis(['EVAL', CAS_LUA, '3', 'st:board', 'st:board:ver', 'st:board:savedAt',
        snap, String(baseVersion), savedAt]);
      if (Array.isArray(out) && Number(out[0]) === 1) {
        const newVer = Number(out[1]);
        return res.status(200).json({ ok: true, version: newVer, savedAt, restoredFrom: target });
      }
      const cur = await redis(['GET', 'st:board']);
      return res.status(409).json({ ok: false, error: 'conflict', state: cur ? JSON.parse(cur) : null, version: Array.isArray(out) ? Number(out[1]) : 0 });
    }

    // ---- one-time seed of the initial board -----------------------------
    if (action === 'board-seed' && method === 'POST') {
      const { body, tooLarge } = readBody(req);
      if (tooLarge) return res.status(413).json({ ok: false, error: 'too_large' });
      if (!body || typeof body.state !== 'object' || !body.state || typeof body.seed !== 'object' || !body.seed) return res.status(400).json({ ok: false, error: 'bad_seed' });
      // Mirror the client's strict validation of the canonical dataset, so a
      // malformed or wrong-size import can never initialise the shared store.
      const vErr = validateCanonical(body.seed) || validateCanonical((body.state && body.state.data) || null);
      if (vErr) return res.status(400).json({ ok: false, error: 'invalid_seed', detail: vErr });
      const savedAt = new Date().toISOString();
      const stateJson = JSON.stringify(body.state);
      const out = await redis(['EVAL', SEED_LUA, '4', 'st:board', 'st:board:seed', 'st:board:ver', 'st:board:savedAt',
        stateJson, JSON.stringify(body.seed), savedAt]);
      if (Number(out) === 1) {
        // Anchor the initial seed as the first history entry so it can be restored.
        snapshotBoard(stateJson, 1, savedAt, { force: true }).catch(() => {});
        return res.status(200).json({ ok: true, seeded: true, version: 1 });
      }
      return res.status(200).json({ ok: true, seeded: false, already: true });
    }

    return res.status(400).json({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};

module.exports.__test = { verifyToken, mintToken, constEq, resolveRedisCreds, cookieSecure, sessionToken, validateCanonical };
