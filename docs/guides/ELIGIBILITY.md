# Check Your Eligibility

`/#eligibility` is the website implementation of the **ARIE Eligibility one-page prototype v0.9**. That prototype is the frozen reference: questions, options, wording, order, validation, results, the indicative pricing screen and the desktop/mobile layout all follow it. All eight "Check Your Eligibility" CTAs on the site open it.

## Flow (as v0.9)

1. **Intro**: "A clearer path to your onboarding." Three tiles: Screen, Review, Next step.
2. **One-page check**, in three sections:
   - **01 About your business**: country of incorporation and main sector.
   - **02 Business activities**: all 30 listed activities, searchable, with sector suggestions. Below the list: "None of the listed activities apply" or "I am not sure".
   - **03 Countries involved**: operations, UBO nationalities, incoming and outgoing payments (each with "Not sure"). Country-specific questions appear where relevant.
   - Optional company name and attestation.
3. **Preliminary assessment**:
   - `standard`: "You may proceed to document preparation".
   - `continue_review`: "You may continue — further review required".
   - `hold`: "Please contact ARIE for further assessment".
4. **Permitted results**: indicative pricing (when enabled), then **directly to https://www.ariefinance.com/onboarding-requirements**.
5. **On hold**: the "Contact ARIE Finance" button opens a short contact form. Answers and contact details are sent securely to ARIE for human review. Nothing else is available until ARIE responds.

## Deliberate differences from v0.9

- **Decisions are made server-side.** `api/_lib/eligibility-rules.js` (a port of v0.9's `determine`/`mayPrepare`) is called by `POST /api/eligibility`.
  - The browser receives only `{route}`, plus `notice:'restricted_country'` on hold. The notice exists only so v0.9's restricted-country sentence can be shown.
  - Risk levels, reasons and hold conditions never reach the browser.
  - Rate limit: 8 checks/minute and 30/hour per IP, shared via the existing Upstash Redis, with an in-memory fallback.
- **v0.9 "We cannot proceed at this stage"** (restricted activity) is shown as the on-hold result. This is the authorised "Contact ARIE; progression on hold" change.
- **On-hold "Contact ARIE Finance"** opens the secure Further Review form instead of an external link.
- **v0.9's hand-off screen is removed.** The requirements buttons link straight to `/onboarding-requirements`.
- **Removed:** demo bar, example-case controls, reviewer diagnostics, policy and rules version strings, and demo statements ("Only used to personalise this demonstration", "No information is transmitted or saved", "through this prototype").
  - "No information is transmitted or saved" is replaced by "Your answers are not saved unless you choose to contact ARIE". Answers are sent to the server to be evaluated, but not stored.

## Further Review email

- `form:'eligibility_review'` goes to `/api/website-form`, and on to `FORM_TO_EMAIL` (customercare@).
- The route is **re-computed on the server** from the submitted answers; any route the client claims is ignored.
- The email contains:
  - The route.
  - Internal flags.
  - Contact details and consent.
  - Every answer.
  - Policy and rules version.
  - Time and source URL.
- No reference number is shown, because nothing is stored that could be looked up.

## Indicative pricing

- The full v0.9 fee schedule is implemented unchanged: Standard and Enhanced profiles, SWIFT charges, the closure fee, the FSC licence line and the disclaimers.
- The v0.9 rules and fees were confirmed as approved by management on 10 Nov 2026, so `PRICING_PUBLIC_APPROVED = true` in `index.html`.
- If pricing ever needs to be withdrawn, set it to `false`. Production hosts (`ariefinance.com`) then skip the pricing screen and use v0.9's no-fees wording; previews and localhost still show it for review.

## Before go-live

- Run one labelled, fictional Further Review submission from the preview, and confirm it actually arrives in the customercare@ inbox with the full answers.

## Preview testing

On Vercel **preview** deployments only (`VERCEL_ENV=preview`), the form APIs also accept requests whose `Origin` is the deployment's own URL (`VERCEL_URL` / `VERCEL_BRANCH_URL`, set by Vercel). This lets branch previews be tested end to end. Production still accepts only `ALLOWED_ORIGIN`.

## Sharing and measurement (November 2026)
- **Shareable URL:** `https://www.ariefinance.com/eligibility`.
  - `api/eligibility-page.js` (via a `vercel.json` rewrite) serves the normal site with its own title, description and preview image (`assets/og-eligibility.jpg`, 1200×630).
  - A one-line script then adds `#eligibility`, so the checker opens directly.
  - There is no redirect, so the referrer and UTM parameters survive.
- **Share action** on the intro screen:
  - Uses the device's native share sheet where available.
  - Otherwise shows a small menu: Copy link, WhatsApp and Email.
  - Shared links carry `utm_source=share` (or the visitor's incoming introducer source/campaign) and `utm_medium=<method>`.
- **Introducer links:** `https://www.ariefinance.com/eligibility?utm_source=introducer&utm_campaign=<introducer code>`.
  - Never put client names, answers or other personal details in links.
- **Funnel events and reporting:** see [ANALYTICS.md](ANALYTICS.md#check-your-eligibility-funnel-added-november-2026). No eligibility outcome or screening data is ever sent to analytics.
