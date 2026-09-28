# Senior Management Website Analytics Report — Reusable Template

A 2-page A4-landscape report for the ARIE Finance website, regenerated each
month from a single JSON file. The template is served at
`/managementreport/website-analytics/` (already gated `noindex, nofollow` and
`Cache-Control: no-store` via `vercel.json`).

**Reporting window:** last 28 days vs previous 28 days.

## Files

| File | Purpose |
|---|---|
| `index.html` | Self-contained template. Inline SVG charts, no runtime deps. |
| `data.example.json` | Full schema with sample values (used as fallback preview). |
| `data.json` | **Not committed.** Paste each month's real values here. |

## How to regenerate the monthly report

1. **Copy the schema**
   ```
   cp data.example.json data.json
   ```

2. **Fill in each block** from the source below, using the exact keys shown in
   `data.example.json`. Where a metric is missing, leave the value `null` (or
   the array empty) — the template renders a professional "Awaiting data"
   placeholder rather than a fake zero.

   | Block | Source |
   |---|---|
   | `period` | Set `current.start`/`end` to the last 28 days ending yesterday; `previous.start`/`end` to the 28 days before that. |
   | `kpis.visitors`, `kpis.pageviews` | Vercel → Web Analytics → the ARIE Finance production project → 28d range. |
   | `kpis.search_clicks`, `kpis.search_impr`, `kpis.search_ctr` | Google Search Console → Performance → **Search results** → last 28d vs previous 28d. |
   | `kpis.enquiries` | GA4 → Events → count of `contact_form_submit` for the window. Leave `current: null` with the `empty_note` intact until the first genuine submission is recorded. |
   | `traffic_trend` | Vercel Web Analytics daily visitors + pageviews for the current window (28 points). |
   | `referrers` | Vercel Web Analytics → Referrers, top rows in this order: Google, Direct, LinkedIn, Bing, DuckDuckGo, ChatGPT. Omit rows with zero. |
   | `countries` | Vercel Web Analytics → Countries, top 5. |
   | `devices` | Vercel Web Analytics → Devices, expressed as `%`. |
   | `sections` | GA4 → Events → `section_view` grouped by `section_name` parameter. Nine public sections: Home, Services, Direct Clients, Introducers, About, Team, Careers, Contact, Compliance. |
   | `funnel` | GA4 → Events count for `start_application`, `contact_form_start`, `contact_form_submit` over the window. |
   | `search.kpis` | Search Console totals for the window (clicks, impressions, CTR%, avg. position). `position.inverse_good: true` tells the template that lower is better. |
   | `search.trend` | Search Console daily clicks + impressions (28 points). |
   | `search.queries` | Search Console → top ~6 queries by clicks. |
   | `search.branded` | Manually classify each query as ARIE-branded or non-branded; sum clicks. Update the `note` if methodology changes. |
   | `search.opportunities` | Search Console rows at position ≈ 5–20 with impressions >= a few hundred and CTR clearly below the branded CTR. |
   | `experience` | Vercel → Speed Insights. While no baseline exists, keep `state: "collecting"` and all metric values `null`. Once populated: `score` = Real Experience Score, `lcp` in `s`, `inp` in `ms`, `cls` unitless. |
   | `portal_feedback` | Count events `portal_experience: Needs attention / Good / Excellent` fired from `/logout` (Vercel Analytics → Custom Events) for the window. If total sample `< 20`, the panel renders the insufficient-sample indicator instead of a chart. |
   | `commentary.observations` | Up to 3, one sentence each. |
   | `commentary.actions` | Up to 3 objects `{ finding, action, priority }`. `priority` is one of `High`, `Medium`, `Monitor`. Only surface an action when the data shows a clear issue/opportunity, the fix is specific and proportionate, and could materially move a management-relevant metric. If the data is not mature enough, use a single `Monitor` row (or leave the array empty — the panel then shows `Monitor — no action required yet.`). No owner field: the same person handles both the report and the website. |

3. **Preview locally**
   ```
   npx serve .                # or any static server
   # open http://localhost:3000/managementreport/website-analytics/
   ```
   With `data.json` present it loads live data; without it, it falls back to
   `data.example.json` and shows a yellow "Preview data" tag in the toolbar.

4. **Export to PDF**
   Open the page in Chrome → **Print** →
   - Destination: **Save as PDF**
   - Layout: **Landscape**
   - Paper size: **A4**
   - Margins: **Default**
   - Options: uncheck *Headers and footers*

   The page CSS locks each sheet to `297mm × 210mm` with `page-break-after`
   between the two report pages, so the PDF renders exactly as previewed.

## Missing-data conventions

The template never fabricates zeros or trends. Instead it renders:

| Trigger | Rendered state |
|---|---|
| `kpis.enquiries.current == null` | KPI card + gold `Awaiting first recorded conversion` chip |
| Any KPI with only `current == null` | `—` and grey `Awaiting data` line |
| `experience.state == "collecting"` **or** all metric values null | Panel-wide `Collecting baseline — insufficient real-user data` |
| `portal_feedback.sample < 20` | Compact `Portal feedback: n=X — insufficient sample for trend analysis` indicator (donut suppressed) |
| Empty `sections`, `referrers`, `countries`, `queries`, `opportunities` | Panel-wide `Awaiting data` placeholder |

## What this template does NOT do

- It does **not** collect analytics. No tracking scripts, no GA4 changes, no
  Search Console API calls, no Vercel configuration changes.
- It does **not** modify the public marketing site (`index.html`),
  `assets/analytics.v1.js`, `vercel.json`, `robots.txt`, `sitemap.xml`, or any
  other utility page under `/logout`, `/salestracker`, `/managementreport`,
  or `/internal/*`.
- It is not indexed: `/managementreport/*` is already gated by
  `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store` in
  `vercel.json`.

## Design notes

- Palette + typography match `managementreport/index.html` (navy `#06113A`,
  gold `#C99B3F`, indigo `#2E2A8C`; Hanken Grotesk + Newsreader).
- All charts are hand-drawn inline SVG. No CDN, no npm, no external JS.
- The template is a single HTML file plus one JSON file, so any future
  contributor can regenerate the report by editing values in one place.
