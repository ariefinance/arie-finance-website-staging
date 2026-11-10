// ============================================================================
//  ARIE Finance — preliminary eligibility rules (SERVER-ONLY)
//  Used by /api/eligibility (evaluate) and /api/website-form (further-review
//  submissions). Never import this file from browser code: the risk lists and
//  hold conditions must not be exposed publicly.
// ----------------------------------------------------------------------------
//  Source: prototype "ARIE_Eligibility_One_Page_Team_Demo_v0.9" (rules ported
//  unchanged). Policy: ARIE approved restricted/high-risk lists · working copy reviewed 28 Oct 2026.
//  This module only produces a PRELIMINARY website route. It is not ARIE's
//  compliance decision engine and does not replace RegMind or Compliance review.
//  If ARIE/RegMind exposes an approved eligibility service, replace evaluate()
//  with a call to it and delete the lists below (single source of truth).
//
//  Public routes (the only thing the browser ever receives):
//    'standard'        -> may proceed to indicative pricing / requirements
//    'continue_review' -> may continue; further Compliance review required
//    'hold'            -> further review required; Contact ARIE (no progression)
//  v0.9 "unable" (restricted activity) is mapped to 'hold' — never shown as a
//  rejection. Mandatory prohibitions are applied in ARIE's internal process.
// ============================================================================
'use strict';

const POLICY_VERSION = "ARIE approved restricted/high-risk lists \u00b7 working copy reviewed 28 Oct 2026";
const RULES_VERSION = 'Website preliminary eligibility 1.0 (rules from v0.9)';

const COUNTRY_CODES = new Set(["AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI", "VN", "VU", "WF", "WS", "XB", "XK", "YE", "YT", "ZA", "ZM", "ZW"]);
const ACTIVITIES = [{"id": "R01", "name": "Anonymous, numbered or special-named accounts where the owner cannot be identified", "risk": "restricted"}, {"id": "R02", "name": "Arms/munitions or nuclear, chemical, biological, radiological weapons and explosives dealing/manufacture", "risk": "restricted"}, {"id": "R03", "name": "Art or antiques dealing and auctioneering", "risk": "restricted"}, {"id": "R04", "name": "Companies with bearer shares", "risk": "restricted"}, {"id": "R05", "name": "Conflict or blood diamond trading", "risk": "restricted"}, {"id": "R06", "name": "Activities involving incitement to violence or racial hatred", "risk": "restricted"}, {"id": "R07", "name": "Unauthorised public fundraising", "risk": "restricted"}, {"id": "R08", "name": "Online or interactive gambling, including supporting services or infrastructure", "risk": "restricted"}, {"id": "R09", "name": "Carbon credits or carbon offset schemes", "risk": "restricted"}, {"id": "R10", "name": "Extremist groups or cults promoting violence", "risk": "restricted"}, {"id": "R11", "name": "Foreign charities, clubs or associations", "risk": "restricted"}, {"id": "R12", "name": "Foreign casino or gambling businesses", "risk": "restricted"}, {"id": "R13", "name": "Foreign money service businesses or informal/unregistered value transfers", "risk": "restricted"}, {"id": "R14", "name": "Foreign animal testing, live exports or fur trading", "risk": "restricted"}, {"id": "R15", "name": "Unregulated foreign online forex trading", "risk": "restricted"}, {"id": "R16", "name": "Unlicensed bet-related services in Mauritius", "risk": "restricted"}, {"id": "R17", "name": "Illegal investment or Ponzi schemes", "risk": "restricted"}, {"id": "R18", "name": "Illegal or unlicensed wildlife trading", "risk": "restricted"}, {"id": "R19", "name": "Activities involving human rights abuses or child labour", "risk": "restricted"}, {"id": "R20", "name": "Military-type security services or defence sector", "risk": "restricted"}, {"id": "R21", "name": "Pornography business", "risk": "restricted"}, {"id": "R22", "name": "Unlicensed banks or shell banks", "risk": "restricted"}, {"id": "R23", "name": "Unlicensed trade in Iraqi or Syrian cultural heritage", "risk": "restricted"}, {"id": "H01", "name": "Designated non-financial businesses and professions (DNFBPs)", "risk": "high"}, {"id": "H02", "name": "Automobile dealing", "risk": "high"}, {"id": "H03", "name": "Regulated foreign online forex trading", "risk": "high"}, {"id": "H04", "name": "Non-profit organisations funded through public/non-member contributions", "risk": "high"}, {"id": "H05", "name": "Investment dealing", "risk": "high"}, {"id": "H06", "name": "Payment intermediary services", "risk": "high"}, {"id": "H07", "name": "Virtual asset service providers (VASPs)", "risk": "high"}];
const ACTIVITY_BY_ID = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));
const RESTRICTED_COUNTRIES = new Set(["CU", "KP", "IR", "IQ", "SO", "SD", "SY", "VE", "MM", "SS", "BY"]);
const HIGH_COUNTRIES = new Set(["AF", "AL", "DZ", "AO", "XB", "BA", "BG", "BF", "BI", "CM", "CF", "TD", "KM", "CI", "HR", "CD", "GQ", "ET", "GN", "GW", "HT", "JM", "KE", "XK", "LA", "LB", "LR", "LY", "MK", "ML", "MC", "ME", "MZ", "NA", "NP", "NI", "NE", "NG", "RU", "RS", "SI", "ZA", "TJ", "TZ", "TN", "TR", "TM", "UA", "VN", "YE", "ZW"]);
const REGULATED_COUNTRIES = {government:new Set(['AF','CF','CD','LY']),precious:new Set(['CF','CD']),oilgas:new Set(['LY','RU'])};
const SECTORS = new Set(["professional", "technology", "wholesale", "manufacturing", "hospitality", "property", "health", "financial", "nonprofit", "other"]);
const SECTOR_PRIORITY = {financial:['H05','H06','H07','H03','R13','R15','R22'],nonprofit:['R11','H04','R07'],property:['H01'],professional:['H01'],wholesale:['H02','R03','R05','R09'],technology:['H07','R08','R16']};
const MODES = new Set(['no', 'yes', 'unsure']);
const SPECIAL = ['government', 'precious', 'oilgas'];

