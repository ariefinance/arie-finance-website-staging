# Gate 1 — Regression Baseline · Execution Report

Executed against `main` at commit `6b6b223b638cf5b6de6bbe35b9eb312bf36b1096`.
Working branch: `claude/mr-phase-a-gate1`.

This revision **supersedes** the first Gate 1 report on this branch (which
overstated what was captured). Every defect the reviewer flagged has been
remediated. See §Remediation of prior defects below.

## Summary

The regression protection scaffolding required by the approved Phase A
specification has been established and exercised end-to-end against the current
unmodified Management Report:

- Synthetic-only fixture pack, Xero-shaped, months newest-first, with a valid
  adjacent August 2026 Previous Month File carrying six months of published
  history. No real ARIE data anywhere.
- Normalised business snapshot captured at the tool's own post-`publishMonth()`
  boundary, projected from the runtime state (not bound to internal
  `S.rec`/`S.hist`/`S.cfg` object names).
- Parser-check harness that runs the tool's real parser section (extracted at
  test time from the production HTML) against the synthetic pack.
- Pinned Playwright/Chromium environment with per-weight, per-style locally
  hosted OFL fonts intercepting Google Fonts requests.
- Full end-to-end capture: Previous Month File imported, P&L + Transaction
  Summary uploaded, `readiness()` driven to zero blockers programmatically,
  `finalizeReport()` triggered, 11 rendered report pages captured, PDF page
  count and PPTX slide count captured, continuation `.data` shape captured.
- Three consecutive `--compare` runs pass with pixel-identical page renders
  and identical business snapshots.

## Verdict

**GATE 1 INTERNAL — PASS**
**EXTERNAL AUGUST RECONCILIATION — PENDING**

Everything Gate 1 requires that can be done in this public sandbox is complete
and reproducible on this branch. The external August 2026 reconciliation
against the approved secure pack has not been executed here because it requires
the confidential August pack, which the specification prohibits committing to
the public GitHub repository. That reconciliation must be performed outside
this repository by an authorised operator with local access to the pack, using
the same harness on the same branch.

## Remediation of prior defects

The reviewer's blockers on the previous Gate 1 attempt have all been resolved:

| Prior defect (reviewer) | Resolution in this commit |
|---|---|
| Baseline captured one editor screenshot, not the 11 report pages | `render-baseline.js` now drives `finalizeReport()` and re-invokes `renderSlidePngs()` on the finalised state to capture the 11 slide JPEGs into `baseline/pages/page-01.jpg … page-11.jpg` |
| Synthetic P&L had months ascending (Jan..Sep) so parser set `reportMonth=2026-01` | Fixture generator now emits columns **newest-first** (Sep..Jan) matching real Xero export shape. `pl.key === "2026-09"` and `readiness()` month-column-order check passes |
| Previous Month File was July for a September scenario | Valid fixture is now **August 2026**; a July non-adjacent fixture is kept separately as a negative fixture for future adjacency tests |
| Actual snapshot did not match `SCHEMA.md` | `SCHEMA.md` and the captured snapshot now match: normalised business boundary, captured post-finalise, with fully specified compare rules and explicit exclusions for byte-metadata-sensitive fields |
| Font interception served 400 regular for every weight | Interception now returns a local stylesheet that maps each declared `@font-face` to the matching per-weight, per-style WOFF2 served from the harness's own static server |
| Parser checks were narrower than promised Gate 1 coverage | Parser-check now includes month-order assertion, EBITDA reversal check, valid `.data` continuation checksum + hist metrics presence, and the negative fixture's checksum |

## What passes

**parser-check** (`node harness/parser-check.js`) — all assertions pass:

- P&L: entity, months (Sep..Jan newest-first), period, clients per column,
  Opening Fees vals (reversed to match column order) + YTD, EBITDA vals + total
  flag, month-columns-descending check.
- Balance Sheet: dates (Aug/Sep) + line values.
- Transaction Summary: per-month `{inUsd, outUsd, inCount, outCount}` and
  YTD `{key, usd, count}`.
