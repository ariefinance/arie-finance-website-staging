# ARIE Insights Publisher — setup and operation

The password-protected Publisher at `/insights/admin/` lets authorized staff
create, edit and unpublish articles in the browser. GitHub stores the static
articles and ordered index; Vercel deploys the resulting commit. There is no CMS
database or separate publishing site.

For publication from an explicitly approved ChatGPT draft, use the single
[pilot procedure](PUBLISHING.md). It shares the Publisher's sanitizer and renderer.
The weekly drafting task does not publish. The browser workflow below remains
available for staff and for approved corrections or withdrawal.

## Staff workflow

1. Open the correct site's `/insights/admin/` and sign in with the admin password.
   Enter the password only in that login form, never in a ChatGPT prompt.
2. Select **+ New article**. Complete **Article title**, **Category**, **Short
   summary** and **Article content**. The summary limit is 400 characters; the
   categories are Guides, Updates and ARIE News. The server derives the URL from
   the title; there is no slug field in the writer UI.
3. Paste the internally approved copy and use **Preview** to check it. Preview
   does not publish or save a durable draft. Keep the source draft in its private
   location; do not rely on an open browser tab as the only copy.
4. Confirm **I confirm this article has completed ARIE's internal review and is
   approved for publication**, then select **Publish article**.
5. The success screen confirms the publishing request completed. Wait for the
   deployment and check the live article, canonical URL, `/insights/`, homepage
   highlights and sitemap before describing it as live or sharing it. Use the
   [production verification rule](PUBLISHING.md#production-verification) for the
   ChatGPT pilot.

The UI does not offer image uploads, image-URL fields, author fields or a table
builder. Backend image support is not a writer control. Existing article images
are preserved on normal UI updates. Put approved, truthful contributor/reviewer
attribution in the article body when needed. Supported pasted table markup can
render, but preview the result.

### Correct or withdraw an existing article

- **Edit** loads a published article. Obtain approval for the corrected copy,
  preview it, confirm internal review and select **Update article**. Its URL and
  original publication date remain unchanged.
- For a genuine later review of a Guide, the optional **Record this update as an
  editorial review today** checkbox sets **Last reviewed** only when that date
  is later than publication. Do not tick it merely to make an article look fresh.
- **Unpublish** removes the article and its listing entries. Previously shared
  article links stop working. Use it only for an authorized withdrawal.
- Staff corrections and withdrawal do not delete or rewrite a pilot receipt.
  A retry checks the current article and manifest against that receipt and does
  not overwrite an edit or restore a withdrawn article.

### Sharing controls

After the article is verified live, **Email** opens the single-article helper;
**Create Insights Update** prepares a combined email for 2–4 published articles;
**LinkedIn** prepares text and opens LinkedIn for manual sharing. These controls
do not send email or post to LinkedIn. Sending to clients and social posting need
their own authorized process; an article publication approval does not authorize
either action. The weekly task's review email is a separate existing workflow.

## Configuration

Set environment values in Vercel, never in source or review files:

| Variable | Purpose |
|---|---|
| `INSIGHTS_ADMIN_PASSWORD` | Strong password used by staff to sign in. |
| `INSIGHTS_SESSION_SECRET` | Random secret of at least 32 bytes for signed sessions. |
| `INSIGHTS_GITHUB_TOKEN` | Fine-grained GitHub token scoped to this repository with Contents read/write permission. |
| `INSIGHTS_GITHUB_BRANCH` | Explicit destination branch for the deployed Publisher. |

The Publisher writes to the configured branch; it does not assume `main`.
Confirm that the production deployment targets the approved production branch
and that any Preview environment targets its intended branch. The PR #40 branch
example in earlier versions of this guide is historical, not a current setup
instruction. Never test by publishing a dummy article to production.

## Atomic publishing and conflicts

Publish, update and unpublish rebuild the affected article, ordered manifest
(`insights/_articles.json`), listing, homepage highlights and sitemap in one Git
commit. The approved-draft pilot also records its minimal technical receipt in
the same commit. Article content is rendered using the existing Publisher
renderer, not hand-built from the developer template.

Read the source files at the captured branch commit. Advance the branch without
force-pushing; a concurrent change is a conflict, not permission to overwrite
the new head. Inspect the current receipt and article before deciding whether
another write is needed. A failed or delayed Vercel deployment after a successful
commit calls for verification/recovery of that commit, not a duplicate article.

The first approved article restores the previously hidden Insights navigation
with the publication change. Installing the pilot code does not make that link
visible or publish any article.

## Security and operational limits

- The server checks the admin password, signs the session cookie and keeps the
  GitHub token server-side. Sessions use HttpOnly, SameSite=Strict cookies, with
  Secure on HTTPS and an approximately eight-hour lifetime.
- State-changing API calls require an authenticated session and same-origin
  checks. HTML is sanitized server-side to the supported content allowlist;
  scripts, style/event attributes, iframes and unsafe URLs are removed.
- Slugs are validated. Admin, template, email-helper and API paths are excluded
  from the sitemap and have indexing/cache controls appropriate to their use.
  Indexing directives are not a substitute for authentication.
- Do not commit private drafts, source workbooks, approval conversation links,
  personal approval evidence, credentials or email content. The repository may
  be public. Keep only the minimal receipt fields produced by the pilot.
- Configuration presence and a visible login page do not prove token scope,
  branch access or successful end-to-end publication. Establish those through
  the first real approved article, then retain its verification evidence
  privately.
