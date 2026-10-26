# Documentation and operational verification backlog

**As of:** 26 October 2026. This is a factual follow-up register, not a claim that systems are defective. Findings reflect the repository and documentation, not an authenticated live runtime audit.

| Priority | Finding | Action/acceptance |
|---|---|---|
| P0 | Previous root README inaccurately says the repository has only public website files and one API, while multiple internal/operational apps are present. | Replace with central documentation hub and inventory. **Addressed in this documentation PR.** |
| P0 | Internal paths have `noindex` / `no-store` headers, but those are not access controls. | Verify authentication and authorisation on **each** app and corresponding API, plus direct requests to nested assets. Do not claim secure until tested. |
| P0 | Public repository includes deployable internal tools and downloadable document assets. | Security/data classification review of any embedded values, default templates, sample reports and public files. Do not commit real data. |
| P1 | `insights/ADMIN.md` prescribes a PR #40 testing branch; this may be obsolete. | Confirm current publisher branch/env settings, then update historical examples without breaking the working workflow. |
| P1 | `insights/PUBLISHING.md` describes manual article-file publishing, while `insights/ADMIN.md` describes a browser publisher. | Confirm authoritative workflow; label manual instructions as fallback/legacy only if approved, then reconcile. |
| P1 | Existing website analytics README says `data.json` is not committed; `managementreport/website-analytics/data.json` exists in the git tree. | Inspect contents/classification, decide whether file is approved sample or needs removal. Do not delete without owner approval. |
| P1 | Existing README says 14 redirects while `vercel.json` contains 16 entries. | Inventory now defers to `vercel.json`; recheck route inventory on every routing change. |
| P1 | No complete operator guides in-repo for Sales Tracker, onboarding requirements, pricing and logout. | Write guides with screenshots, permissions, inputs, workflow, errors and escalation after live owner walkthrough. |
| P1 | No central matrix of component owner, access tier, data destination, support channel and recovery owner. | Management to assign each row in platform inventory; avoid guessed names. |
| P1 | Current Vercel project/production branch/DNS and SMTP/Redis config live outside GitHub. | Read-only verification by authorised operator; document redacted settings and rollback. |
| P2 | Documentation references testing outcomes and dates from earlier phases. | Revalidate against current commit and preserve evidence as historical, not evergreen PASS claims. |
| P2 | Public landing page bundled in a single large `index.html` file. | Document exact safe-edit method and smoke test; do not refactor site merely to improve documentation. |

### Completion standards

Each item is closed only with a link to the verifying PR, source, or redacted acceptance record, owner and verification date. Never mark security or production status verified solely because documentation says so.
