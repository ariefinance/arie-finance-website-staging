# Leave Your Feedback

**Page:** `/#feedback` · **API:** `POST /api/website-form` with `form: "feedback"` ([api/website-form.js](../../api/website-form.js)) · **Tests:** `npm test`

## How it works (email-first)
- **Form fields:** Name, Email, Feedback type (Suggestion, Service experience or Compliment) and Message. All are required.
- **Handling:** submissions go through the same handler, validation, honeypot, origin allow-list, rate limit and duplicate check as the Contact form.
- **Delivery:** feedback is emailed to the existing monitored inbox (`FORM_TO_EMAIL`, customercare@) with the subject `ARIE Finance Feedback (<type>) — <name>`. Reply-To is set to the visitor.
- **Confirmation:** the visitor sees it only after the SMTP server accepts the message. If delivery fails, they are asked to retry or email customercare@.
- **Complaints:** the form states that feedback expressing dissatisfaction is reviewed in accordance with the existing Complaints Procedure (linked). Every feedback email includes a triage line asking the reader to assess any expression of dissatisfaction against that procedure, whatever type was chosen. There is no separate complaints process.
- **Storage:** there is no separate database or storage service. The customer-care mailbox is the record, as it is for Contact enquiries.

## Entry points
- Footer (Company list)
- Contact page side card
- The line under the homepage client quotes
- The signed-out portal page's "Tell us more" link

There is no top-level navigation item.

## Possible later stage
A dedicated feedback-management system, with references, a separate record store and complaint routing, can be added later as a separate decision.

## Release record
- **Released:** 10 November 2026, via PR #57 (merge commit `b10638c`; approved head `815f885`).
- **What went live:**
  - Why ARIE human-led section with the team photo and "What our clients say about us" button
  - Contact dropdown (Get in Touch / Careers)
  - Boardroom illustration in the Careers header, with honest alt text (hidden on phones)
  - Leave Your Feedback page and its four entry points, emailing the customer-care inbox through `api/website-form.js`
- **Live checks (10 November 2026, desktop and mobile):** all passed. They covered:
  - Why ARIE and the Contact dropdown
  - Careers and the hidden phone illustration
  - Feedback page, its fields and entry links
  - Contact form validation (nothing sent)
  - Cookie consent and the onboarding links
  - No MUR claim
  - No horizontal overflow and no page errors
- **Feedback email test:** one TEST ONLY submission was sent from the live form at 05:04:23 UTC: name "ARIE Website Test", email website-test@example.com, type Suggestion. The site confirmed it, and the handler returned `ok:true`, so SMTP accepted the message.
  - **Inbox receipt: unverified.** The verifying account has no access to the customer-care mailbox.
  - A customer-care mailbox holder should confirm receipt of `ARIE Finance Feedback (Suggestion) — ARIE Website Test` and record the result here.
