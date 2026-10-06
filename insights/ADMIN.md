# ARIE Insights Publisher — setup & operation

A password-protected publisher that lets non-technical staff create, edit and
unpublish ARIE Insights articles from the browser. **No GitHub, HTML, Markdown,
folders, commits or Vercel knowledge required.**

```
/insights/admin/  →  password login  →  Publisher UI
      → /api/insights/* (server-side, authenticated)
      → GitHub Contents/Git API (one atomic commit)
      → static article files  →  Vercel redeploys automatically
```

No CMS, no database, no second app, no second Vercel project. GitHub is the
single source of truth; `insights/_articles.json` is the ordered index the
server rewrites in the same commit as each change.

---

## 1. Vercel environment variables (set by a human — never in source)

Vercel → Project (arie-finance-website-staging) → Settings → Environment Variables:

| Variable | What it is |
|---|---|
| `INSIGHTS_ADMIN_PASSWORD` | The one admin password staff type to sign in. Choose a strong passphrase. |
| `INSIGHTS_SESSION_SECRET` | Random secret used to sign session cookies. Use **32+ random bytes**, e.g. `openssl rand -hex 32` (64 hex chars) or `openssl rand -base64 32`. |
| `INSIGHTS_GITHUB_TOKEN` | Fine-grained GitHub PAT (see §2). Secret. |
| `INSIGHTS_GITHUB_BRANCH` | Branch the Publisher writes to (see §3). |

Do not commit any of these. Do not print the real values anywhere.

## 2. GitHub token (smallest useful permission)

Create a **fine-grained personal access token** scoped to **only**
`ariefinance/arie-finance-website-staging`, with repository permission:

- **Contents: Read and write**

Nothing else. No organisation-wide scope. Store it only as
`INSIGHTS_GITHUB_TOKEN` in Vercel.

## 3. Branch: preview now, production after merge

The Publisher writes to `INSIGHTS_GITHUB_BRANCH` and **never hardcodes `main`**.

- **Preview / PR #40 testing:** set `INSIGHTS_GITHUB_BRANCH=claude/fervent-allen-4oqir0`.
  The Publisher on the protected Vercel preview then creates Article #1 directly
  on the PR branch — production is untouched.
- **Production (after PR #40 is merged):** set `INSIGHTS_GITHUB_BRANCH=main`.
  From then on the production Publisher writes published articles to `main`.

Scope these as Preview vs Production environment values in Vercel so each
deployment targets the right branch.

---

## 4. Preview acceptance test (the real operational workflow)

1. Set the four env vars on the **Preview** environment (branch = the PR branch).
2. Open the protected preview: `https://<preview-host>/insights/admin/`
   (Vercel SSO/login gates the preview; then the admin password gates the Publisher).
3. Sign in with `INSIGHTS_ADMIN_PASSWORD`. A wrong password is rejected.
4. **New article** → paste compliance-approved Article #1 (title, category,
   summary, body). Slug auto-fills from the title.
5. **Preview** → confirm it looks right.
6. Tick the internal-review confirmation → **Publish**.
7. The Publisher commits to the PR branch; Vercel redeploys the preview. Open the
   returned article URL, `/insights/` and the homepage on the preview and confirm:
   - the article page is static and readable with **JavaScript disabled**;
   - it appears as the Latest Insight on `/insights/`;
   - the homepage “Latest Insights” block shows it;
   - `sitemap.xml` includes it.
8. **Prepare email** → opens the email helper prefilled; run the Outlook desktop /
   Outlook Web / Gmail paste tests.
9. Test **Edit** (original publication date is kept) and **Unpublish**.
10. When all pass, merge PR #40 and switch Production `INSIGHTS_GITHUB_BRANCH=main`.

---

## 5. What the Publisher does on Publish / Update / Unpublish

Each action is **one atomic commit** containing every affected file:

- `insights/<slug>/index.html` (created / updated / deleted)
- `insights/index.html` (listing — Latest Insight + chronological list rebuilt)
- `index.html` (homepage Latest-3 block rebuilt)
- `sitemap.xml` (article URLs rebuilt)
- `insights/_articles.json` (ordered index)

It reads the branch head first and commits against it without force-pushing, so a
concurrent change is reported as a conflict (“The website changed while you were
editing…”) rather than overwriting anything.

- **Publication date** is set automatically on first publish; **preserved** on update.
- **Last Reviewed** (Guides only) is never set automatically. On update, tick
  “Record this update as an editorial review today” to set it — and only if today
  is later than the publication date.

---

## 6. Security summary

- Admin password compared server-side in constant time; identical error for any
  failure (“Incorrect password.”). Best-effort login throttling.
- Stateless signed (HMAC) session cookie: HttpOnly, Secure, SameSite=Strict, ~8h.
- Every `/api/insights/*` state-changing call verifies the session and a
  same-origin check; the GitHub token never leaves the server.
- Article HTML is sanitised server-side to an allowlist (p, h2, h3, ul, ol, li,
  strong, em, a, blockquote, br, tables) — scripts, styles, event handlers,
  iframes and `javascript:` URLs are discarded.
- Slugs are validated (`a-z0-9` + single dashes), so path traversal is impossible.
- `/insights/admin/`, `/insights/_template/`, `/insights/_email-*.html` and
  `/api/insights/*` are `noindex`/`no-store` and excluded from the sitemap.

## 7. Known V1 limitation

- **Lead images are by URL, not upload.** Paste a full `https://` image URL (with
  alt text). Binary image upload through the Publisher is a later, bounded
  enhancement; the article template and OG tags already support an image URL.
- Tables render but the rich-text editor does not create them; they can be added
  later if needed.
