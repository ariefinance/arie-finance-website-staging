# Public website, contact and careers

**Pages:** `/`, `/services`, `/introducers`, `/eligibility` and remaining navigation anchors. **Sources:** `index.html`, `api/marketing-page.js`, `api/eligibility-page.js`, `api/website-form.js`, `vercel.json`. **Routing updated:** 12 November 2026.

## Features
Public company/service information, sections for different audiences, About/Team, Contact and Careers, compliance information, links to Insights and external online banking. Contact and Careers submissions are handled by an SMTP-backed serverless form endpoint with input validation and file restrictions.

## Editing
The marketing site uses one maintained HTML template. `api/marketing-page.js` serves Services and Introducers with distinct metadata and the correct section already visible in the HTML response. It accepts only the configured route names. The browser router keeps normal navigation, legacy hashes, metadata and back/forward behaviour consistent. The existing eligibility handler remains separate. Other redirects in `vercel.json` still map legacy paths to homepage anchors. The online-banking portal is a different system and must not be changed through this repository.

## Release checks
Obtain copy/regulatory approval, inspect desktop/mobile layouts and links, verify form handling using approved synthetic tests and check redirect/indexing rules. Do not commit customer or applicant documents.

**Unverified:** current form deliverability, live configuration and content approver.

**Feedback:** the Leave Your Feedback page emails the customer-care inbox through `api/website-form.js`; see [FEEDBACK.md](FEEDBACK.md).

## SEO route release — 12 November 2026

- **Purpose:** make the existing international-payment and management-company propositions independently discoverable in search, while retaining the existing design and enquiry journeys.
- **Changes:** Mauritius-related homepage metadata and factual Organization structured data; visible server-rendered Services and Introducers entries with distinct metadata; real internal links; sitemap entries for those pages and the existing eligibility route. Services has a descriptive heading and its introduction identifies the Mauritius-based team.
- **Compatibility:** previous hash URLs, native section anchors, browser Back/Forward, eligibility history and clean sharing URLs remain supported. Route-aware analytics identify visits to the new paths. The Insights publisher accepts both old and root-relative footer anchors; no article is published by this change.
- **Automated checks:** all 69 tests passed before the preview release, including route rendering, navigation/history, analytics, eligibility, form handling with mocked transport, and publishing compatibility. Browser preview and production results are recorded in the associated pull request.
- **Release baseline/rollback:** previous production commit `03a67b79f7e592e7ee1e75cee1a7dbf3d3340f37`, Vercel deployment `dpl_JAXVtXjj9nyUwiMCRxHNfGdNywGr`. No DNS, credentials, portal, pricing or licence changes are part of this release.
- **Measurement:** track non-brand search impressions/clicks and enquiries by landing page. Google already has `/sitemap.xml` registered. Its next crawl and indexing are external outcomes; deployment does not demonstrate a ranking improvement.

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
