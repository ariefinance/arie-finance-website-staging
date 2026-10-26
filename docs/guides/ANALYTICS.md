# Marketing analytics and website report

**Event script:** `assets/analytics.v1.js`. **Report path:** `/managementreport/website-analytics/`. **Reviewed:** 26 October 2026 (code and guide).

## Features
Marketing-page hash section tracking, application/contact interactions, selected CTA and contact-link clicks, consent-aware GA4/GTM data layer, and a two-page monthly website analytics report.

## Monthly reporting
Collect the approved 28-day comparison periods from Vercel Analytics, GA4 and Google Search Console. Enter observed values in the report schema, preview and export as A4 landscape PDF. Report missing values as unavailable, not zero. Follow the [existing report guide](../../managementreport/website-analytics/README.md) for schema and printing.

## Maintenance
Check event mapping, consent handling, and absence of personal information in the data layer. The marketing analytics script does not automatically cover other utility pages. The repo currently contains a tracked `data.json`, while the older guide says it is untracked; review classification before changing it.

**Unverified:** external analytics settings, live measurement delivery, exact consent configuration.
