# Gate 1 — Regression Baseline · Execution Report

Executed against `main` at commit `6b6b223b638cf5b6de6bbe35b9eb312bf36b1096`.
Working branch: `claude/mr-phase-a-gate1`.

This revision **supersedes** the two earlier Gate 1 reports on this branch.
Every defect from both review rounds is remediated. See §Remediation of
prior defects below.

## Summary

The regression protection scaffolding required by the approved Phase A
specification is established and exercised end-to-end against the current
unmodified Management Report:

- Synthetic-only fixture pack, Xero-shaped, months newest-first, with a
  valid adjacent August 2026 Previous Month File carrying six months of
  published history (each with `published.fig` so the September run's
  comparative basis is `reported`, and readiness reports zero warnings).
- Normalised business snapshot at the report's business boundary,
  projected from `compute()` + `S.hist` + `S.rec` — full financial
  breakdown (14 categories × 3 periods), KPIs, transactions + six-month
  series, unit economics + six-month series, distributions, commentary
  state per section, adjustments, overrides, comparative mode,
  confirmations, and rendered page structure.
- Parser-check harness that runs the tool's real parser section against
  the synthetic pack.
- Pinned Playwright/Chromium environment with per-weight, per-style
  locally hosted OFL fonts intercepting Google Fonts requests.
- End-to-end capture wraps `renderSlidePngs()` **before** finalisation so
  the 11 page images captured are the same 11 images
  `finalizeReport()` feeds into the PDF and PPTX builders — not a second
  render.
- Real external-mode CLI that accepts caller-supplied files from paths
  outside the repository and refuses to write anywhere inside the
  repository.

Three consecutive `--compare` runs against a freshly captured baseline
all pass with pixel-identical page renders, identical expanded business
snapshots, and matched readiness signature.

## Verdict

**GATE 1 INTERNAL — PASS**
**EXTERNAL AUGUST RECONCILIATION — READY TO RUN**

Everything Gate 1 requires that can be done in this public sandbox is
complete and reproducible on this branch. The external August 2026
reconciliation against the approved secure pack is now genuinely
executable via the `--external` command below.

## Remediation of prior defects

