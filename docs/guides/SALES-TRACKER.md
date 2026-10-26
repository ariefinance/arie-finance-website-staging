# Sales Tracker — operator and maintainer guide

**Feature:** shared sales pipeline and revenue board. **UI:** `/salestracker/`. **API:** `/api/salestracker`. **Source:** `salestracker/index.html`, `api/salestracker.js`. **Reviewed from code:** 26 October 2026 (not live-tested).

## What it supports
Shared staff pipeline board, lead segmentation and editing, status/stage updates, onboarding handoff, persistence, historic backups and restore. API uses Redis, a staff passcode and a signed session cookie. Concurrent saves use a version to detect conflicting edits instead of silently overwriting them.

## For staff
1. Open the tool URL only using ARIE-approved access, then sign in with the authorised staff passcode.
2. Locate the lead in the appropriate segment; verify company identity before editing.
3. Update pipeline stage, notes and engagement milestones; save and verify changes persisted.
4. When qualified for onboarding, follow the documented handover procedure with Onboarding; the software does not replace compliance approval.
5. If a conflict is indicated, reload/merge carefully rather than duplicating leads. Use restore only with approval: it changes the shared board.

## For maintainers
- **API actions declared in code:** login, logout, board read/write, version, original seed, history, restore and initial board seed.
- **Config variable names:** `SALESTRACKER_PASSCODE`; Redis credentials as `KV_REST_API_URL` / `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
- **Data:** board and backup snapshots stored in Redis; treat as commercially sensitive. Client-facing site analytics is separate.
- **Do not:** reset seed, restore backup, or alter shared Redis keys without a change approval and snapshot/recovery plan.

**Verification needed:** exact UI fields, stage routing, authorised user group, retention, live access control, error recovery and business owner.