function str(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max); }
function codeList(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const c of v.slice(0, 60)) { const k = str(c, 3).toUpperCase(); if (COUNTRY_CODES.has(k) && !out.includes(k)) out.push(k); }
  return out;
}
function bool(v) { return v === true || v === 'true'; }
function mode(v) { const m = str(v, 10); return MODES.has(m) ? m : null; }

// Normalise untrusted answers; returns { answers } or { error }.
function normalise(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const n = {
    company: str(a.company, 150),
    incorp: str(a.incorp, 3).toUpperCase(),
    opsMode: mode(a.opsMode),
    operations: codeList(a.operations),
    sector: str(a.sector, 30),
    description: str(a.description, 350),
    activityMode: mode(a.activityMode),
    activities: Array.isArray(a.activities) ? [...new Set(a.activities.map((x) => str(x, 4)).filter((x) => ACTIVITY_BY_ID[x]))] : [],
    owners: codeList(a.owners), ownerUnknown: bool(a.ownerUnknown),
    incoming: codeList(a.incoming), incomingUnknown: bool(a.incomingUnknown),
    outgoing: codeList(a.outgoing), outgoingUnknown: bool(a.outgoingUnknown),
  };
  for (const t of SPECIAL) n[t] = mode(a[t]);
  if (n.company.length < 2) return { error: 'invalid_company' };
  if (!COUNTRY_CODES.has(n.incorp)) return { error: 'invalid_incorporation' };
  if (!n.opsMode || (n.opsMode === 'yes' && !n.operations.length)) return { error: 'invalid_operations' };
  if (n.opsMode !== 'yes') n.operations = [];
  if (!SECTORS.has(n.sector)) return { error: 'invalid_sector' };
  if (!n.activityMode || (n.activityMode === 'yes' && !n.activities.length)) return { error: 'invalid_activities' };
  if (n.activityMode !== 'yes') n.activities = [];
  for (const [list, unk] of [['owners', 'ownerUnknown'], ['incoming', 'incomingUnknown'], ['outgoing', 'outgoingUnknown']]) {
    if (n[unk]) n[list] = [];
    else if (!n[list].length) return { error: 'invalid_' + list };
  }
  return { answers: n };
}

function exposure(n, type) {
  const all = [n.incorp, ...n.operations, ...n.incoming, ...n.outgoing];
  return [...new Set(all.filter((id) => REGULATED_COUNTRIES[type].has(id)))].sort();
}

