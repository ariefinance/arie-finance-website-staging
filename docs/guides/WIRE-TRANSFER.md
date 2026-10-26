# Wire-transfer preparation utility

**UI:** `/internal/wire-transfer/`. **API:** `/api/internal/wire-transfer`. **Sources:** `internal/wire-transfer/`, `api/internal/wire-transfer.js`. **Reviewed:** 26 October 2026 (source only).

## Features
Information extraction, clean-up and parsing; document state/validation; populating a MauBank transfer form PDF; user export. This is a **document-preparation tool**, not evidence of transfer authorisation or bank submission.

## Staff workflow
Sign in via the approved access method. Supply the supported source file/information, review extracted beneficiary and payment information against the authoritative instructions, preview the completed form and send the output through ARIE's ordinary bank-approval process. Keep records in approved storage, not the Git repository.

## Technical handover
The API supports login/logout/session, using an environment-supplied passcode with signed cookies; no Redis is used by this API. Source modules cover parsing, extraction, clean-up, state and PDF filling. See [runtime manifest](../../internal/wire-transfer/MANIFEST.txt) and [synthetic tests](../../internal/wire-transfer/tests/run.js).

**Unverified:** current bank form acceptance, input formats, user permissions and precise client-data handling.
