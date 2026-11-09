# Leave Your Feedback

**Page:** `/#feedback` · **API:** `POST /api/website-form` with `form: "feedback"` ([api/website-form.js](../../api/website-form.js)) · **Tests:** `npm test`

## How it works (email-first)
- **Form fields:** Name, Email, Feedback type (Suggestion, Service experience or Compliment) and Message. All are required.
- **Handling:** submissions go through the same handler, validation, honeypot, origin allow-list, rate limit and duplicate check as the Contact form.
- **Delivery:** feedback is emailed to the existing monitored inbox (`FORM_TO_EMAIL`, customercare@) with the subject `ARIE Finance Feedback (<type>) — <name>`. Reply-To is set to the visitor.
- **Confirmation:** the visitor sees it only after the SMTP server accepts the message. If delivery fails, they are asked to retry or email customercare@.
- **Complaints:** the form links to the existing Complaints Procedure. Every feedback email includes a triage line asking the reader to assess any expression of dissatisfaction against that procedure, whatever type was chosen. There is no separate complaints process.
- **Storage:** there is no separate database or storage service. The customer-care mailbox is the record, as it is for Contact enquiries.

## Entry points
- Footer (Company list)
- Contact page side card
- The line under the homepage client quotes
- The signed-out portal page's "Tell us more" link

There is no top-level navigation item.

## Possible later stage
A dedicated feedback-management system, with references, a separate record store and complaint routing, can be added later as a separate decision.