// Country-specific questions still to be answered (v0.9 required these).
function pendingFollowUps(n) {
  return SPECIAL.filter((t) => exposure(n, t).length && !n[t]).map((t) => ({ type: t, countries: exposure(n, t) }));
}

// Ported unchanged from v0.9 determine() + reviewOnHold().
function determine(n) {
  const stopped = [], review = [];
  const activitySet = new Set(n.activities);
  if (n.activityMode === 'yes') {
    for (const a of ACTIVITIES) if (activitySet.has(a.id)) {
      if (a.risk === 'restricted') stopped.push('Restricted activity ' + a.id + ' — ' + a.name);
      else review.push('High-risk business ' + a.id + ' — ' + a.name);
    }
  }
  if (n.activityMode === 'unsure') review.push('Activity category not confirmed');
  const links = [['Incorporation', [n.incorp]], ['Operations', n.operations], ['UBO nationality', n.owners], ['Incoming payments', n.incoming], ['Outgoing payments', n.outgoing]];
  for (const [label, arr] of links) for (const code of arr) {
    if (RESTRICTED_COUNTRIES.has(code)) review.push('Restricted jurisdiction connection: ' + code + ' (' + label + ')');
    else if (HIGH_COUNTRIES.has(code)) review.push('High-risk jurisdiction: ' + code + ' (' + label + ')');
  }
  const all = new Set([n.incorp, ...n.operations, ...n.incoming, ...n.outgoing]);
  const hits = (t) => [...REGULATED_COUNTRIES[t]].some((x) => all.has(x));
  if (n.government === 'yes' && hits('government')) review.push('Specific jurisdiction restriction: government dealings');
  if (n.precious === 'yes' && hits('precious')) review.push('Specific jurisdiction restriction: precious stones/metals');
  if (n.oilgas === 'yes' && hits('oilgas')) review.push('Specific jurisdiction restriction: oil/gas');
  if ((n.government === 'unsure' && hits('government')) || (n.precious === 'unsure' && hits('precious')) || (n.oilgas === 'unsure' && hits('oilgas'))) review.push('Country-specific activity uncertain');
  if (n.opsMode === 'unsure' || n.ownerUnknown || n.incomingUnknown || n.outgoingUnknown) review.push('One or more geographic answers unknown');
  if (n.sector === 'other') review.push('Business sector is Other / unclassified');
  const risky = n.sector === 'financial' || n.sector === 'nonprofit';
  if (risky && !n.activities.some((id) => (SECTOR_PRIORITY[n.sector] || []).includes(id))) review.push('Sector requires activity confirmation: ' + n.sector);
  if (n.sector === 'nonprofit' && n.incorp && n.incorp !== 'MU' && !activitySet.has('R11')) review.push('Foreign charity / non-profit classification requires confirmation');
  const kind = stopped.length ? 'unable' : review.length ? 'review' : 'match';
  return { kind, reasons: [...stopped, ...review] };
}

const HOLD_PREFIXES = ['Restricted jurisdiction connection:', 'Specific jurisdiction restriction:', 'Country-specific activity uncertain', 'Activity category not confirmed', 'One or more geographic answers unknown', 'Business sector is Other / unclassified', 'Sector requires activity confirmation:', 'Foreign charity / non-profit classification requires confirmation'];

function routeFor(r) {
  if (r.kind === 'match') return 'standard';
  if (r.kind === 'unable') return 'hold';
  return r.reasons.some((x) => HOLD_PREFIXES.some((p) => x.startsWith(p))) ? 'hold' : 'continue_review';
}

// Public entry point. Returns { error } | { followUps } | { route, internal }.
// `internal` (reasons, v0.9 kind) is for ARIE staff emails only — never send it to the browser.
function evaluate(raw) {
  const v = normalise(raw);
  if (v.error) return { error: v.error };
  const followUps = pendingFollowUps(v.answers);
  if (followUps.length) return { followUps, answers: v.answers };
  const r = determine(v.answers);
  return { route: routeFor(r), answers: v.answers, internal: { kind: r.kind, reasons: r.reasons, policy: POLICY_VERSION, rules: RULES_VERSION } };
}

module.exports = { evaluate, ACTIVITY_BY_ID, POLICY_VERSION, RULES_VERSION };
