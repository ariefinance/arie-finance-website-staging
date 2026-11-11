# ARIE Insights — editorial operation

**Public listing:** `/insights/`. **Staff Publisher:** `/insights/admin/`.
**API:** `/api/insights/*`. The existing static pages, design and human-led
positioning remain the publication surface.

## Drafting and approval

The weekly ChatGPT task prepares drafts only. Before its review email is sent,
save the draft and its supporting material in durable private files: article ID,
version, sanitized publication fields, content hash, sources and coverage cutoff.
Keep internal commentary, approval records and private file links out of this
repository. The repository may be public.

Use the Digest as a topic lead, then check current primary sources and add useful
ARIE explanation. Retain the existing factual, copyright, confidentiality and
editorial/compliance checks. Attribute a contributor or reviewer only after that
person has actually contributed or reviewed. Preserve genuine publication and
review dates; do not imply that these practices guarantee AI citations.

Ismael reviews the exact prepared version and, once the required internal review
is complete, can instruct the live ChatGPT conversation:

> Approve ARIE-INSIGHTS-20261113-01/v1 for publication

Use the actual ID/version shown with the draft. This instruction starts the
publication tools in that same conversation turn. It does not create a background
watcher or change the weekly task into a publisher. A content hash verifies which
copy is being used; it is not consent. A material change needs a new version and
approval of that version.

## Publication and completion

The bounded pilot uses `scripts/insights-pilot.js` to prepare, plan, format the
atomic write and verify; the existing connected GitHub tools perform the write. It uses the same
sanitizer and article renderer as the staff Publisher. It creates approved new
articles only. Later corrections and withdrawal use the existing staff Publisher.

Before any retry, inspect the publication receipt and current article. Do not
re-create an article that a person has edited or withdrawn. If the Git commit
succeeded but deployment is delayed or failed, resume deployment verification
instead of publishing again.

Report an article as live only after the production deployment is ready at the
publication commit, or a proven descendant containing it, and the public article,
canonical URL, listing and sitemap have been checked. A Git commit or the
Publisher's success screen alone is not this evidence.

## Navigation

The Insights link is hidden while the initial listing is empty. The first
approved article publication restores the header and footer links as part of the
same publication change. Do not restore navigation when installing the pilot or
create a dummy public article to test it.

## References

- [Pilot publishing procedure](../../insights/PUBLISHING.md) — private draft,
  live approval, one atomic write, retry handling and production verification.
- [Staff Publisher](../../insights/ADMIN.md) — current browser controls, setup,
  editing and withdrawal.

The old PR #40 preview branch is historical. Confirm the actual destination
branch and deployment before operational use. No password or token belongs in a
draft, an approval prompt or this documentation. End-to-end publication is not
proved by deployment of the pilot code; verify the first genuinely approved
article through the procedure above.
