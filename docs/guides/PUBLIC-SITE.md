# Public website, contact and careers

**Pages:** `/` and navigation anchors. **Sources:** `index.html`, `api/website-form.js`, `vercel.json`. **Reviewed:** 26 October 2026 (repository inventory).

## Features
Public company/service information, sections for different audiences, About/Team, Contact and Careers, compliance information, links to Insights and external online banking. Contact and Careers submissions are handled by an SMTP-backed serverless form endpoint with input validation and file restrictions.

## Editing
The marketing site is a bundled single-file HTML/template. Changes require careful verification of the template structure and encoded content. Redirects in `vercel.json` map old paths to page anchors; they are not independent landing pages. The online-banking portal is a different system and must not be changed through this repository.

## Release checks
Obtain copy/regulatory approval, inspect desktop/mobile layouts and links, verify form handling using approved synthetic tests and check redirect/indexing rules. Do not commit customer or applicant documents.

**Unverified:** current form deliverability, live configuration and content approver.

**Feedback:** the Leave Your Feedback page emails the customer-care inbox through `api/website-form.js`; see [FEEDBACK.md](FEEDBACK.md).

## Release record — final website refinements (11 November 2026)
- **PR:** [#68](https://github.com/ariefinance/arie-finance-website-staging/pull/68), reviewed head `afbf7e0`, merged as `a5faf94`.
- **Production:** Vercel deployment `dpl_AXRBvjDyR5ReRqyzfw85EFyxcVTJ`, READY; www.ariefinance.com serves the merged build.
- **Six completed refinements:**
  1. Homepage "Who we serve" cards link to Direct Clients (Cross-border businesses, Family offices) or Introducers (Professional intermediaries, Introducers & partners), with subtle hover and keyboard-focus states.
  2. Homepage team-photo caption is a "Meet the team →" link to the Team page; the gold "Speak with our team" CTA is unchanged.
  3. "Share your experience →" below the homepage testimonials links to Leave Feedback.
  4. Introducers page: secondary "Share our eligibility check with a client →" link to `https://www.ariefinance.com/eligibility` (no tracking parameters).
  5. Contact sidebar: the "Leave Your Feedback" arrow no longer wraps.
  6. Services: Payment Accounts added as service 01 with the approved homepage description (services renumbered 01–05); footnote corrected to "Corporate Payment Desk scope".
- **Production tests (desktop 1440 and mobile 390):** six changes 57/57; eligibility navigation 40/40; eligibility, forms and navigation regression 45/45; Share button returns the clean `/eligibility` URL for all four methods. Form submissions were intercepted in testing, so no emails were sent.
- **Unresolved defects:** none.
- **Status:** the website visual-polish exercise is complete. Future website work should be driven by enquiry, referral and conversion data, not further cosmetic changes.
- **Open content decision (management, outside this release):** the team photograph shows eight people; Meet the Team has six profiles.
