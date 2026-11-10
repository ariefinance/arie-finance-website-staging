# Check Your Eligibility

**Page:** `/#eligibility`. All eight application CTAs ("Check Your Eligibility"; mobile header "Eligibility") open it. **Sources:** `index.html` (eligibility section and script), `api/eligibility.js`, `api/_lib/eligibility-rules.js`, `api/website-form.js` (`eligibility_review`). **Tests:** `npm test` (`tests/eligibility.test.js`).

## Flow
- **May continue:** Check your eligibility → Preliminary result → Indicative pricing → **Continue to onboarding requirements** (`https://www.ariefinance.com/onboarding-requirements`). Nothing is sent to ARIE on this path.
  - *Standard* result: "You may proceed to document preparation".
  - *Higher-risk, may continue* result: "You may continue — further review required".
- **On hold:** Preliminary result "Your business requires further review" → **Contact ARIE for Further Review**.
  - Sends the answers and contact details to the customer-care inbox through the existing form handler.
  - There is no pricing or requirements link. ARIE decides whether the applicant can continue.
- **Never shown:** a customer-facing "cannot proceed". v0.9's restricted-activity stop is shown as hold, and mandatory prohibitions are applied in ARIE's internal compliance process.
- **Not an application:** every result says it is not account approval or an application. No reference numbers are issued, because nothing is stored.

## Rules
- **Where they run:** v0.9's rules (questions, risk signals, hold conditions) run **server-side only** in `api/_lib/eligibility-rules.js`. The browser receives only `standard`, `continue_review` or `hold`, or the country-specific follow-up questions. Risk lists, reasons and scores never reach the page.
- **Single source:** this module is the only copy of the website rules. RegMind exposes no eligibility service this site can call (none is documented in this repository). If an approved service becomes available, replace `evaluate()` with a call to it and delete the lists.
- **Updating:** any list change needs Compliance approval. Update the module and run `npm test`.

## Further Review email
- **Subject:** `ARIE Eligibility — Further Review — <company> — <name>`. Reply-To is the applicant.
- **Body:** the server-recomputed route, internal flags, all answers, contact details, consent, the policy version and a triage line.
- **Protections:** the same as Contact (origin allow-list, rate limit, honeypot, duplicate guard). Success is shown only after SMTP accepts the message.

## Indicative pricing
`ELIGIBILITY_PRICING` in the eligibility script is `null`, so the pricing step shows that the fee schedule is being finalised and goes on to the requirements page. After management approves the figures, set the profiles there. The figures appear only on the pricing step, always marked non-binding.

## Before go-live
- Management decision on the pricing figures (optional for launch; the step works without them).
- Compliance approval of the rules and wording.
- A **real delivery test**: send one clearly labelled test Further Review from the preview or production, and confirm it arrives in the customer-care inbox with all answers.
- A named owner for Further Review requests.