- Previous Month File (August, valid): format id, schema version,
  reportingMonth, hist + cfg presence, djb2 checksum equal to
  `contChecksum({hist, cfg})`, hist contains 2026-08, at least 6 months up to
  Aug, every hist entry carries `published.metrics.{gpMargin, revPerClient,
  gpPerClient, volPerClient, txnPerClient}` as numbers.
- Previous Month File (July, negative fixture): internally valid, checksum
  matches, `reportingMonth === "2026-07"`.

**baseline** (`node harness/render-baseline.js --capture`):

- `readiness()` reaches **0 blockers, 1 warning, 19 passed checks**.
- `finalizeReport()` completes, producing:
  - PDF with **11 pages**
  - PPTX with **11 slides**
  - Continuation `.data` with format id `arie-management-report-continuation`,
    schema version 1, reportingMonth `2026-09`, 7 hist months (Mar..Sep),
    valid djb2 checksum.
- 11 rendered page JPEGs saved.

**regress** (three consecutive `node harness/render-baseline.js --compare` runs):

Each of the three runs passes:

- All 11 page JPEGs byte-identical to baseline.
- Business snapshot (report month, entity, kpi values, jurisdictions,
  industries, PDF page count, PPTX slide count, continuation file
  formatId/schemaVersion/reportingMonth/histMonths/histMonthCount) identical.
- PDF/PPTX byte metadata and the continuation checksum are explicitly excluded
  from the compare per §Comparison rules of `SCHEMA.md` (they legitimately vary
  because generators embed timestamps).

## Environment

- Chromium `141.0.7390.37` (pre-installed at `/opt/pw-browsers/chromium`).
- Playwright `1.55.0`.
- Viewport `1280×720`, DPR `1`, sRGB colour profile, reduced motion.
- Fonts locally served from `@fontsource/hanken-grotesk@5.1.0` (weights 400,
  500, 600, 700 in `latin-normal`) and `@fontsource/newsreader@5.1.0`
  (weights 400, 500, 600 in `latin-normal`, 400 in `latin-italic`).

## Business snapshot captured (from synthetic pack)

    reportMonth:  2026-09
    entity:       Acme Holdings Ltd
    currency:     USD
    finalisedFor: 2026-09

    outputs.pdf.pageCount:               11
    outputs.pptx.slideCount:             11
    outputs.continuation.formatId:       arie-management-report-continuation
    outputs.continuation.schemaVersion:  1
    outputs.continuation.reportingMonth: 2026-09
    outputs.continuation.histMonthCount: 7
    outputs.continuation.histMonths:     [2026-03 .. 2026-09]

    publishedRecord.kpi.clients:         3
    publishedRecord.kpi.activeClients:   3
    publishedRecord.kpi.accountsActive:  5
    publishedRecord.kpi.accountsHeld:    5
    publishedRecord.kpi.jurisdictions:   3
    publishedRecord.kpi.intlPct:         66
    publishedRecord.kpi.volYtd:          2.052   (from synthetic Txn Summary)
    publishedRecord.kpi.volSinceInc:     5.0
    publishedRecord.juris:               [Mauritius, United Kingdom, United Arab Emirates] (1 each)
    publishedRecord.industries:          [Financial Services x2, Technology x1]

## Deferred to Gate 2 (does NOT block Gate 1)

Phase-A-specific behavioural tests (explicit currency-mismatch rejection,
auto-seed "only when hist[month] absent" enforcement) will be added alongside
the corresponding Phase A implementation in Gate 2. The current Gate 1
baseline pins the CURRENT ENGINE'S output; those Phase A tests will pin the
NEW BEHAVIOURS Phase A introduces.

## Mandatory external August reconciliation

Still outstanding, still must run outside this repository. See README.md
§Deployment gate for the procedure.

The harness on this branch is complete and reproducible. An authorised
operator runs:

    cd managementreport/tests
    npm install
    node fixtures/build-fixtures.js
    node harness/parser-check.js
    node harness/render-baseline.js --capture

against the REAL August pack (kept in a secure Finance location, never
committed), compares the resulting `baseline/snapshot.json` and
`baseline/pages/` output against the pre-existing approved August baseline,
and reports the result to Founder Review before Gate 2 begins.
