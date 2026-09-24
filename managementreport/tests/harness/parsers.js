/*
 * Parser mirror — must stay in exact sync with managementreport/index.html.
 *
 * This module extracts the pure, DOM-independent parser functions from the
 * production Management Report and re-exports them for Node-based regression
 * testing. On every parser change in production, update this file to match
 * and rerun `npm run parser-check`.
 *
 * The extraction is done at load time by reading the production HTML, slicing
 * out the parser sections, and running them in an isolated vm context that
 * provides XLSX (from the vendored build) and the small MON/MONL constants.
 *
 * The alternative — copying the parser bodies verbatim into JavaScript here —
 * would drift. This approach ensures the test *always* exercises the
 * production parser source; if that source changes and starts requiring a
 * new global, the test fails loudly rather than silently drifting.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..');
const HTML = path.join(REPO, 'index.html');
const XLSX = require(path.resolve(REPO, 'vendor', 'xlsx.full.min.js'));

// Sections of production script we want to run in isolation. Each block is a
// span of consecutive functions/constants inside the single <script> tag.
// Anchors are matched by regex on the raw HTML source; on any drift the
// extractor throws with a specific reason.
const NEEDED = [
  {
    from: /\/\* ={5,} helpers ={5,} \*\//,
    // Stop just BEFORE the "toast" function which touches DOM.
    to:   /let toastT;/,
  },
  {
    from: /\/\* ={5,} Excel parsing ={5,} \*\//,
    to:   /\/\* ={5,} mapping & computation ={5,} \*\//,
  },
];

function extractSections(src) {
  const scriptStart = src.indexOf('<script>', src.indexOf('/* ===== helpers'));
  // Find the LAST <script> tag before the parsers appear — the parsers live
  // inside a single monolithic script.
  const marker = src.indexOf('/* ================= helpers ================= */');
  if (marker < 0) throw new Error('helpers marker not found in production HTML');
  const scriptOpen = src.lastIndexOf('<script>', marker);
  const scriptClose = src.indexOf('</script>', marker);
  if (scriptOpen < 0 || scriptClose < 0) throw new Error('could not locate parser <script> block');
  const block = src.slice(scriptOpen + '<script>'.length, scriptClose);

  const out = [];
  for (const { from, to } of NEEDED) {
    const a = block.search(from);
    if (a < 0) throw new Error('parser section not found in production HTML: ' + from);
    const b = block.slice(a).search(to);
    if (b < 0) throw new Error('parser section end not found in production HTML: ' + to);
    out.push(block.slice(a, a + b));
  }
  return out.join('\n');
}

const monConst = `const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONL=['January','February','March','April','May','June','July','August','September','October','November','December'];`;

const sandbox = {
  XLSX,
  console,
  Math,
  Date,
  Number,
  String,
  Array,
  Object,
  JSON,
  isFinite,
  isNaN,
  parseFloat,
  parseInt,
  RegExp,
  // The tool uses $ inside the toast helper, but our extraction cuts off before
  // it. Any accidental use elsewhere will throw and surface immediately.
  document: undefined,
};

const src = fs.readFileSync(HTML, 'utf8');
const code = monConst + '\n' + extractSections(src) + '\n' +
  // Explicit exports of the pure parser surface we want in Node.
  `module.exports = { detectKind, parsePL, parseBS, parseTxnSummary, sheetRows,
                       parseMonthLabel, monthIdx, keyOf, num, isNum };`;

const ctx = vm.createContext({ ...sandbox, module: { exports: {} } });
vm.runInContext(code, ctx, { filename: '<extracted parsers.js>' });

module.exports = ctx.module.exports;
