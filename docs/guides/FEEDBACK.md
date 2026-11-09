# Leave Your Feedback

**Page:** `/#feedback` · **API:** `GET|POST /api/feedback` ([api/feedback.js](../../api/feedback.js)) · **Recovery tool:** [scripts/feedback-records.js](../../scripts/feedback-records.js) · **Tests:** `npm test`

## Status: built, inactive until approved
The page and API ship switched off. `GET /api/feedback` reports `enabled:false` while any required variable is missing. While it is off:
- the footer, Contact and client-quotes "Leave Your Feedback" links stay hidden;
- `/#feedback` shows a fallback pointing to the contact form, email and phone;
- `POST` returns `503`.

The signed-out portal page links "Tell us more" to `/#feedback`, so it falls back gracefully too.

## How it works
1. **Validation.** Checks the category (Suggestion, Service experience or Compliment) and the message length (10–4000 characters). Name and email are optional, but both are required when "Handle this as a formal complaint" is ticked.
2. **Abuse controls.** A honeypot field, the origin allow-list (`ALLOWED_ORIGIN`, required), and a shared rate limit of 5 per 10 minutes per connection (only a keyed hash of the IP is stored, with a short TTL). An identical resubmission within 10 minutes returns the same reference. A resubmission that adds the complaint flag, a name or a colleague is treated as new.
3. **Durable record first.** A unique reference `FB-YYMMDD-XXXXXX` is reserved with `SET NX` in a dedicated Upstash database.
   - **Stored in plain text:** the category, the complaint flag, `createdAt` (never changed) and an append-only `events[]`.
   - **Encrypted (AES-256-GCM):** the message, the colleague named, the name and the email.
   - **Expiry:** records and the index expire after `FEEDBACK_RETENTION_DAYS`; the rate-limit and duplicate keys expire after 10 minutes.
   - **Separation:** keys are namespaced by `VERCEL_ENV`, so preview and production never collide.
   - The visitor sees a confirmation and reference **only after** this succeeds. Once the record exists, a failed index or duplicate-check write never turns the submission into a failure; the recovery tool also scans for records missing from the index.
4. **Notification.** An email goes to `FEEDBACK_TO_EMAIL`, with the subject `[Feedback] <category> — <ref> — <name|Anonymous>`.
   - **Complaint flag ticked:** the subject begins `[COMPLAINT]` and `COMPLAINTS_TO_EMAIL` is copied.
   - **Backup owner:** `FEEDBACK_CC_EMAIL` (optional) is copied on every message.
   - **Outcome:** recorded in the record's `events[]` as `notified` or `notification_failed`.
   - **If the email fails:** the record stays recoverable (`node scripts/feedback-records.js list --failed`).
5. **Complaints.** The category never decides whether something is a complaint. Every notification tells the owner to assess any expression of dissatisfaction against the Complaints Procedure and to log qualifying messages in the complaints register. The checkbox adds requirements; it is not a separate process.
6. **Sensitive data.** Visitors are asked not to include account numbers, payment details or identity documents. Text that looks like a card number or IBAN is flagged in the email, not rejected.

## Activation checklist (all required)
| Decision / setting | Variable | Owner |
|---|---|---|
| Feedback owner and monitored inbox | `FEEDBACK_TO_EMAIL` | Management |
| Complaints handler / escalation address | `COMPLAINTS_TO_EMAIL` | Compliance |
| Backup owner or cover (optional but recommended) | `FEEDBACK_CC_EMAIL` | Management |
| Approved retention period (days) | `FEEDBACK_RETENTION_DAYS` | Compliance |
| Dedicated Upstash database (not the shared internal-tools DB; the API refuses to enable if the URL matches it) | `FEEDBACK_REDIS_REST_URL`, `FEEDBACK_REDIS_REST_TOKEN` | IT |
| Origin allow-list (shared with Contact/Careers) | `ALLOWED_ORIGIN` | IT |
| Encryption key (`openssl rand -base64 32`), held in Vercel and in a password vault by named recovery holders only | `FEEDBACK_ENCRYPTION_KEY` | IT |
| Named staff authorised to run the recovery tool (with a read-only Upstash token for `list`/`show`) | — | Management |
| Privacy Policy covers feedback data and retention | — | Compliance |
| Database backup and point-in-time restore confirmed on the Upstash plan | — | IT |
| Switch on | `FEEDBACK_ENABLED=true` | Management |

After activation:
- Submit one fictional test from the production site to a test inbox first.
- Check the record with `scripts/feedback-records.js show <ref>`.
- Then set the real recipients.

Never send test messages to clients.

## Operating notes
- **Complaints retention.** Records expire after the retention period, counted from submission. At triage, any message that qualifies as a complaint must be entered in the complaints register, which has its own retention. Don't rely on the feedback record as the complaints file.
- **History integrity.** `createdAt` and earlier events are never changed by the API or the recovery tool, and `mark` stamps the acting staff member (`FEEDBACK_ACTOR`). Anyone holding a read-write token could still alter records, so limit read-write tokens to the API and the named holders.
- **Triage events.** Record triage with `node scripts/feedback-records.js mark <ref> triaged|complaint_logged|replied "<note>"`. Events are append-only.
- **Key rotation.** Rotating `FEEDBACK_ENCRYPTION_KEY` makes older records unreadable. Export the records before rotating.
- **Deletion requests.** Delete the record key `feedback:<env>:rec:<ref>` in the Upstash console, then note it in the complaints or privacy log as required.
