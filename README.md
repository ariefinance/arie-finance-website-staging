# ARIE Finance — Website (Production)

Public marketing website for **ARIE Finance Ltd**, a Mauritius FSC-licensed Payment Intermediary Services provider (Licence No. GB25205028).

**Status: LIVE.** Served in production at **https://www.ariefinance.com** (apex `ariefinance.com` 308-redirects to `www`). Hosted on Vercel; deployed automatically from the `main` branch of this repository.

This README describes the repository exactly as it is. There is no `production/` subfolder, no `tests/` folder, and no separate deployment-checklist file — the repository root **is** the deployable Vercel project.

---

## Repository contents

```text
index.html            The entire public website (single bundled file, ~7.4 MB).
                      Site markup is a JSON-encoded template inside a
                      <script type="__bundler/template"> block; a loader parses
                      it and renders the document at runtime.
api/website-form.js   Vercel serverless function. Handles Contact and Careers
                      form submissions and sends email over SMTP.
vercel.json           URL redirects (14) + HTTP security headers (see below).
robots.txt            Allows all crawlers; points to the sitemap.
sitemap.xml           Single-URL sitemap for https://www.ariefinance.com/.
favicon.png           Site favicon.
og-image.png          Open Graph / social-share image.
package.json          Declares the nodemailer dependency and Node 24.x engine.
package-lock.json     Locked dependency tree.
README.md             This file.
.github/workflows/deploy.yml
                      GitHub Actions workflow that deploys to Vercel on every push.
.gitignore            Ignores .vercel/ and node_modules/.
```

That is the complete file list.

## Build & deploy

- **No build step / framework.** Vercel serves `index.html` and runs `api/website-form.js` on the same origin.
- **Production branch:** `main`. Deployment is driven by GitHub Actions (`.github/workflows/deploy.yml`), not by Vercel's Git integration: every push to `main` runs `vercel deploy --prod`; pushes to any other branch and pull requests produce a preview deployment (URL shown on the workflow run).
- **One-time setup:** add the repository secret `VERCEL_TOKEN` (Settings -> Secrets and variables -> Actions) with a token from https://vercel.com/account/tokens. The target Vercel org/project IDs are set as plain `env` values at the top of the workflow.
- **Deployment protection:** Standard — generated `*.vercel.app` preview URLs require login; the production custom domain is public.

## Routing (`vercel.json`)

**Redirects** — 14 legacy paths (from the previous Framer site) 308-redirect into single-page hash routes:

```text
/services /solutions                         -> /#services
/about                                       -> /#about
/contact /open-account                       -> /#contact
/team                                        -> /#team
/join                                        -> /#careers
/events                                      -> /#home
/terms /legal /privacy /cookie
/customer-security /faqs                      -> /#compliance
```

**Security headers** — applied to all routes `/(.*)`:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: SAMEORIGIN
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
```

HSTS is applied automatically by Vercel. No Content-Security-Policy is set (the bundled file uses inline scripts/styles; a CSP would need report-only testing first).

## Serverless form handler (`api/website-form.js`)

- **Runtime:** Node.js 24.x. **Route:** `POST /api/website-form`. **Email:** Nodemailer over SMTP.
- Accepts only `contact` and `careers`. Enforces: POST-only; server-side origin allow-list; required fields, length limits, email validation, explicit consent; honeypot; HTML-escaping and email-header-injection protection; best-effort in-memory rate limiting and duplicate protection; success only after SMTP confirms send.
- **CV upload (Careers):** 3 MB max; PDF/DOC/DOCX allow-list with magic-byte checks, strict base64 validation, and genuine DOCX OOXML structure validation (rejects DTD/entity/encrypted/traversal/symlink/zip-bomb). No file is written to disk or retained after the send attempt.
- Cross-instance rate limiting is enforced at the edge by a Vercel Firewall rule: `POST /api/website-form` limited to 10 requests per IP per 10 minutes (429 + 10-min block when exceeded).

### Required environment variables (Vercel -> Settings -> Environment Variables)

```text
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS            (secret)
FORM_FROM_EMAIL
FORM_TO_EMAIL        = customercare@ariefinance.com
ALLOWED_ORIGIN       = https://ariefinance.com,https://www.ariefinance.com
```

`ALLOW_LOCAL_ORIGINS` is NOT set in production (local-dev only). SMTP credentials must never appear in `index.html`, client-side JS, source control, or logs.

## External links

The header **Log in** button opens the online-banking portal in a new tab: `https://online.ariefinance.com/online-banking`. `online.ariefinance.com` is a separate DNS record (Azure Front Door), independent of the website, and must not be altered during any website DNS change.

## DNS (reference)

Managed at OVH. Only two records point to the website:

```text
@   A     216.150.1.1
www CNAME 67a414678b5934c7.vercel-dns-017.com.
```

All email (Microsoft 365 MX/SPF/DKIM/DMARC), Teams, Resend (`notifications.*`) and `online.*` records are independent of the website and unaffected by website deploys.

## Editing the site

Content lives inside the JSON-encoded template string in `index.html`. To change copy/CSS: decode the template (JSON.parse the `__bundler/template` script contents), edit, re-encode (JSON.stringify, then escape `</` to `<\/` so the script does not close early), and commit `index.html` to `main`. Vercel redeploys automatically.

## Verification checklist (post-deploy)

1. https://www.ariefinance.com loads over valid HTTPS; `ariefinance.com` redirects to `www`.
2. Submit one Contact enquiry; confirm receipt at customercare@ariefinance.com.
3. Submit one Careers application with a real PDF/DOCX; confirm the attachment arrives and opens.
4. Confirm Microsoft 365 email and online.ariefinance.com still work.
5. Check the site at desktop / tablet / mobile widths.
