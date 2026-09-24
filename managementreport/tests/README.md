# Management Report — Phase A Regression Suite

This directory contains **regression protection** for the ARIE Management Report tool.
It is created and maintained under the approved Phase A UX Simplification specification.

**No real ARIE financial, client or reporting data is stored here.**
Fixtures are 100% synthetic and machine-generated. See §Confidentiality below.

---

## Purpose

Establish a machine-checkable regression contract that:

1. Verifies parsers still classify P&L / Balance Sheet / Transaction Summary workbooks correctly.
2. Verifies `readiness()` reports the same severity for the same inputs.
3. Verifies the tool produces a **byte-comparable normalised business snapshot**
   (report month, entity, line-level P&L, transaction volumes/counts, KPIs, headline figures,
   `hist[]` shape, published-history immutability) for a fixed synthetic input pack.
4. Verifies the 11 rendered report pages under a pinned browser environment
   produce a deterministic (or bounded-tolerance) image comparison.
5. Verifies the PDF has 11 pages and the PPTX has 11 landscape 16:9 slides.
6. Verifies the Next Month File (`.data`) serialises the expected published history / cfg shape
   and its djb2 checksum matches.

The suite is intentionally lean — it protects the calculations, structural output and
readiness surface, without duplicating the tool's own logic.

---

## Layout

    tests/
    ├── README.md              this file
    ├── env/
    │   └── ENVIRONMENT.md     pinned regression environment specification
    ├── snapshot/
    │   └── SCHEMA.md          normalised business snapshot definition
    ├── fixtures/
    │   ├── build-fixtures.js  Node script — generates synthetic .xlsx pack
    │   ├── synthetic-pl.xlsx           (generated)
    │   ├── synthetic-txn.xlsx          (generated)
    │   ├── synthetic-bs.xlsx           (generated)
    │   └── synthetic-previous.data     (generated)
    ├── harness/
    │   ├── parser-check.js    Node script — asserts parser outputs against synthetics
    │   ├── render-baseline.js Playwright script — captures 11 page renders (pinned env)
    │   ├── compare-render.js  Node script — image comparison against baseline
    │   └── snapshot-diff.js   Node script — normalised snapshot comparison
    ├── baseline/
    │   ├── snapshot.json      expected normalised business snapshot for synthetic pack
    │   ├── pages/             expected rendered page images
    │   └── manifest.json      what the baseline covers, when captured, environment info
    └── package.json           regression-only devDeps; NOT part of production

---

## What the fixtures represent

The synthetic pack represents a hypothetical September 2026 report for a made-up entity
"Acme Holdings Ltd" with a modest set of P&L lines, a Transaction Summary spanning May–September,
a supporting Balance Sheet, and a July 2026 Previous Month File.

Every value is deliberately non-realistic (round numbers, three clients, small volumes).
No inference to real ARIE data is possible from these files.

---

## Running the suite

    cd managementreport/tests
    npm install                # installs pinned regression deps (SheetJS, Playwright, pixelmatch, PNG)
    npm run build-fixtures     # regenerate synthetic .xlsx pack
    npm run parser-check       # asserts parser outputs match expected snapshot
    npm run baseline           # runs render-baseline.js under pinned env → writes baseline/
    npm run regress            # runs render + compares against baseline

Each script exits non-zero on failure.

---

## Deployment gate

Production deployment of Phase A UX changes is prohibited unless BOTH:

- **Repo regression** (`npm run regress` in this directory) passes; and
- **External August 2026 regression** run outside this repository against the secure
  approved August pack produces the same normalised business snapshot as the pre-Phase-A
  build and rendered-page comparison passes.

The external August regression pack **must NOT** be committed to this repository.
It is held in a secure Finance-controlled location and run by an authorised operator
against the tagged Phase A build before deploy.

---

## Confidentiality

Nothing in this directory contains, references, mirrors, hashes or otherwise encodes
any real ARIE financial value, client name, commentary, or period.
`build-fixtures.js` is the single source of truth for what appears in `fixtures/*.xlsx`
and its constants are all fabricated.
If any real data is ever committed here by mistake, it must be removed immediately with a
force-push, and the affected pack rotated externally.

---

## Not included in Phase A

- Currency detection heuristics beyond explicit declared currency mismatch.
- `.msg` client-report parsing.
- Route-level auth changes.
- Any change to production financial formulas.

Adding those without the approved spec being extended is out of scope.
