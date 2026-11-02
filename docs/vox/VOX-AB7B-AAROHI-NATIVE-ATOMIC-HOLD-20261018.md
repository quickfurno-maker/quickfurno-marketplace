# VOX AB-7B — Actual Aarohi Follow-up Source Atomicity (RELEASE HOLD)

## Architecture and release boundaries
This uninstalled candidate adds a Staff-only POST /api/vox/v1/aarohi-task route using genuine canonical aarohi_tasks and aarohi_events. One isolated PostgreSQL function creates both native CRM rows, an immutable CRM_AAROHI original source event, the corresponding F1 Staff event, and a one-use nonce in ONE transaction. An invalid grant, role, nonce or city rolls back both original writes.

- Trust source: verified Supabase AAL2 neutral Staff (never a legacy Core Admin), current Core team and city, exact acquisition_agent role and assigned prospect. Current acquisition department capability is checked again by the existing native event trigger.
- Internal task type FOLLOW_UP only. NORMAL/HIGH priority; due between five minutes and 30 days. Safe summary only. No WhatsApp, external messages, credits, vendor or lead mutations.
- Strict Core feature switches: VOX_AAROHI_INTERNAL_TASKS_ENABLED, VOX_AAROHI_ATOMIC_AUDIT_ENABLED and VOX_DEPARTMENT_ENFORCEMENT_ENABLED must all equal staging; they remain OFF. SQL never installed on managed stage or production.
- Existing /admin/aarohi actions are Admin-only and unchanged. This new Staff route never falls back to legacy split transaction.
- Conversation durable transport, Staff Auth lifecycle, official EOD, active worker, human independent DBA/AppSec and approved first Team Leader remain PENDING.

## Verification
Source/input tests cover role, scope, forged actor/role/city, priority, due bounds, strict disabled state, receipts and no provider sends. Disposable network-disabled PostgreSQL 17 checks cover actual 1:1:1:1:1 task/event/native/F1/nonce provenance and failures on duplicate nonce, revoked scope/capability, cross-city, wrong role, short due, do-not-contact, anonymous function call, source immutability. Core full regression, typecheck, build and exact SHA GitHub CI must pass before claiming source certification.

## Control
DRAFT/UNMERGED; release HOLD. No managed migrations, Staff identity activation, external provider sends or production deployment. Cursor review deferred, never waived. Every test failure and exact commit/CI result must be recorded in the canonical Notion tracker.
