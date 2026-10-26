# Platform and route inventory

**Inventory date:** 26 October 2026. **Evidence:** `main` repository tree, `vercel.json`, package manifest, existing component guides. URL paths are *expected routes inferred from files*, not independently confirmed live endpoints.

| Component | Expected path | Key files | Purpose | Documentation status |
|---|---|---|---|---|
| Public website | `/` and hash sections | `index.html` | Marketing, service pages, contact, careers, disclosures | [Public website guide](guides/PUBLIC-SITE.md) |
| Website form | `POST /api/website-form` | `api/website-form.js` | Contact and Careers enquiry emails | API notes in previous README; verify runtime |
| Insights listing | `/insights/` | `insights/index.html`, `insights/insights.css` | Published editorial content | [Publishing](../insights/PUBLISHING.md) |
| Insights publisher | `/insights/admin/` | `insights/admin/index.html`, `api/insights/*.js` | Admin publishing and article management | [Admin](../insights/ADMIN.md); branch guide historically PR-specific |
| Onboarding requirements | `/onboarding-requirements/` | `onboarding-requirements/index.html`, `app.js` | Customer onboarding requirements | [Client resources guide](guides/CLIENT-RESOURCES.md) |
| Onboarding pack PDF | `/documents/ARIE_Finance_Corporate_Onboarding_Pack.pdf` | `documents/*.pdf` | Downloadable corporate onboarding pack | Version/review owner to confirm |
| Sales tracker | `/salestracker/` | `salestracker/index.html`, `api/salestracker.js` | Sales pipeline management | [Sales Tracker guide](guides/SALES-TRACKER.md) |
| Pricing/document builder | `/internal/pricing/` | `internal/pricing/*`, `api/internal/pricing.js` | Pricing/proposal document preparation | [Pricing guide](guides/PRICING.md); [manifest](../internal/pricing/MANIFEST.txt) |
| Wire-transfer utility | `/internal/wire-transfer/` | `internal/wire-transfer/*`, `api/internal/wire-transfer.js` | MauBank wire-transfer document preparation | [Wire-transfer guide](guides/WIRE-TRANSFER.md); [tests](../internal/wire-transfer/tests/run.js) |
| Management report builder | `/managementreport/` | `managementreport/index.html`, `api/managementreport.js` | Monthly management report production | [Management Report guide](guides/MANAGEMENT-REPORT.md); [regression](../managementreport/tests/README.md) |
| Website analytics report | `/managementreport/website-analytics/` | `managementreport/website-analytics/*` | Monthly traffic/search reporting template | [Analytics guide](guides/ANALYTICS.md); [template](../managementreport/website-analytics/README.md) |
| Logout/session page | `/logout/` | `logout/index.html` | Portal exit and feedback | [Public website guide](guides/PUBLIC-SITE.md) |
| Analytics instrumentation | referenced from site | `assets/analytics.v1.js` | Analytics and consent-dependent tracking | Dedicated implementation guide missing |
| Routing/security/cache | all deployed paths | `vercel.json`, `robots.txt`, `sitemap.xml` | Redirects, headers and crawling | [Operations](OPERATIONS.md) |

## Public website sections and legacy routes

The website is primarily single-page: the Vercel redirects map legacy page URLs into anchors such as `/#services`, `/#about`, `/#contact`, `/#team`, `/#careers`, `/#compliance`, and `/#home`. There is no corresponding independent HTML page for each legacy URL.

**Other published redirects:** `/services`, `/solutions`, `/about`, `/contact`, `/open-account`, `/team`, `/join`, `/events`, `/terms`, `/legal`, `/privacy`, `/cookie`, `/cookies`, `/customer-security`, `/security`, `/faqs` (see `vercel.json` for authoritative targets and redirect types). These redirects should **not** be mistaken for separately maintained policy or service pages.

**External system:** `https://online.ariefinance.com/online-banking` is a separately hosted banking portal, **not** part of this repository. Website operations must not change its DNS/access configuration.

## API inventory

- `api/website-form.js` — website enquiry and careers submission
- `api/insights/login.js`, `logout.js`, `session.js`, `articles.js`, `publish.js`, `_lib.js` — publisher authentication/content workflows
- `api/salestracker.js` — Sales Tracker backend
- `api/managementreport.js` — management report backend
- `api/internal/pricing.js` — pricing/document builder backend
- `api/internal/wire-transfer.js` — wire transfer backend

These are serverless functions in the same repository; do not infer access-control strength from their `/internal/` or `/api/` prefixes.

## Ownership and handover template

For each component, record: **Business owner; technical maintainer; audience; authorised users; input/source; output/destination; data sensitivity; last live verification; rollback instructions**. Names/access are deliberately left unassigned until confirmed by management; see [verification backlog](VERIFICATION-BACKLOG.md).
