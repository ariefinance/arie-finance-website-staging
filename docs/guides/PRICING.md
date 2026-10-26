# Pricing and document builder

**UI:** `/internal/pricing/`. **API:** `/api/internal/pricing`. **Sources:** `internal/pricing/`, `api/internal/pricing.js`. **Reviewed:** 26 October 2026 (source only).

## Features
Document and pricing preparation; branded ARIE/ACBM output; document preview and export; a server-managed reference register with search, lookup and allocation.

## Staff workflow
Sign in using authorised access. Choose the entity and customer, enter approved terms, validate fees and document wording, inspect the output and save the approved export. Confirm an existing reference before requesting a new one if a request times out. Follow commercial/Compliance sign-off before issuing documents.

## Technical handover
The API provides login/logout/session, `allocate_ref`, `register_search` and `register_lookup`. It uses Upstash Redis, a staff passcode, and a shared ARIE/ACBM sequence. The current source config explicitly includes year 2026; next-year allocation must be reviewed before use. Runtime file list: [MANIFEST](../../internal/pricing/MANIFEST.txt).

**Unverified:** exact document variants, live access control, current numbering policy and approval owner.
