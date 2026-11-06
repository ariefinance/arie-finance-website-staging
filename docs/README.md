# ARIE Finance web platform — documentation hub

**Scope:** repository `ariefinance/arie-finance-website-staging`. **Updated:** 4 November 2026. This is a *repository inventory*, not evidence that any specific route is reachable, authenticated, healthy, or approved for production use.

## Start here

| Need | Read |
|---|---|
| Identify a website component, URL or code owner | [Platform and route inventory](PLATFORM-INVENTORY.md) |
| Understand deployments, access boundaries and safe changes | [Operations and security](OPERATIONS.md) |
| Publish/edit an Insights article | [Insights administrator guide](../insights/ADMIN.md), then [legacy manual workflow](../insights/PUBLISHING.md) only where applicable |
| Use/regress the Management Report Builder | [Management Report regression guide](../managementreport/tests/README.md), [test environment](../managementreport/tests/env/ENVIRONMENT.md) |
| Prepare the monthly website analytics report | [Website analytics report guide](../managementreport/website-analytics/README.md) |
| Identify runtime files for pricing or wire-transfer tool | [Pricing manifest](../internal/pricing/MANIFEST.txt), [Wire-transfer manifest](../internal/wire-transfer/MANIFEST.txt) |
| Draft a staff holiday / office-closure notice | [Correspondence Studio guide](guides/HOLIDAYS.md) |
| Prepare a MauBank TT instruction | [TT Instruction guide](guides/TT-INSTRUCTION.md) |
| Generate a client statement | [Statement Generator guide](guides/STATEMENTS.md) |
| Find a platform or in-house tool the team uses | [Systems directory](guides/SYSTEMS.md) |
| Review open documentation/operational risks | [Verification backlog](VERIFICATION-BACKLOG.md) |

## Site map

1. **Public marketing:** homepage, its section/hash routes, Contact and Careers forms.
2. **Public editorial:** Insights listing and static article templates; separate administrator/publishing flows.
3. **Customer information:** onboarding requirements page and downloadable corporate onboarding pack.
4. **Internal commercial:** Sales Tracker and pricing/document builder.
5. **Internal finance:** Management Report Builder, website analytics report, MauBank wire-transfer utility.
6. **Internal operations:** Correspondence Studio for staff holiday / office-closure notices; MauBank TT Instruction; ARIE Statement Generator; Systems directory (landing page linking every tool and platform).
7. **Session utility:** logout/portal feedback page.
8. **Backend APIs:** website form, Insights, sales, reporting, pricing, wire transfer and Correspondence Studio access.

See [Platform inventory](PLATFORM-INVENTORY.md) for exact repository paths and API routes.

## Documentation rules

- **This index is canonical for navigation; the code/configuration is authoritative for actual behaviour.** Existing component guides remain the detailed references until individually reconciled.
- Write instructions for *operators* (what to do, inputs, output, escalation) separately from *maintainers* (files, env var names, tests, deployment, rollback).
- Every guide should state its area, audience, last verification date, and a link to the relevant code/configuration.
- Label a statement **VERIFIED IN REPOSITORY**, **NEEDS RUNTIME VERIFICATION**, or **HISTORICAL** when that distinction matters.
- Never include actual credentials, tokens, client information, financial reports, customer uploads, environment variable values or production access procedures that bypass authorization.
- Internal route names, `noindex` and `robots.txt` are **not authentication**; do not imply otherwise.
- For content changes to public website or compliance/regulatory claims, obtain business/compliance review before deployment. For internal tools, require relevant owner acceptance.
- Make documentation changes on a review branch/PR. Never change application behaviour as a side effect of documentation cleanup.
- When a component changes, update the inventory, its detailed guide, and the verification backlog in the same PR.

## Change history

- **2026-11-04:** Correspondence Studio (holidays), MauBank TT Instruction, and ARIE Statement Generator added at `/internal/holidays/`, `/internal/tt/`, `/internal/statements/`; each is a self-contained single-page HTML hosted behind the shared staff passcode. See [Correspondence Studio](guides/HOLIDAYS.md), [TT Instruction](guides/TT-INSTRUCTION.md), [Statement Generator](guides/STATEMENTS.md).
- **2026-10-26:** central documentation navigation and repository-level inventory introduced. Historical guides preserved; contradictions tracked rather than silently rewritten.
