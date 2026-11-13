# Platform and route inventory

**Inventory date:** 26 October 2026. **Evidence:** `main` repository tree, `vercel.json`, package manifest, existing component guides. URL paths are *expected routes inferred from files*, not independently confirmed live endpoints.

| Component | Expected path | Key files | Purpose | Documentation status |
|---|---|---|---|---|
| Public website | `/`, `/services`, `/introducers` and legacy hash sections | `index.html`, `api/marketing-page.js` | Marketing, independently addressable services and introducer pages, contact, careers, disclosures | [Public website guide](guides/PUBLIC-SITE.md) |
| Eligibility check | `/eligibility` | `index.html`, `api/eligibility-page.js`, `api/eligibility.js` | Shareable preliminary eligibility and indicative pricing journey | [Eligibility guide](guides/ELIGIBILITY.md) |
| Website form | `POST /api/website-form` | `api/website-form.js` | Contact and Careers enquiry emails | API notes in previous README; verify runtime |
| Insights listing | `/insights/` | `insights/index.html`, `insights/insights.css` | Published editorial content | [Publishing](../insights/PUBLISHING.md) |
| Insights publisher | `/insights/admin/` | `insights/admin/index.html`, `api/insights/*.js` | Admin publishing and article management | [Admin](../insights/ADMIN.md); branch guide historically PR-specific |
| Onboarding requirements | `/onboarding-requirements` (indexable; `/onboarding-requirements/` redirects) | `onboarding-requirements/index.html`, `app.js` | Customer onboarding requirements | [Client resources guide](guides/CLIENT-RESOURCES.md) |
| Onboarding pack PDF | `/documents/ARIE_Finance_Corporate_Onboarding_Pack.pdf` | `documents/*.pdf` | Downloadable corporate onboarding pack | Version/review owner to confirm |
| Sales tracker | `/salestracker/` | `salestracker/index.html`, `api/salestracker.js` | Sales pipeline management | [Sales Tracker guide](guides/SALES-TRACKER.md) |
| Pricing/document builder | `/internal/pricing/` | `internal/pricing/*`, `api/internal/pricing.js` | Pricing/proposal document preparation | [Pricing guide](guides/PRICING.md); [manifest](../internal/pricing/MANIFEST.txt) |
| Wire-transfer utility | `/internal/wire-transfer/` | `internal/wire-transfer/*`, `api/internal/wire-transfer.js` | MauBank wire-transfer document preparation | [Wire-transfer guide](guides/WIRE-TRANSFER.md); [tests](../internal/wire-transfer/tests/run.js) |
| Correspondence Studio (holidays) | `/internal/holidays/` | `internal/holidays/*`, `api/internal/holidays.js` | Staff tool for drafting ARIE holiday / out-of-office correspondence | [Holidays guide](guides/HOLIDAYS.md) |
| MauBank TT Instruction | `/internal/tt/` | `internal/tt/*`, `api/internal/tt.js` | Staff tool for preparing MauBank TT instructions | [TT Instruction guide](guides/TT-INSTRUCTION.md) |
| ARIE Statement Generator | `/internal/statements/` | `internal/statements/*`, `api/internal/statements.js` | Staff tool for generating client statements | [Statement Generator guide](guides/STATEMENTS.md) |
| ARIE Systems directory | `/internal/systems/` | `internal/systems/*`, `api/internal/systems.js` | Staff landing page linking every platform and in-house tool used by ARIE / ACBM | [Systems directory guide](guides/SYSTEMS.md) |
| Management report builder | `/managementreport/` | `managementreport/index.html`, `api/managementreport.js` | Monthly management report production | [Management Report guide](guides/MANAGEMENT-REPORT.md); [regression](../managementreport/tests/README.md) |
| Website analytics report | `/managementreport/website-analytics/` | `managementreport/website-analytics/*` | Monthly traffic/search reporting template | [Analytics guide](guides/ANALYTICS.md); [template](../managementreport/website-analytics/README.md) |
| Logout/session page | `/logout/` | `logout/index.html` | Portal exit and feedback | [Public website guide](guides/PUBLIC-SITE.md) |
| Analytics instrumentation | referenced from site | `assets/analytics.v1.js` | Analytics and consent-dependent tracking | Dedicated implementation guide missing |
| Routing/security/cache | all deployed paths | `vercel.json`, `robots.txt`, `sitemap.xml` | Redirects, headers and crawling | [Operations](OPERATIONS.md) |

## Public website sections and legacy routes

The website reuses one maintained HTML template. `/services` and `/introducers` now return that template with the requested section visible in the server response and its own title, description and canonical URL. `/eligibility` retains its existing shareable entry handler. Navigation uses these real paths; previous hash links still resolve through the router. Other sections remain homepage anchors.

**Redirects:** `/solutions` now points to `/services`. `/services/`, `/introducers/` and `/eligibility/` use their corresponding paths without a trailing slash. Other legacy aliases such as `/about`, `/contact`, `/team` and legal aliases still point to homepage sections; see `vercel.json` for authoritative targets.

**External system:** `https://online.ariefinance.com/online-banking` is a separately hosted banking portal, **not** part of this repository. Website operations must not change its DNS/access configuration.

## API inventory

- `api/marketing-page.js` — initial HTML and metadata for the Services and Introducers public routes
- `api/eligibility-page.js`, `api/eligibility.js` — shareable eligibility entry and rules endpoint
- `api/website-form.js` — website enquiry and careers submission
- `api/insights/login.js`, `logout.js`, `session.js`, `articles.js`, `publish.js`, `_lib.js` — publisher authentication/content workflows
- `api/salestracker.js` — Sales Tracker backend
- `api/managementreport.js` — management report backend
- `api/internal/pricing.js` — pricing/document builder backend
- `api/internal/wire-transfer.js` — wire transfer backend
- `api/internal/holidays.js` — Correspondence Studio access control (login/logout/session)
- `api/internal/tt.js` — MauBank TT Instruction access control (login/logout/session)
- `api/internal/statements.js` — ARIE Statement Generator access control (login/logout/session)
- `api/internal/systems.js` — ARIE Systems directory access control (login/logout/session)

These are serverless functions in the same repository; do not infer access-control strength from their `/internal/` or `/api/` prefixes.

## Ownership and handover template

For each component, record: **Business owner; technical maintainer; audience; authorised users; input/source; output/destination; data sensitivity; last live verification; rollback instructions**. Names/access are deliberately left unassigned until confirmed by management; see [verification backlog](VERIFICATION-BACKLOG.md).