| Prior defect (reviewer) | Resolution in this commit |
|---|---|
| **Business snapshot too small** — only KPI/juris/industries/status/output counts | Expanded snapshot captures full financials (14 categories × current/YTD/comparative), KPIs, transaction current + 6-month series, unit economics current + 6-month series, distributions with totals, commentary per section (`noUpdate`/`review`/text`), adjustments, overrides, `compMode`, confirmations, and report page structure (slide titles). Snapshot size grew from ~800 bytes to ~8 KB. |
| **External August procedure did not actually work** — harness was hard-coded to synthetic paths | Real `--external` mode: `--pl <path> --txn <path> --previous <path> --input-config <path> --output <dir>`. Refuses `--output` inside the repository. Accepts arbitrary absolute paths for inputs. Config file may be `.json` (for real operators) or `.js` (for the synthetic pack). No external inputs or outputs are ever committed. |
| **Baseline images were a second render, not the images finalisation used** | `renderSlidePngs()` is wrapped **before** clicking `#btnPdf`. The FIRST render (the one `finalizeReport()` itself feeds into the PDF and PPTX builders) is stored into `window.__regressionFinalImages` and extracted after `finalSnapshot` exists. `snapshot.json` records `imageSource: "intercepted from finalizeReport() before PDF/PPTX build"`. |
| **Warning was tolerated without identifying it** | `EXPECTED_READINESS_SIGNATURE` records the exact 0/0/20 label sets and the harness fails if the sets differ. Adding `published.fig` to synthetic hist entries eliminated the "no saved report for prior month" warning — comparative basis is now `reported`, matching a real ARIE month. |
| **Test-only `S.hist[S.key] = clone(S.rec)` shortcut** | Removed from `FILL_STATE_FN`. The tool's own `saveNow()` (called at the start of `finalizeReport()`) writes the current record into history — the harness now follows the real operator transition faithfully. |

## Environment

- Chromium `141.0.7390.37` (pre-installed at `/opt/pw-browsers/chromium`).
- Playwright `1.55.0`.
- Viewport `1280×720`, DPR `1`, sRGB colour profile, reduced motion.
- Fonts locally served from `@fontsource/hanken-grotesk@5.1.0` (weights
  400/500/600/700, latin-normal) and `@fontsource/newsreader@5.1.0`
  (weights 400/500/600 latin-normal, 400 latin-italic).

## What passes

**parser-check** (`node harness/parser-check.js`) — all assertions pass.

**baseline** (`node harness/render-baseline.js --capture`):

    readiness signature MATCHED: 0/0/20 (blockers/warnings/pass)
    pdf pages: 11 pptx slides: 11 page pngs: 11

**regress** (three consecutive `--compare` runs) — each run passes:

    readiness signature MATCHED: 0/0/20
    COMPARE PASS: 11 pages byte-identical, expanded business snapshot
                  identical, PDF/PPTX structural match

**external mode** (verified against the synthetic pack, `--output` in an
external scratch directory):

    node harness/render-baseline.js --external \
      --pl <abs .xlsx> --txn <abs .xlsx> --previous <abs .data> \
      --input-config <abs .json|.js> --output <dir OUTSIDE repo>
    → readiness (external): 0 blockers, 0 warnings, 20 passed
    → pdf pages: 11 pptx slides: 11 page pngs: 11
    → snapshot.json + pages/ written to the external output directory only

Attempting `--output` inside the repository fails immediately with a
clear error before Chromium even launches.

## Business snapshot captured (synthetic pack)

    reportMonth:  2026-09
    entity:       Acme Holdings Ltd
    currency:     USD
    finalisedFor: 2026-09

    financials.current.rev:    4100      ytd.rev:    24300  comparative.rev:    3100
    financials.current.opex:   1500      ytd.opex:   13500  comparative.opex:   1500
    financials.current.ebitda: 2600      ytd.ebitda: 10800  comparative.ebitda: 1600
    financials.current.gp:     4100      ytd.gp:     24300  comparative.gp:     3100
    financials.comparativeBasis: "reported"   comparativeMonth: 2026-08

    kpi: clients=3 active=3 accountsActive=5 accountsHeld=5
         jurisdictions=3 intlPct=66 avgRevPerClient=900

    transactions.current: inUsd=140000 outUsd=126000
                          inCount=18   outCount=17
                          volMonth=0.27 volYtd=2.05 volSinceInc=5

    unitEconomics.current.gpMargin: 1
    unitEconomics.sixMonth: 6 rows Apr..Sep

    distributions.juris: [Mauritius=1, UK=1, UAE=1]  jurTot=3
    distributions.industries: [Financial Services=2, Technology=1] indTot=3

    commentary: all 5 blocks noUpdate=true review=true text=""

    reportStructure.slideCount: 11
    reportStructure.pages: 11 titled entries

    outputs.pdf.pageCount: 11
    outputs.pptx.slideCount: 11
    outputs.continuation.formatId: arie-management-report-continuation
    outputs.continuation.reportingMonth: 2026-09
    outputs.continuation.histMonths: [2026-03..2026-09] (7 entries)

## External August command

An authorised operator with local access to the secure August pack runs
the following from a checkout of the branch at
`79af41d…` (or later Gate 1 commit):

    cd managementreport/tests
    npm install
    node fixtures/build-fixtures.js      # only if repo synthetic pack needs regenerating
    node harness/render-baseline.js --external \
      --pl       /secure/local/path/ARIE_August_2026_PL.xlsx \
      --txn      /secure/local/path/ARIE_August_2026_Transactions.xlsx \
      --previous /secure/local/path/ARIE_July_2026.data \
      --input-config /secure/local/path/august-fill.json \
      --output   /secure/local/output/august-regression

Where `august-fill.json` is an operator-authored JSON file (never
committed) with the same shape as `harness/synthetic-input.js`, carrying
the manual denominator, jurisdictions, industries and commentary state
for August. The harness will:

- refuse to run if `--output` resolves inside the repository;
- read the real files from their external paths only;
- write `snapshot.json`, `manifest.json`, and `pages/page-01.jpg …
  page-11.jpg` **only** into the external output directory;
- copy no confidential inputs or outputs into the repository.

The operator compares the resulting snapshot + page images against the
pre-existing approved August baseline held in Finance and reports the
result to Founder Review before Gate 2 begins.
