# ARIE Systems directory

**UI:** `/internal/systems/` (gate → `studio.html` in an iframe). **API:** `/api/internal/systems`. **Sources:** `internal/systems/`, `api/internal/systems.js`. **Reviewed:** 6 November 2026.

## What it does
A staff-only landing page listing every platform ARIE Finance / ACBM staff sign into — third-party platforms (MauBank, Saascada, Xero, ComplyAdvantage, etc.) alongside the in-house tools hosted on `ariefinance.com` (pricing builder, wire-transfer utility, TT instruction, statement generator, holidays studio, management report, sales tracker, insights publisher, onboarding requirements). Entity switcher toggles between ARIE Finance, ACBM, and a one-page view of the payment workflow.

## Access
Same passcode pattern as the other `/internal/*` tools. The API reads `INTERNAL_SYSTEMS_PASSCODE`; if that env var isn't set it falls back to `INTERNAL_WIRE_TRANSFER_PASSCODE` so the tool works on day 1 without any Vercel change. Set the dedicated variable when it should diverge. Cookie `arie_isy`, 12-hour TTL, path-scoped to `/api/internal/systems`.

## Maintaining the list
Links live inline in `studio.html` under the `DATA` and `INTERNAL_TOOLS` constants near the top of the `<script>` block. Add / rename / retire a tool by editing those objects. If the count in the entity-switcher tabs (`<b>11</b>`, etc.) is wrong, update it in the matching `<button role="tab">` element. Links in `INTERNAL_TOOLS` are site-relative (`/internal/pricing/`) so they resolve on whatever domain the directory is served from.

**Unverified:** fine-grained staff permissions, long-term maintenance owner for the link list.
