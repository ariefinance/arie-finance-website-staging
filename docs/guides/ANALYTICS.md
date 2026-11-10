# Marketing analytics and website report

**Event script:** `assets/analytics.v1.js`. **Report path:** `/managementreport/website-analytics/`. **Reviewed:** 26 October 2026 (code and guide).

## Features
Marketing-page hash section tracking, application/contact interactions, selected CTA and contact-link clicks, consent-aware GA4/GTM data layer, and a two-page monthly website analytics report.

## Monthly reporting
Collect the approved 28-day comparison periods from Vercel Analytics, GA4 and Google Search Console. Enter observed values in the report schema, preview and export as A4 landscape PDF. Report missing values as unavailable, not zero. Follow the [existing report guide](../../managementreport/website-analytics/README.md) for schema and printing.

## Maintenance
Check event mapping, consent handling, and absence of personal information in the data layer. The marketing analytics script does not automatically cover other utility pages. The repo currently contains a tracked `data.json`, while the older guide says it is untracked; review classification before changing it.

**Unverified:** external analytics settings, live measurement delivery, exact consent configuration.

## Check Your Eligibility funnel (added November 2026)

**Primary source: Vercel Web Analytics.** It uses no cookies and sets no identifiers, so it counts every visitor regardless of the cookie banner. **Supplementary: GA4 via GTM**, which only receives data from visitors who choose "Accept analytics".

### Event inventory
Each event is sent to both `window.va` (Vercel) and `dataLayer` (GTM/GA4). Every event fires **at most once per assessment** (except `elig_share`), so re-rendering, editing answers or browser navigation cannot double-count. A new assessment begins only when the visitor starts the questionnaire again from the introduction; returning to the introduction (the "← Back to introduction" control, browser Back, leaving the checker) sends no event, so `elig_start` always means a fresh start. **No event carries answers, eligibility outcomes, countries, activities, company, names, emails or any other personal or screening data.**

| Event | Fires when | Properties |
|---|---|---|
| `section_view` (section = `eligibility`) | The eligibility page is shown (existing event; Vercel section name fixed Nov 2026) | `section` |
| `start_application` | A "Check Your Eligibility" CTA is clicked (unchanged, for historical continuity) | `cta_text`, `cta_location` (GA4 only) |
| `elig_start` | "Check your eligibility" is pressed on the intro screen | — |
| `elig_complete` | A preliminary result is shown (any result) | — |
| `elig_pricing_view` | The indicative pricing screen is opened | — |
| `elig_requirements_click` | The Onboarding Requirements button is clicked | — |
| `elig_review_open` | The Contact ARIE (Further Review) form is opened | — |
| `elig_review_submit` | A Further Review request is successfully sent | — |
| `elig_share` | The share action is used | `share_method`: `native` / `copy` / `whatsapp` / `email` |

Shared links are the clean `https://www.ariefinance.com/eligibility` with no tracking parameters, so `elig_share` counts shares by method, but visits arriving from a share are not separately attributed (they appear as direct or under the referring app). Introducer visits are attributed by the dedicated introducer link's `utm_source=introducer` and `utm_campaign`.

### Funnel report (Vercel → Analytics → Events, production, same date range)
| Step | Metric |
|---|---|
| Visitors | `section_view` filtered to section = `eligibility` (visitors) |
| Started | `elig_start` (visitors) |
| Completed | `elig_complete` (visitors) |
| Pricing viewed | `elig_pricing_view` |
| Requirements clicked | `elig_requirements_click` |
| Further Review submitted | `elig_review_submit` |

Completion rate = Completed ÷ Started. These are **aggregate, anonymous counts** for the period. They are not individually tracked journeys, so ratios between steps are indicative conversion rates. Pricing views and Further Review submissions come from different result types, so they are not two parts of one total.

**Traffic source:** referrer and UTM (`utmSource`, `utmCampaign`) breakdowns. On 10 Nov 2026 the Vercel API returned UTM breakdowns for this project (e.g. `client-email`). Vercel lists UTM reporting in the dashboard as a Web Analytics Plus feature. ARIE's plan tier is not visible through the API, so whether the dashboard shows UTM panels must be checked in the Vercel dashboard. Referrer and route breakdowns are standard.

### GA4 setup required in GTM (one-time, by someone with GTM access)
The `elig_*` events reach GA4 only if GTM forwards them:
1. Trigger: **Custom Event**, event name `^elig_.*` (regex).
2. Tag: **Google Analytics: GA4 Event**, event name `{{Event}}`, parameter `share_method` = Data Layer Variable `share_method`. Fire on the trigger above.
3. In GA4, mark `elig_review_submit` and `elig_requirements_click` as key events. Build a **Funnel exploration**: `section_view` (section_name = eligibility) → `elig_start` → `elig_complete` → `elig_pricing_view` → `elig_requirements_click`.

GA4 delivery could not be verified from the build environment (no GTM/GA4 access).

### Limitations
- GA4 sees only visitors who accept analytics. GTM is not loaded before consent, despite the older "Advanced" comment in `index.html`.
- Vercel records production traffic only. Ad/privacy blockers can hide some visitors from both tools.
- A visitor who starts on one device and finishes on another is counted on both.
