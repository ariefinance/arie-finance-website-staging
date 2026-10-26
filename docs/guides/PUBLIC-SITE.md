# Public website, contact and careers

**Pages:** `/` and navigation anchors. **Sources:** `index.html`, `api/website-form.js`, `vercel.json`. **Reviewed:** 26 October 2026 (repository inventory).

## Features
Public company/service information, sections for different audiences, About/Team, Contact and Careers, compliance information, links to Insights and external online banking. Contact and Careers submissions are handled by an SMTP-backed serverless form endpoint with input validation and file restrictions.

## Editing
The marketing site is a bundled single-file HTML/template. Changes require careful verification of the template structure and encoded content. Redirects in `vercel.json` map old paths to page anchors; they are not independent landing pages. The online-banking portal is a different system and must not be changed through this repository.

## Release checks
Obtain copy/regulatory approval, inspect desktop/mobile layouts and links, verify form handling using approved synthetic tests and check redirect/indexing rules. Do not commit customer or applicant documents.

**Unverified:** current form deliverability, live configuration and content approver.
