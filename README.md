# ARIE Finance Website — Production Deployment

This folder is the deployable Vercel project root.

## Files

```text
index.html
package.json
package-lock.json
api/
  website-form.js
```

The public website is a bundled single-file site. The approved page template, image manifest and bundler runtime have not been changed in this final backend-hardening pass.

## Runtime

- Node.js: `24.x`
- Vercel Function route: `POST /api/website-form`
- Email delivery: Nodemailer over SMTP

## Required environment variables

Set these in **Vercel → Project → Settings → Environment Variables**:

```text
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
FORM_FROM_EMAIL
FORM_TO_EMAIL=customercare@ariefinance.com
ALLOWED_ORIGIN=https://ariefinance.com,https://www.ariefinance.com
```

Optional for local development only:

```text
ALLOW_LOCAL_ORIGINS=true
```

Never place SMTP credentials in `index.html`, client-side JavaScript, source control or public logs.

## Deployment

Deploy the contents of this `production/` folder as the Vercel project root.

### Vercel dashboard

1. Create/import a Vercel project.
2. Set the project Root Directory to `production` if uploading the parent package.
3. Add all required environment variables.
4. Deploy.
5. Confirm the website and `/api/website-form` are served from the same origin.

### Vercel CLI

```bash
cd production
npm ci
vercel
```


## External login destination

The header **Log in** button opens the approved online-banking portal in a new tab:

```text
https://online.ariefinance.com/online-banking
```

The `online.ariefinance.com` DNS record is separate from the public website and must be preserved during the website DNS cutover.

## Deployment checklist

Follow the root-level `DEPLOYMENT-CHECKLIST.md` before changing the public domain.

## Form controls

The server accepts only `contact` and `careers` submissions and enforces:

- POST-only and production-origin allow-list
- required fields, length limits, email validation and explicit consent
- honeypot protection
- best-effort in-memory rate limiting and duplicate protection
- HTML escaping and header-injection protection
- success only after SMTP confirms `sendMail()`
- pending → delivered deduplication lifecycle; failed sends remain retryable
- 3 MB maximum raw CV size
- PDF, DOC and DOCX allow-list with signature checks
- strict canonical base64 validation and declared-size verification
- genuine DOCX OOXML validation using the ZIP central directory and XML parsing

For DOCX, the handler requires and validates:

- `[Content_Types].xml` with the exact `/word/document.xml` WordprocessingML override
- `_rels/.rels` with an internal office-document relationship targeting `word/document.xml`
- a well-formed `word/document.xml` with the WordprocessingML document namespace and body
- no DTD or entity declarations
- no encrypted, corrupted, traversal, symlink or zip-bomb content

No uploaded file is extracted to disk or retained after the email send attempt.

## Rate limiting and deduplication

The included stores are in-memory and therefore best-effort on serverless infrastructure. They reset on cold start and are not shared across instances.

For cross-instance enforcement, replace the Maps with Vercel KV or Upstash Redis using atomic operations.

## Verification

From the package root:

```bash
cd production
npm ci
node ../tests/validate.test.cjs
node ../tests/backend.test.cjs
npm audit --omit=dev
```

The included tests use mocked SMTP; they do not send live email.

## Mandatory live release test

After deployment and SMTP configuration:

1. Submit one Contact enquiry and confirm receipt at `customercare@ariefinance.com`.
2. Submit one Careers application with a genuine PDF or DOCX and confirm the attachment arrives.
3. Force an SMTP failure or temporarily use invalid credentials and confirm the website shows an error rather than success.
4. Retry the same failed submission and confirm it remains retryable.
5. Submit the same successful form again and confirm the duplicate response reflects an earlier confirmed delivery.

Live SMTP delivery remains unverified until these steps are completed in the deployed environment.
