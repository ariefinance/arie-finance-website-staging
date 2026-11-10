# WhatsApp — Enquiries & Onboarding

**Where:** a floating button on the marketing pages, plus a compact entry in the Contact page's "Prefer to contact us directly?" card. **Source:** `index.html` (the `#wa-contact-block` and `#wa-float-button` templates, and the `WA_ENABLED` switch near the end of the file). **Status:** built, **switched off** until launch is approved.

**Business hours** (Monday–Friday, 9:00 AM–5:00 PM, Mauritius Time) appear as their own Contact entry. They are not part of the switch, so they show whether or not WhatsApp is on.

## What it is
- A click-to-chat link to ARIE's WhatsApp Business number, **+230 5919 4957** (`https://wa.me/23059194957`).
- It is for **general business enquiries and onboarding guidance**, Monday–Friday, 9:00 AM–5:00 PM, Mauritius Time (UTC+4).
- It uses no scripts, API, chatbot, CRM or tracking. The link opens WhatsApp in a new tab with no prefilled message, so no visitor data is passed.
- **Floating button:** a navy pill labelled "Enquiries & Onboarding" on desktop, and a 52px white circle on mobile.
  - On desktop, hover or keyboard focus shows "Real people. Thoughtful responses. Handled by our team, never an AI chatbot." The note is extra information, not essential.
  - The button is hidden on Contact, Careers and Feedback, and on phones while the cookie notice is showing.
  - It sits below the mobile menu.
- **Contact entry:** the number, "Real people. Thoughtful responses.", the human-led sentence, and one security line.
- **Not used for:** payment instructions, authentication, passwords or OTPs, identity documents, confidential account data, or approving payments or beneficiary changes.

## Switching it on (or off)
1. Confirm the launch dependencies below.
2. In `index.html`, change `var WA_ENABLED = false;` to `true`, then go through the normal PR, preview and merge process.
3. To withdraw it, set the switch back to `false`. While it is off, no WhatsApp element is shown.

## Launch dependencies
- **Number:** +230 5919 4957 is company-owned (not a personal account), registered on WhatsApp Business, and opens correctly from the website link.
- **People:** a named owner and a backup. Two-step verification is on, with the PIN and recovery email held by the company. The device has a screen lock.
- **Profile:** set up as below, including hours, and the greeting and away messages switched on.
- **Compliance:** confirms the security notice, that WhatsApp complaints are handled under the existing Complaints Procedure, and how messages are kept.
- **Privacy:** Compliance/DPO confirms the current Privacy Policy is sufficient for customer-initiated WhatsApp messages. It already covers "communications with ARIE", technology providers and overseas processing, but does not name WhatsApp.

## Business profile
| Field | Value |
|---|---|
| Name | ARIE Finance |
| Logo | Approved ARIE logo (square crop) |
| Category | Finance (or the closest financial category the app offers) |
| Description | ARIE Finance Ltd: international payments and multi-currency accounts for businesses. Licensed by the Financial Services Commission, Mauritius (Payment Intermediary Services licence GB25205028). This channel is for general enquiries and onboarding guidance. |
| Website | https://www.ariefinance.com |
| Email | customercare@ariefinance.com |
| Address | 3rd Floor, KPMG Centre, Ebene, Mauritius |
| Hours | Monday–Friday, 9:00–17:00 (Mauritius) |

## Automatic messages
Both messages are automatic. Neither claims that someone has already read the message, and neither promises a reply time.

**Greeting:**
> Thank you for contacting ARIE Finance.
>
> Messages here are handled by our team, not an AI chatbot. We'll review your enquiry and, where needed, gather the relevant information before we reply.
>
> Our business hours are Monday–Friday, 9:00 AM–5:00 PM (Mauritius Time).
>
> For your security, please don't share passwords, OTPs, identification documents or payment instructions on WhatsApp. Existing clients: account and payment matters remain with your Relationship Manager.

**Away (outside hours):**
> Thank you for contacting ARIE Finance.
>
> Our team is currently outside business hours (Monday–Friday, 9:00 AM–5:00 PM, Mauritius Time). A member of our team will review your message when we're back.
>
> Please don't share passwords, OTPs, identification documents or payment instructions on WhatsApp.

## Quick replies
| Shortcut | Message |
|---|---|
| `/services` | ARIE provides multi-currency accounts and international payments for businesses, supported by a Relationship Manager. Could you tell me a little about your business and the countries you pay or receive from? |
| `/docs` | Our onboarding checklist is here: https://www.ariefinance.com/onboarding-requirements/ — happy to talk you through anything that's unclear. |
| `/call` | The easiest next step is a short call with our team. What day and time suit you? |
| `/client` | Thank you for getting in touch. For your security, account and payment matters are handled by your Relationship Manager. I've let them know, and they will contact you. Please don't share account details here. |
| `/secure` | For your security, we can't act on payment instructions, account changes or documents sent by WhatsApp. Please use the channel agreed with your Relationship Manager. |
| `/complaint` | I'm sorry to hear this. I've passed your concern to our team under the ARIE Complaints Procedure, and a colleague will contact you by email. |
| `/jobs` | Thank you for your interest in ARIE. Applications are accepted only through our Careers page: https://www.ariefinance.com/#careers |

## Simple workflow
- **Owner and backup:** one owner, plus a backup during absences. No personal phones or numbers.
- **Check-ins:** three a day on working days (about 9:30, 13:00 and 16:30), not continuous monitoring.
- **Labels:** New enquiry · Onboarding · Client → RM · Complaint · Not relevant. Label each chat when you finish with it.
- **Account issues:** never refuse. Reply with `/client` or `/secure` and tell the Relationship Manager.
- **Suspicious messages:** do not act on any payment or account request received on WhatsApp. Reply with `/secure`, verify through the client's established channel, and report it under the usual procedure.
- **Complaints:** handle any dissatisfaction under the existing Complaints Procedure, exactly as for email.

## 30-day pilot (no reports to build)
Once a month, read three numbers:
- **Relevant enquiries:** the New enquiry and Onboarding labels.
- **Irrelevant or misdirected:** the Not relevant label, plus chats that needed `/secure`.
- **Time spent:** the owner's own rough estimate of hours per week.

Then decide whether to keep WhatsApp as it is, adjust it, or switch it off.
