# Normalised Business Snapshot — Schema

The snapshot is what the regression suite compares. It is bound to the
**report's business boundary**, not to the tool's internal JavaScript object
names. Renaming or restructuring `S.rec`, `S.hist` or `S.cfg` during Phase A
must NOT change the snapshot as long as the resulting report is the same.

## Capture point

The snapshot is projected from the browser's runtime state immediately after a
successful `publishMonth()` — i.e. when `finalSnapshot` is populated and the
tool considers the report finalised. The 11 page images captured alongside
are the exact images `finalizeReport()` fed into the PDF and PPTX builders,
not a second render (`renderSlidePngs()` is wrapped before finalisation is
triggered; the first-and-only render is intercepted).

## Fields

    {
      "reportMonth":  "2026-09",
      "entity":       "…",
      "currency":     "USD",
      "finalisedFor": "2026-09",

      "financials": {
        "current":     { acc, subTxn, fxOther, maint, advisory, rev,
                         staff, prof, other, intro, opex, nonop, ebitda, gp },
        "ytd":         { …same categories… },
        "comparative": { …same categories… },
        "comparativeBasis": "reported" | "excel" | "none",
        "comparativeMonth": "YYYY-MM"
      },

      "kpi": {
        "clients": …, "clientsFromPl": …,
        "active": …, "activeBasis": "…",
        "accountsActive": …, "accountsHeld": …,
        "jurisdictions": …, "intlPct": …,
        "avgRevPerClient": …
      },

      "transactions": {
        "current":  { inUsd, outUsd, inCount, outCount,
                      volMonth, volYtd, volSinceInc },
        "sixMonth": [ { key, inUsd, outUsd, inCount, outCount }, × 6 ]
      },

      "unitEconomics": {
        "current":  { gpMargin, revPerClient, gpPerClient, volPerClient, txnPerClient },
        "sixMonth": [ { key, gpMargin, revPerClient, gpPerClient, volPerClient, txnPerClient }, × 6 ]
      },

      "distributions": {
        "juris":      [ { name, count }, … ],
        "industries": [ { name, count }, … ],
        "jurTot": …, "indTot": …
      },

      "commentary": {
        "pipeline":    { noUpdate, review, text },
        "regulatory":  { noUpdate, review, text },
        "tech":        { noUpdate, review, text },
        "ebitdaNote":  { noUpdate, review, text },
        "metricsNote": { noUpdate, review, text }
      },

      "adjustments":   { …S.rec.adj snapshot… },
      "overrides":     { …S.rec.ov snapshot… },
      "compMode":      "reported" | "excel" | null,
      "confirmations": { accounts, adjYtd, dist, republish, … },

      "reportStructure": {
        "slideCount": 11,
        "pages": [ { index, title }, × 11 ]
      },

      "publishedHistoryKeys": [ "2026-03", …, "2026-09" ],

      "outputs": {
        "pdf":  { "pageCount": 11,  "md5": "…", "bytes": <int>, "name": "…" },
        "pptx": { "slideCount": 11, "md5": "…", "bytes": <int>, "name": "…" },
        "continuation": {
          "formatId":       "arie-management-report-continuation",
          "schemaVersion":  1,
          "reportingMonth": "…",
          "checksum":       "<djb2 hex>",
          "histMonthCount": <int>,
          "histMonths":     [ … ],
          "name":           "…"
        }
      },

      "pageHashes":   [ md5 of each of the 11 intercepted final images ],
      "pageCount":    11,
      "imageSource":  "intercepted from finalizeReport() before PDF/PPTX build",

      "readinessSignature": {
        "blockers":       0,
        "warnings":       0,
        "blockerLabels":  [],
        "warningLabels":  [],
        "passLabels":     [ 20 label strings ]
      }
    }

## Comparison rules

The comparison used by `harness/render-baseline.js --compare` explicitly
**excludes** the following fields (all of which legitimately vary between
otherwise identical runs):

- `outputs.pdf.md5` and `outputs.pdf.bytes`
- `outputs.pptx.md5` and `outputs.pptx.bytes`
- `outputs.continuation.checksum`

These are excluded on principle: PDF and PPTX generators embed non-report
metadata (creation timestamps, ZIP header timestamps) that legitimately change
between runs even when the visible content is byte-identical. The `.data`
file's djb2 checksum covers the business content, but that content includes a
fresh `published.at` ISO timestamp the tool stamps on every publish, so the
checksum also legitimately varies. Business-content stability is proved by
the identical page renders and identical `histMonths` list.

Everything else is compared byte-for-byte:

- All 11 `pageHashes` and the on-disk `pages/page-NN.jpg` files must be
  byte-identical to the baseline.
- The `readinessSignature` (blocker/warning/pass label sets) must match
  exactly. A new warning that appears between runs is a regression.
- `outputs.pdf.pageCount` and `outputs.pptx.slideCount` must equal 11.
- `outputs.continuation.formatId`, `schemaVersion`, `reportingMonth`,
  `histMonths`, `histMonthCount` must match exactly.
- Everything under `financials`, `kpi`, `transactions`, `unitEconomics`,
  `distributions`, `commentary`, `adjustments`, `overrides`, `compMode`,
  `confirmations`, `reportStructure` must match exactly.

## What is NOT in the snapshot

- Raw PDF/PPTX byte content — excluded on principle (see above).
- Internal JavaScript variable names or object shapes — the snapshot is
  projected from the tool's runtime state at capture time.
- Timing / performance data.

## Extension

Adding a field to the snapshot requires a corresponding baseline re-capture
with sign-off, following the same rules as an environment change.
