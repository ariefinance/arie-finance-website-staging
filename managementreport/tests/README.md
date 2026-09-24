# Management Report — Phase A Regression Suite

This directory contains **regression protection** for the ARIE Management Report tool.
It is created and maintained under the approved Phase A UX Simplification specification.

**No real ARIE financial, client or reporting data is stored here.**
Fixtures are 100% synthetic and machine-generated. See §Confidentiality below.

---

## What this suite proves

After running `npm install` in this directory, the regression harness:

1. Generates the synthetic fixture pack (Acme Holdings Ltd, September 2026,
   Xero-shaped P&L with newest-first months, matching Transaction Summary and
   Balance Sheet, and a valid August 2026 Previous Month File with six months of
   published history).
2. Runs the current unmodified Management Report parser code against those
   fixtures and asserts the parser output (`node harness/parser-check.js`).
3. Launches Chromium under a pinned regression environment (viewport, DPR,
   colour profile, motion, locally hosted per-weight WOFF2 fonts) and drives the
   current unmodified tool through the full monthly flow: import Previous Month
   File → drop P&L + Transaction Summary → programmatically supply the manual
   fields needed for `readiness()` to reach zero blockers → trigger
   `finalizeReport()` → extract the 11 rendered report pages, the PDF, the PPTX
   and the continuation `.data`.
4. Persists a **normalised business snapshot** (see `snapshot/SCHEMA.md`) plus
   `pages/page-01.jpg … page-11.jpg` into `baseline/`.
5. On `--compare`, re-runs the full flow and asserts each of the 11 rendered
   pages is byte-identical to the baseline and every business field matches
   (PDF/PPTX byte metadata explicitly excluded — see the schema).

Determinism has been demonstrated: three back-to-back `--compare` runs against
a freshly captured baseline all pass with pixel-identical page renders and
identical business snapshots.

---

## Layout

    tests/
    ├── README.md              this file
    ├── GATE1_REPORT.md        Gate 1 execution evidence + verdict
    ├── env/
    │   └── ENVIRONMENT.md     pinned regression environment specification
    ├── snapshot/
    │   └── SCHEMA.md          normalised business snapshot definition
    ├── fixtures/
    │   ├── build-fixtures.js  Node script — generates the synthetic pack
    │   ├── synthetic-pl.xlsx                    Xero-shaped P&L, Sep..Jan
    │   ├── synthetic-txn.xlsx                   Transaction Summary
    │   ├── synthetic-bs.xlsx                    Balance Sheet
    │   ├── synthetic-previous.data              August 2026 (valid, adjacent)
    │   ├── synthetic-previous-jul-nonadjacent.data   July 2026 (negative fixture)
    │   └── expected.json      values the parser-check asserts against
    ├── harness/
    │   ├── parsers.js         extracts the tool's parser <script> section
    │   ├── parser-check.js    asserts parser output against synthetic pack
    │   └── render-baseline.js Playwright end-to-end capture / compare
    ├── baseline/
    │   ├── snapshot.json      normalised business snapshot
    │   ├── manifest.json      capture environment info
    │   └── pages/             page-01.jpg … page-11.jpg (11 rendered pages)
    └── package.json           regression-only devDeps; NOT part of production

---

## Running the suite

    cd managementreport/tests
    npm install                # installs Playwright, fontsource, SheetJS is vendored
    npm run build-fixtures     # (re)generates the synthetic pack
    npm run parser-check       # asserts parser output against synthetic pack
    npm run baseline           # captures baseline (--capture)
    npm run regress            # runs full flow and compares against baseline

Each script exits non-zero on failure.

---

## What passes today

- **parser-check**: all assertions pass. `detectKind`, `parsePL`, `parseBS`,
  `parseTxnSummary`, continuation `.data` structure + djb2 checksum.
- **baseline**: `readiness()` reaches 0 blockers on the synthetic pack, tool
  finalises, produces an 11-page PDF and an 11-slide PPTX, writes 11 page
  JPEGs plus the business snapshot.
- **regress**: three consecutive runs pass — 11 rendered page images identical,
  business snapshot identical, PDF/PPTX structural counts match, continuation
  file shape (formatId, schemaVersion, reportingMonth, histMonths) matches.

---

## Deployment gate

Production deployment of Phase A UX changes is prohibited unless BOTH:

- **Repo regression** (`npm run parser-check` + `npm run regress` in this
  directory) passes on the change branch; and
- **External August 2026 regression** run outside this repository against the
  secure approved August pack produces a business snapshot identical to the
  pre-Phase-A build's snapshot for that same pack, and the 11 rendered pages
  are pixel-identical.

The external August pack **must NOT** be committed to this repository. It is
held in a secure Finance-controlled location and run by an authorised operator
against the tagged Phase A build before deploy.

---

## Confidentiality

Nothing in this directory contains, references, mirrors, hashes or otherwise
encodes any real ARIE financial value, client name, commentary, or period.
`build-fixtures.js` is the single source of truth for what appears in the
fixture files and its constants are all fabricated (Acme Holdings Ltd,
`intlPct: 66`, three named jurisdictions, two industries, round-number line
items). If real data is ever committed here by mistake, it must be removed
immediately with a force-push and the affected pack rotated externally.

---

## Not included in Phase A regression

- Currency-mismatch detection tests (Phase A rule; will be added when the
  production tool implements the check).
- Auto-seed "only if hist[month] absent" tests (Phase A rule; same).
- `.msg` client-report parsing.
- Route-level auth changes.
- Any change to production financial formulas.

These tests will be added alongside the corresponding Phase A implementation
in Gate 2, not now.
