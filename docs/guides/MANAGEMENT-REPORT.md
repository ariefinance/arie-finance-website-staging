# Management Report Builder

**Feature:** prepare monthly management reports. **UI:** `/managementreport/`; **API:** `/api/managementreport`. **Code:** `managementreport/index.html`, `api/managementreport.js`. **Code checked:** 26 October 2026; live workflow not re-executed.

## Operator workflow
1. Sign in with the authorised Management Report passcode.
2. Prepare the approved financial input pack (P&L, transaction summary, required balance sheet/continuation and manual commentary as applicable).
3. Use the tool's import/validation steps. Resolve readiness blockers; verify currency, reporting period and source completeness manually.
4. Review all preview pages and numbers before finalisation.
5. Export the PDF, PPTX and next-month continuation data; store them in an approved Finance-controlled location.
6. Keep the continuation file for the next reporting cycle. Avoid leaving sensitive downloaded files in shared folders.

## Architecture and data handling
The API is **authentication/session only** using Redis-held signing infrastructure; its source says no report data is stored by the API. Reports and uploads are handled in browser memory and exported files. Verify browser behaviour independently before relying on this as a security assurance.

**Env names:** `MANAGEMENTREPORT_PASSCODE` and the Redis credentials listed in the [operations guide](../OPERATIONS.md).

**Regression instructions:** [test suite](../../managementreport/tests/README.md), [environment](../../managementreport/tests/env/ENVIRONMENT.md), [snapshot contract](../../managementreport/tests/snapshot/SCHEMA.md), [historical gate result](../../managementreport/tests/GATE1_REPORT.md). Synthetic pack only in Git; external real-data reconciliation belongs in authorised Finance storage.

**Verification needed:** exact current file requirements, reviewed output formula versions, business sign-off, current regression PASS and production access.
