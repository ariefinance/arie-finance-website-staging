# ARIE Statement Generator

**UI:** `/internal/statements/` (gate → `studio.html` in an iframe). **API:** `/api/internal/statements`. **Sources:** `internal/statements/`, `api/internal/statements.js`. **Reviewed:** 4 November 2026.

## What it does
Staff-only tool for generating client statements. The studio renders in-browser; nothing composed in it leaves the browser.

## Access
Same passcode pattern as the other `/internal/*` tools. The API reads `INTERNAL_STATEMENTS_PASSCODE`; if that env var isn't set it falls back to `INTERNAL_WIRE_TRANSFER_PASSCODE` so the tool works on day 1 without any Vercel change. Set the dedicated variable when it should diverge. Cookie `arie_isg`, 12-hour TTL, path-scoped to `/api/internal/statements`.

## How it's built
`studio.html` is a self-contained single-page HTML tool with inline CSS and CDN script tags (pdf.js, jsPDF, SheetJS/xlsx). `index.html` is a thin passcode gate that embeds `studio.html` in a full-page iframe once the cookie is valid. To update the studio, replace `studio.html` with a newer version.

**Unverified:** fine-grained staff permissions, long-term bundle maintenance path.
