# ARIE Insights — editorial operation

**Public listing:** `/insights/`. **Admin:** `/insights/admin/`. **API:** `/api/insights/*`. **Reviewed:** 26 October 2026 (code and existing guides).

## Features
Article listing; article templates; authenticated browser editor; create, edit, preview and unpublish operations; automatic Git commits rebuilding article files, homepage highlights, listing and sitemap; email formatting helper.

## Editorial process
Obtain editorial/compliance approval, open the authorised publisher, preview the content, confirm publication, then verify public pages and links. Use the email helper to copy formatted article summaries into an approved mail client. The helper does not send emails.

## Technical references
- [Admin and publisher](../../insights/ADMIN.md) — configuration, permissions, publishing internals.
- [Manual publishing reference](../../insights/PUBLISHING.md) — historical instructions; do not treat as the current default workflow.
- The PR #40 branch example in the original admin guide is **historical**; verify the environment's actual publishing branch before use.
- Publishing uses a Git token and session control; never include their values in documentation.

**Unverified:** current editor deployment status, publication permissions and configured publishing branch.
