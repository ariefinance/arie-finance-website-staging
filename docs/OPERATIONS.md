# Operations, deployment and access boundaries

**Updated:** 26 October 2026. This guide separates evidence in the repository from external configuration requiring a human check.

## Deployment

- Repository: `ariefinance/arie-finance-website-staging`; default branch `main`.
- Existing README states that Vercel deploys `main` to `www.ariefinance.com`. **NEEDS RUNTIME VERIFICATION** in Vercel project settings before any production operation.
- `package.json` specifies Node `24.x` and includes `nodemailer`, `@upstash/redis`, `sanitize-html`, `saxes`, and `yauzl`. Do not rely on the old README's claim that Nodemailer is the only dependency.
- Public site uses a large `index.html` template, with separate HTML/JS modules for other tools. A change to this repository can affect more than the marketing website.
- GitHub PR review and a Vercel preview should precede every merge. Do not merge this documentation PR automatically.

## Pre-change checklist

1. Identify the component and its source files in [inventory](PLATFORM-INVENTORY.md).
2. Check latest `main` SHA, open PRs and applicable tests before edits.
3. Confirm change approver and whether regulatory/client/financial data is involved.
4. Keep secrets and real customer data out of commits, PR screenshots and test fixtures.
5. Prefer a small PR affecting only that component; check `vercel.json`, API contracts and shared assets for knock-on effects.
6. Verify preview using authorised accounts and *synthetic data*. Never send real test emails/transfers or publish live articles without explicit approval.
7. Confirm rollback path (known-good commit/deployment) before release.

## Post-deploy verification by area

| Change area | Minimum relevant check |
|---|---|
| Public marketing | Homepage at desktop/mobile, navigation/anchors, legal/regulatory wording reviewed |
| Forms | Validation, consent, abuse protection, delivery to correct mailbox (authorised test) |
| Insights | Authentication, edit/preview/publish/unpublish on a nonproduction branch, article/sitemap consistency |
| Sales Tracker | Access, read/write persistence and stage routing with synthetic records |
| Pricing | Access, calculations, document render and export using synthetic inputs |
| Management reporting | Run [regression suite](../managementreport/tests/README.md); use Finance-approved external reconciliation where required |
| Wire transfer | Run [synthetic harness](../internal/wire-transfer/tests/run.js); verify no unintended submission or leakage |
| Onboarding | Check download/link correctness and compliance-approved requirements |
| Analytics | Consent behaviour, expected events, no real-data leakage, reporting template consistency |
| Routing | HTTP redirects, cache headers, noindex directives, and no change to online-banking portal |

## Security distinctions

- `robots.txt` and `X-Robots-Tag: noindex` discourage search indexing; neither protects sensitive routes.
- `Cache-Control: no-store` limits caching; it does not authenticate a user.
- Both front-end routes and serverless APIs need server-side access validation appropriate to their data.
- Several `vercel.json` headers are scoped to specific exact routes; **verify effective headers on nested paths and API responses**, not only on landing pages.
- A public repository must not contain credentials, personal information or real finance/client documents. Existing PDF/downloads and `managementreport/website-analytics/data.json` merit explicit data classification and release review.
- The existing `insights/ADMIN.md` refers to a specific historical preview branch/PR. Treat those branch values as **HISTORICAL**, not current operational instructions.

## Environments and secrets

Do not publish live values. Env **names** and deployment scope should be confirmed in Vercel:
- Forms: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `FORM_FROM_EMAIL`, `FORM_TO_EMAIL`, `ALLOWED_ORIGIN`.
- Insights: `INSIGHTS_ADMIN_PASSWORD`, `INSIGHTS_SESSION_SECRET`, `INSIGHTS_GITHUB_TOKEN`, `INSIGHTS_GITHUB_BRANCH`.
- Additional API secrets and storage configuration: **inventory against serverless code and Vercel settings before documenting**.
- Production and Preview should use separate appropriately scoped credentials/branches.

## Incident response

If an internal tool, exposure, or deployment fails: stop further changes, preserve the relevant time/commit/request IDs (redacted), notify the authorised owner, evaluate whether to roll back, and verify containment. Do not force-push, rotate secrets, modify access, or delete logs without an approved incident procedure.

## Documentation ownership

Keep [the inventory](PLATFORM-INVENTORY.md) and [verification backlog](VERIFICATION-BACKLOG.md) updated in the same PR as changes to website routes, APIs, access control or document templates.
