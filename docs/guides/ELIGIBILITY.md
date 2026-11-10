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
4. **Permitted results**: indicative pricing (when enabled), then **directly to `/onboarding-requirements`**.
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

## Indicative pricing (release gate)

- The full v0.9 fee schedule is implemented unchanged: Standard and Enhanced profiles, SWIFT charges, the closure fee, the FSC licence line and the disclaimers.
- `PRICING_PUBLIC_APPROVED = false` in `index.html` (the same flag v0.9 uses). While it is false:
  - **Production hosts** (`ariefinance.com`): no pricing screen. Results link directly to `/onboarding-requirements` using v0.9's no-fees wording, and intro tile 03 reads "Prepare your documents".
  - **Other hosts** (Vercel previews, localhost): pricing is shown so management can review it. This mirrors v0.9's team-demo mode.
- To release pricing after management authorisation, set `PRICING_PUBLIC_APPROVED = true`.

## Before go-live

- Compliance confirms the rules against the approved "List of Restricted and High Risk Jurisdictions" and activity policy. v0.9 itself is marked "Proposed rules pending Compliance approval".
- Management authorises (or amends) the indicative fees.
- Run one labelled, fictional Further Review submission from the preview, and confirm it actually arrives in the customercare@ inbox with the full answers.
