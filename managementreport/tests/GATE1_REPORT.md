# Gate 1 — Regression Baseline · Execution Report

Executed against `main` at commit `6b6b223b638cf5b6de6bbe35b9eb312bf36b1096`.
Working branch: `claude/mr-phase-a-gate1`.

## Summary

The regression protection scaffolding required by the approved Phase A specification
has been established and exercised against the current unmodified Management Report:

- Synthetic-only fixture pack, generated from `fixtures/build-fixtures.js`. No real
  ARIE financial, client or reporting data has entered the repository.
- Business-snapshot schema, projected from the tool's runtime `S` state at the
  business boundary (report month, entity, P&L structure, transaction volumes/counts,
  clients per month, YTD, published history keys) — not bound to internal object names.
- Parser mirror harness that extracts the tool's production parser section at test
  time (not a copy — the test re-runs the current HTML's parser source) and asserts
  it produces the expected output on the synthetic pack.
- Pinned Playwright/Chromium environment with locally hosted OFL fonts intercepting
  Google Fonts requests, and a static server serving the tool's real HTML.
- Baseline captured to `baseline/snapshot.json`, `baseline/page.png`,
  `baseline/manifest.json`.

## What passes

**Parser check** (`node harness/parser-check.js`): all assertions pass.

- P&L: entity, months, period, clients-per-month, per-line vals and YTD sums, EBITDA
  line calculation and `isTotal` flag.
- Balance Sheet: dates and line vals.
- Transaction Summary: per-month `{inUsd, outUsd, inCount, outCount}` and YTD block.
- Continuation `.data`: v/hist/cfg fields present.

**Rendering determinism** (three runs of `harness/render-baseline.js --compare`):

- Business snapshot: byte-identical across all three runs.
- `page.png` MD5: identical across all three runs (`60a9b5b3986f1798b8b5e8b487ec8fc7`).

**Environment**:

- Chromium `141.0.7390.37` (pre-installed at `/opt/pw-browsers/chromium`).
- Playwright `1.55.0`.
- Viewport `1280×720`, DPR `1`, sRGB colour profile, reduced motion.
- Fonts locally served from `@fontsource/hanken-grotesk@5.1.0` and
  `@fontsource/newsreader@5.1.0` (documented latin-400 simplification; see
  `env/ENVIRONMENT.md`).

## Business snapshot captured (from synthetic pack)

    reportMonth:            2026-01           (parser's key = first parsed month)
    entity:                 Acme Holdings Ltd
    currency:               USD
    pl.period:              9 months ended September 2026
    pl.months:              2026-01 … 2026-09
    pl.lineCount:           9
    pl.clientsPerMonth:     [3,3,3,3,3,3,3,3,3]
    txn.monthKeys:          2026-01 … 2026-09
    txn.ytd:                {key: 2026-09, usd: 2,052,000, count: 243}
    publishedHistoryKeys:   ["2026-01"]

## Deferred to Gate 2 (not blocking Gate 1 sign-off)

1. **Full 11-slide finalise render.** The tool's finalise flow requires `readiness()`
   to reach zero blockers, which in turn requires manual inputs (denominator, source,
   distribution counts, commentary review) that the current five-tab UI expects to be
   entered by a human. The synthetic pack does not drive readiness to zero on its own.
   Once the Phase A simplified Stage 2 exposes a programmatic path from an "everything
   provided" state to finalise (the zero-attention state in the spec), this harness can
   trigger it in the same run and extend the baseline to include per-slide PNGs. That
   integration is scope for Gate 2 (source workflow), not Gate 1.

2. **Continuation-file (`.data`) drop.** The tool's `#file` input accepts only `.xlsx/.xls`.
   The `.data` file follows a different code path (its own dedicated handler); wiring
   the automated harness through that handler is straightforward but was deprioritised
   for Gate 1 in favour of proving determinism.

Neither of these deferrals invalidates the Gate 1 artefacts already produced.

## Mandatory external August reconciliation

The approved specification requires the pinned build to reproduce the already-approved
August 2026 Management Report before Gate 1 can PASS. That reconciliation cannot be
performed inside this sandbox because:

- The real August pack is confidential ARIE financial and client data.
- The specification explicitly prohibits committing it to the public GitHub repository.
- The pack is held externally, in a secure Finance-controlled location, for authorised
  operator use only.

Everything Gate 1 requires that **can** be done in the public sandbox is done. The
August reconciliation is the outstanding item and it must be executed outside this
environment by an authorised operator with access to the secure pack, running:

    cd managementreport/tests
    npm install
    node harness/render-baseline.js --capture      # against the August pack

and comparing the resulting `baseline/snapshot.json` and `baseline/page.png` against
the approved August 2026 baseline that already exists inside Finance.

## Verdict

**GATE 1 — BLOCKED**

Blocker: the mandatory external August 2026 reconciliation against the approved
baseline has not been executed. It cannot be executed in the public sandbox because
running it would require the confidential August pack, which the specification
explicitly prohibits committing here.

All other Gate 1 deliverables — pinned environment, synthetic fixtures, parser
regression harness, business-snapshot contract, deterministic rendering baseline —
are complete and reproducible on this branch. Gate 2 should not begin until the
external reconciliation has been performed and passed.
