# ARIE Finance — Platform and Feature Directory

**This repository contains the public website and ARIE's operational web tools.** Use this page to find a feature, its source and instructions. This is a source-code inventory, not a live-access or security certification.

[Documentation hub](docs/README.md) · [Complete route and API inventory](docs/PLATFORM-INVENTORY.md) · [Operations](docs/OPERATIONS.md) · [Verification backlog](docs/VERIFICATION-BACKLOG.md)

## Public features

| Feature | Purpose | Expected route | Guide |
|---|---|---|---|
| Homepage and services | Public company, services and audience information | `/`, `/#services`, `/#direct-clients`, `/#introducers` | [Public website](docs/guides/PUBLIC-SITE.md) |
| About, team and compliance | Company and disclosure information | `/#about`, `/#team`, `/#compliance` | [Public website](docs/guides/PUBLIC-SITE.md) |
| Contact and application enquiry | Client enquiry forms with email delivery | `/#contact` | [Public website](docs/guides/PUBLIC-SITE.md) |
| Careers and CV | Job enquiry and supported attachment submission | `/#careers` | [Public website](docs/guides/PUBLIC-SITE.md) |
| Onboarding requirements | Customer information and requirements interface | `/onboarding-requirements/` | [Source](onboarding-requirements/) |
| Corporate onboarding pack | Downloadable corporate pack | `/documents/ARIE_Finance_Corporate_Onboarding_Pack.pdf` | [Document](documents/ARIE_Finance_Corporate_Onboarding_Pack.pdf) |
| ARIE Insights | Article listing and published articles | `/insights/` | [Insights guide](docs/guides/INSIGHTS.md) |
| Online banking | Link to a separate banking portal, not hosted in this repository | `online.ariefinance.com` | External system |

## Staff features

| Feature | Purpose | Expected route | Guide |
|---|---|---|---|
| Sales Tracker | Shared leads, stages, pipeline status, saved versions, history/restore | `/salestracker/` | [Sales](docs/guides/SALES-TRACKER.md) |
| Pricing and Document Builder | Pricing/document creation, branded exports and reference register | `/internal/pricing/` | [Pricing](docs/guides/PRICING.md) |
| Management Report Builder | Monthly financial reporting and PDF/PPTX/continuation exports | `/managementreport/` | [Management reporting](docs/guides/MANAGEMENT-REPORT.md) |
| Website Analytics Report | Traffic, search, conversions and monthly PDF report | `/managementreport/website-analytics/` | [Analytics](docs/guides/ANALYTICS.md) |
| Wire Transfer Utility | Extract and populate a MauBank transfer form for approval | `/internal/wire-transfer/` | [Wire transfer](docs/guides/WIRE-TRANSFER.md) |
| Insights Publisher | Create/edit/preview/publish/unpublish articles | `/insights/admin/` | [Insights](docs/guides/INSIGHTS.md) |
| Article Email Helper | Copy formatted sharing email (does not send email) | `/insights/_email-helper.html` | [Publishing](insights/PUBLISHING.md) |
| Signed-out page | Post-session experience and feedback capture | `/logout/` | [Source](logout/index.html) |

## Shared services and configuration

| Feature | Location | Documentation |
|---|---|---|
| Contact and Careers API | [api/website-form.js](api/website-form.js) | [Public website](docs/guides/PUBLIC-SITE.md) |
| Sales persistence/API | [api/salestracker.js](api/salestracker.js) | [Sales](docs/guides/SALES-TRACKER.md) |
| Management report sessions/API | [api/managementreport.js](api/managementreport.js) | [Management reporting](docs/guides/MANAGEMENT-REPORT.md) |
| Pricing references/API | [api/internal/pricing.js](api/internal/pricing.js) | [Pricing](docs/guides/PRICING.md) |
| Wire transfer sessions/API | [api/internal/wire-transfer.js](api/internal/wire-transfer.js) | [Wire transfer](docs/guides/WIRE-TRANSFER.md) |
| Insights API | [api/insights/](api/insights/) | [Insights](docs/guides/INSIGHTS.md) |
| Marketing analytics and consent events | [assets/analytics.v1.js](assets/analytics.v1.js) | [Analytics](docs/guides/ANALYTICS.md) |
| Redirects/cache/headers | [vercel.json](vercel.json) | [Operations](docs/OPERATIONS.md) |
| SEO directives | [robots.txt](robots.txt), [sitemap.xml](sitemap.xml) | [Inventory](docs/PLATFORM-INVENTORY.md) |
| Synthetic regression tests | [managementreport/tests/](managementreport/tests/), [wire transfer tests](internal/wire-transfer/tests/run.js) | [Management report tests](managementreport/tests/README.md) |

## Handover rules

Start from the feature guide, then the linked source. Keep changes on reviewed branches and use synthetic data for tests. Confirm current Vercel deployment mapping before merging. Update related documentation whenever behaviour changes. Do not commit credentials or customer/financial data.

**Important:** `robots.txt`, `noindex` and `no-store` do not restrict access. Some route and operational details need independent production checks; consult the [verification backlog](docs/VERIFICATION-BACKLOG.md).

**Last reorganised:** 26 October 2026.
