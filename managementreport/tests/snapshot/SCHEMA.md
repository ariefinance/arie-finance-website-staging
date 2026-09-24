# Normalised Business Snapshot — Schema

The snapshot is what the regression suite compares. It is bound to the **report's business
boundary**, not to the tool's internal JavaScript object names. Renaming or restructuring
`S.rec`, `S.hist` or `S.cfg` during Phase A must NOT change the snapshot as long as the
resulting report is the same.

## Capture point

The snapshot is captured immediately after a successful `publishMonth()` — i.e. when the
final rendered pages have been produced and the tool considers the report finalised.

## Fields

The snapshot is a JSON object with the following top-level fields (all values pre-normalised
to their smallest business representation — e.g. figures rounded to whole dollars, dates as
ISO YYYY-MM):

    {
      "reportMonth":       "2026-09",
      "entity":            "Acme Holdings Ltd",
      "currency":          "USD",
      "generatedFrom":     {"tool_sha": "<git sha of index.html at capture>"},
      "pl": {
        "period":          {"n": 9, "endLabel": "September 2026"},
        "lines": [
          {"section": "Trading Income", "name": "…", "vals": [123, 456, …], "ytd": 789, "isTotal": false}
          …
        ],
        "clientsPerMonth": [3, 3, 3, 3, 3, 3, 3, 3, 3]
      },
      "txn": {
        "months": {
          "2026-09": {"inUsd": …, "outUsd": …, "inCount": …, "outCount": …}
        },
        "ytd": {"key": "2026-09", "usd": …, "count": …}
      },
      "bs": {
        "dates":  ["2026-08", "2026-09"],
        "lines": [{"name": "…", "vals": [123, 456]}, …]
      },
      "kpi": {
        "revenue":            …,
        "ebitda":             …,
        "clients":            …,
        "activeAccounts":     …,
        "accountsHeld":       …,
        "transactionVolume":  …,
        "jurisdictions":      …,
        "internationalPct":   …
      },
      "publishedHistory": {
        "2026-06": {"…summary of that month's published record…"},
        "2026-07": {"…"},
        "2026-08": {"…"}
      },
      "commentary": {
        "pipeline":   {"status": "reviewed" | "no_material_update", "textHash": "…"},
        "regulatory": {…},
        "technology": {…}
      },
      "readiness": [
        {"severity": "blocker" | "warning" | "pass", "id": "…", "label": "…"}
      ],
      "outputs": {
        "pdf": {"pageCount": 11},
        "pptx": {"slideCount": 11, "orientation": "landscape", "aspect": "16:9"},
        "continuationFile": {"checksumAlgorithm": "djb2", "checksum": "…"}
      }
    }

## Comparison rules

- All string comparisons are exact.
- Numeric fields must be within **0.01 USD** for figure comparisons (allows for float noise)
  and **exact integers** for counts, page/slide totals, and month keys.
- The `readiness` array must contain the same set of `{severity, id}` pairs — order
  independent, label ignored (labels are UI copy and may change without changing meaning).
- `textHash` for commentary lets us verify content equivalence without embedding real
  narrative in the fixture or baseline.
- Extra fields on either side are a FAIL — schema drift must be explicit, not accidental.

## What is NOT in the snapshot

- Rendered pixel content of the 11 pages — that is a separate image-comparison contract
  (see `env/ENVIRONMENT.md`).
- Internal JavaScript variable names or object shapes — the snapshot is projected from
  whatever internal representation the tool uses at capture time.
- Timing / performance data.
- Actual PDF/PPTX byte content — only structural counts and orientation.

## Extension

Adding a field to the snapshot requires a corresponding baseline re-capture with sign-off,
following the same rules as an environment change.
