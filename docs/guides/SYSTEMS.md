# ARIE Systems directory

**UI:** `/internal/systems/` (gate → `studio.html` in an iframe). **API:** `/api/internal/systems`. **Sources:** `internal/systems/`, `api/internal/systems.js`. **Reviewed:** 6 November 2026.

## What it does
A compact staff landing page with three tabs:

- **ARIE Finance** — third-party platforms the ARIE team signs into.
- **ACBM** — third-party platforms the ACBM team signs into.
- **Internal tools** — a tile-grid launcher for the tools built in-house.

A separate **Payment guide** button discloses the existing payment-workflow diagram inline.

## Access
Same passcode pattern as the other `/internal/*` tools. The API reads `INTERNAL_SYSTEMS_PASSCODE`; if unset it falls back to `INTERNAL_WIRE_TRANSFER_PASSCODE`. Cookie `arie_isy`, 12-hour TTL, path-scoped to `/api/internal/systems`.

## ARIE / ACBM — grouped lists

| Group | ARIE Finance | ACBM |
| --- | --- | --- |
| Onboarding | RegMind Back Office (Staff), RegMind Portal (Client-facing), KYC Portal back office, Onboarding SCV | KYC Portal back office |
| Payments | Saascada, Allica payment platform (Link unavailable), Thunes | ACBM back office |
| Compliance | Accuity, ComplyAdvantage | Accuity |
| Accounting | Xero | Xero |
| Banking partners | MauBank | AfrAsia Bank, Mercury, MauBank |

Pricing and Sales tracker are not in these columns — they live in **Internal tools**. RegMind Back Office + Portal are the only entries carrying audience tags. Allica preserves its provider contact as a copy-email button (click copies to clipboard) and shows "Link unavailable" in place of a destination.

## Internal tools — grouped tile launcher

Four sections inside the Internal tools tab, each with the same compact heading style used on the ARIE / ACBM tabs. Tiles below each heading use three columns on desktop, two on tablet, one on mobile. Each tile has a small outline icon, the tool's name and one short complete description; the whole tile is a link that opens in a new tab.

The tab uses a compact single-line heading ("Internal tools", ~30 px) and no introductory paragraph — the tabs, section headings and search already explain the page.

| Group | Tools (display order) |
| --- | --- |
| Sales & onboarding | Sales tracker · Pricing & welcome packs · Onboarding requirements |
| Payments | MauBank wire-transfer utility · MauBank TT Instruction |
| Finance & reporting | Statement generator · Management Report Builder |
| Communications | Holidays Announcement · Insights Publisher |

## Search
Per-tab. Filters names, purposes, hostnames and provider contacts. Small synonym set for `tt`, `transfer`, `statement`, `pricing`, `onboarding`. Enter opens the first filtered result. Switching tabs preserves the query.

## Payment guide
Collapsible panel below the main content. Lazily injects the existing `FLOW_HTML` (two SVG diagrams + three note cards) on first open.

## Maintenance
Link definitions live inline in `studio.html` as named constants near the top of the `<script>` block (one `const` per retained destination). Add / rename / retire a tool by editing those constants and the per-tab `DATA` entry. Preserve banking URLs verbatim — several carry required query parameters. The logo is wrapped in a `target="_top"` link to `/` so clicking it leaves the directory iframe and lands on the homepage.

Website Analytics is deliberately not listed. The old Useful links section, the ARIE Online Banking shortcut and the Email Helper shortcut have been removed.

**Unverified:** fine-grained staff permissions; Allica staff destination (no URL available).
