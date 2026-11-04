# Correspondence Studio — Holiday notices

**UI:** `/internal/holidays/` (gate → `studio.html` in an iframe). **API:** `/api/internal/holidays`. **Sources:** `internal/holidays/`, `api/internal/holidays.js`. **Reviewed:** 4 November 2026.

## What it does
Staff-only tool for composing ARIE holiday / out-of-office notices and office-closure correspondence. The studio renders in-browser; nothing composed in it leaves the browser.

## Access
Same passcode pattern as `/internal/wire-transfer` and `/internal/pricing`. The API reads `INTERNAL_HOLIDAYS_PASSCODE`; if that env var isn't set it falls back to `INTERNAL_WIRE_TRANSFER_PASSCODE` so the tool works on day 1 without any Vercel change. Set the dedicated variable when it should diverge. Cookie `arie_ihd`, 12-hour TTL, path-scoped to `/api/internal/holidays`.

## How it's built
`studio.html` is a self-contained bundled single-page app shipped as one file (React + inline fonts). It is hosted as-is; we do not edit it in place. `index.html` is a thin passcode gate that embeds `studio.html` in a full-page iframe once the cookie is valid. To update the studio, replace `studio.html` with a newer bundle.

**Unverified:** fine-grained staff permissions, long-term bundle maintenance path (we currently depend on the author's build output).
