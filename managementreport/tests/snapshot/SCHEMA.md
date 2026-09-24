# Normalised Business Snapshot — Schema

The snapshot is what the regression suite compares. It is bound to the **report's
business boundary**, not to the tool's internal JavaScript object names. Renaming
or restructuring `S.rec`, `S.hist` or `S.cfg` during Phase A must NOT change the
snapshot as long as the resulting report is the same.

## Capture point

The snapshot is captured **immediately after a successful `publishMonth()`** — i.e.
when the tool has produced the finalised PDF blob, PPTX blob and continuation `.data`
blob, and set `finalSnapshot`. Every field below is derived from the just-published
state; nothing is captured before finalisation.

## Fields

    {
      "reportMonth":  "2026-09",
      "entity":       "Acme Holdings Ltd",
      "currency":     "USD",
      "finalisedFor": "2026-09",

      "outputs": {
        "pdf":  { "pageCount": 11, "md5": "…", "bytes": <int>,
                  "name": "ARIE_Finance_Management_Report_September_2026.pdf" },
        "pptx": { "slideCount": 11, "md5": "…", "bytes": <int>,
                  "name": "ARIE_Finance_Management_Report_September_2026.pptx" },
        "continuation": {
          "formatId":       "arie-management-report-continuation",
          "schemaVersion":  1,
          "reportingMonth": "2026-09",
          "checksum":       "<djb2 hex, 8 chars>",
          "histMonthCount": <int>,
          "histMonths":     ["2026-03", "2026-04", …, "2026-09"],
          "name":           "ARIE_Management_Report_September_2026.data"
        }
      },

      "pageHashes": ["<md5 of page 1 jpeg>", …, "<md5 of page 11 jpeg>"],
      "pageCount":  11,

      "publishedRecord": {
        "kpi": {
          "clients": …, "activeClients": …, "activeBasis": "…",
          "jurisdictions": …, "accountsActive": …, "accountsHeld": …,
          "intlPct": …, "volMonth": …, "volYtd": …, "volSinceInc": …
        },
        "juris":      [{"name": "…", "count": …}, …],
        "industries": [{"name": "…", "count": …}, …],
        "status":     "published",
        "published":  true
      }
    }

## Comparison rules

The comparison used by `harness/render-baseline.js --compare` explicitly
**excludes** the following fields:

- `outputs.pdf.md5` and `outputs.pdf.bytes`
- `outputs.pptx.md5` and `outputs.pptx.bytes`
- `outputs.continuation.checksum`

These are excluded on principle: PDF and PPTX generators embed non-report
metadata (creation timestamps, ZIP header timestamps) that legitimately change
between runs even when the visible content is byte-identical. The `.data` file's
djb2 checksum covers the business content, but that content includes a fresh
`published.at` ISO timestamp the tool stamps on every publish, so the checksum
also legitimately varies.

Everything else is compared byte-for-byte:

- All 11 `pageHashes` and the on-disk `pages/page-NN.jpg` files must be
  byte-identical to the baseline.
- `outputs.pdf.pageCount` and `outputs.pptx.slideCount` must equal 11.
- `outputs.continuation.formatId`, `schemaVersion`, `reportingMonth`,
  `histMonths`, `histMonthCount` must match exactly.
- `reportMonth`, `entity`, `currency`, `finalisedFor`, `pageCount`,
  `publishedRecord` (including `kpi`, `juris`, `industries`, `status`,
  `published`) must match exactly.

## What is NOT in the snapshot

- Raw PDF/PPTX byte content — excluded on principle (see above).
- Internal JavaScript variable names or object shapes — the snapshot is
  projected from the tool's runtime state at capture time.
- Timing / performance data.

## Extension

Adding a field to the snapshot requires a corresponding baseline re-capture with
sign-off, following the same rules as an environment change.
