# ARIE Systems directory

**UI:** `/internal/systems/` (gate → `studio.html` in an iframe). **API:** `/api/internal/systems`. **Sources:** `internal/systems/`, `api/internal/systems.js`. **Reviewed:** 6 November 2026.

## What it does
A staff-only landing page listing every platform ARIE Finance / ACBM staff sign into — third-party systems alongside the in-house tools hosted on `ariefinance.com`. Entity switcher toggles between ARIE Finance and ACBM. A separate Payment guide button discloses the existing payment-workflow diagram inline.

## Access
Same passcode pattern as the other `/internal/*` tools. The API reads `INTERNAL_SYSTEMS_PASSCODE`; if that env var isn't set it falls back to `INTERNAL_WIRE_TRANSFER_PASSCODE` so the tool works on day 1 without any Vercel change. Set the dedicated variable when it should diverge. Cookie `arie_isy`, 12-hour TTL, path-scoped to `/api/internal/systems`.

## Groups and company mapping
The directory uses six task groups per entity. Only populated groups render; empty groups are hidden rather than shown with no entries.

| Group | ARIE Finance | ACBM |
| --- | --- | --- |
| Client onboarding | RegMind Back Office, RegMind Portal, KYC Portal back office, Onboarding SCV, Onboarding requirements | KYC Portal back office |
| Payments & banking | Saascada, Allica payment platform, Thunes, MauBank, MauBank wire-transfer utility, MauBank TT Instruction, ARIE Online Banking | ACBM back office, AfrAsia Bank, Mercury, MauBank, MauBank TT Instruction |
| Compliance | Accuity, ComplyAdvantage | Accuity |
| Sales & pricing | Sales tracker, Pricing and welcome pack generator | Pricing / Fee Schedule |
| Finance & reporting | Xero, Statement generator, Management Report Builder | Xero |
| Communications | Holidays Announcement, Insights Publisher, Prepare article email | — |

The ACBM "Pricing / Fee Schedule" row points to the same `/internal/pricing` URL as ARIE's entry; the Pricing tool has its own brand switcher that the user picks inside the tool, so this directory does not and cannot preselect the brand automatically.

## Audience tags
Rows are marked `Staff` or `Client-facing` only where the distinction prevents confusion (currently the two RegMind links and ARIE Online Banking). Rows without a working destination (currently Allica) render a non-clickable "Link unavailable" tag and keep their existing provider contact as a secondary mailto link.

## Search
Search filters names, purposes, hostnames and provider contacts across the selected company's task groups and Useful links. A small set of practical terms expands to useful synonyms: `tt`, `transfer`, `statement`, `pricing`, `onboarding`. The query is preserved when the user switches company, results refresh, and empty groups hide. The no-results empty state names the selected company and offers a Clear-search button.

## Useful links
A compact section below the task groups holds supporting resources. Items tagged `company:'arie'` appear only under ARIE; `company:'both'` appear under either company. The Bank of Mauritius indicative-rates link is the only cross-company reference today.

## Payment guide
Formerly a tab, now a secondary action. The `FLOW_HTML` block (two SVG diagrams plus the "hand-off", "route" and "soft/hard stop" explainer cards) is preserved verbatim from `55af7d7` and lazily injected into `#guide-panel` the first time the user opens it.

## Maintenance
Link definitions live inline in `studio.html` as named constants near the top of the `<script>` block (one `const` per retained destination). Add / rename / retire a tool by editing those constants and the per-company `groups` arrays in `DATA`. Useful links are a separate `USEFUL` array. No numeric tab badges — entry counts are shown only as a live `tally` driven from the rendered sections.

Preserve exact banking URLs verbatim; several (MauBank, AfrAsia) carry required query parameters. The two "ariefinance.com" absolute URLs for Pricing and Sales tracker are left as absolute to match the pinned main.

**Unverified:** fine-grained staff permissions; Allica staff destination (no URL available); Bank of Mauritius indicative-rates URL reachability (fetch timed out during review).
