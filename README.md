# ARIE Finance — web platform repository

This repository contains the public ARIE Finance website **and multiple operational applications**, serverless APIs, publishing tools, and reporting utilities. The historic name `arie-finance-website-staging` does not imply this is a staging-only environment.

**Start with the [central documentation hub](docs/README.md).**

## Find a component quickly

| What you need | Documentation |
|---|---|
| Complete site/component list, routes and source files | [Platform inventory](docs/PLATFORM-INVENTORY.md) |
| Safe changes, release checks, environments and access boundaries | [Operations](docs/OPERATIONS.md) |
| Outstanding documentation, access and verification work | [Verification backlog](docs/VERIFICATION-BACKLOG.md) |
| Insights publishing | [Admin guide](insights/ADMIN.md) · [manual/historical guide](insights/PUBLISHING.md) |
| Management Report Builder regression | [Test guide](managementreport/tests/README.md) |
| Website traffic report | [Analytics report guide](managementreport/website-analytics/README.md) |
| Pricing/document builder runtime files | [Pricing manifest](internal/pricing/MANIFEST.txt) |
| MauBank transfer utility runtime files | [Wire-transfer manifest](internal/wire-transfer/MANIFEST.txt) |

## At a glance

- **Public website:** `index.html`, website Contact/Careers submission at `api/website-form.js`, `assets/analytics.v1.js`.
- **Publishing:** `insights/`, `api/insights/`.
- **Customer resources:** `onboarding-requirements/`, `documents/`.
- **Sales:** `salestracker/`, `api/salestracker.js`.
- **Finance/operations:** `internal/pricing/`, `internal/wire-transfer/`, `managementreport/`, corresponding serverless APIs.
- **Other:** `logout/`, `vercel.json`, `robots.txt`, `sitemap.xml`.

## Deployment caution

The previous README described automatic Vercel production deployments from `main` to `https://www.ariefinance.com`; **verify the current project and branch mappings in Vercel before merging**. The online-banking portal at `https://online.ariefinance.com/online-banking` is a separate service and must not be modified through website changes.

This documentation is a repository inventory. It does **not** certify live endpoint health, access permissions, testing status or regulatory approval. In particular, `noindex`, `robots.txt`, and `Cache-Control` are **not substitutes for authentication**.

## Contribution rules

1. Locate the relevant component in the [inventory](docs/PLATFORM-INVENTORY.md).
2. Work on a branch and open a reviewed PR; preserve unrelated functions.
3. Use synthetic test data, avoid committing secrets or real client/financial information.
4. Validate with component-specific tests and a protected preview.
5. Update the component guide and [inventory](docs/PLATFORM-INVENTORY.md) whenever routes or behaviour change.

**Documentation last reorganised:** 26 October 2026. Existing detailed component guides are preserved and any suspected outdated instructions are tracked in the [verification backlog](docs/VERIFICATION-BACKLOG.md).
