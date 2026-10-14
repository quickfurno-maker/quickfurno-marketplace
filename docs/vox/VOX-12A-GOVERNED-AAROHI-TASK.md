# VOX-12A — First APPROVED/EXECUTED native Core Aarohi action (source only)

Do not enable without real Staging MFA, backup, migration, audit review, execution-rate and concurrency certification.

New `POST /api/vox/v1/execute-followup` requires a fresh Core-verified owner Superadmin AAL2 session and dedicated default-off `VOX_APPROVED_FOLLOWUP_EXECUTION_ENABLED=staging`. No direct browser auth or arbitrary task payload. Request can specify only UUID intent and revision 1.

Single PostgreSQL SECURITY DEFINER RPC `qf_vox_execute_approved_aarohi_followup_v1` locks the underlying already APPROVED Core operational intent (#221), checks owner review/expiry/revision, proposer current active team and exact object assignment, canonical prospect city. It then creates exactly one existing native `aarohi_tasks` FOLLOW_UP task and `aarohi_events` record with an execution receipt **in one DB transaction**. Same request idempotently yields the original task. All transactional errors roll back. No second CRM, no WhatsApp send, no vendor change, no credits, no profile/KYC or matching.

Unapplied `20261014070000_vox_approved_followup_executor.sql` adds only a private FORCE RLS execution receipt table and a service_role-only RPC. Isolated PG17 shows a valid approved action created 1 task+1 event+1 receipt; replay returns same task, scope revocation before second execution denied, untrusted executor blocked and browser has no SQL execution privilege.

Scope deliberately restricted: owner authorization of an **internal follow-up task only**. Other approved intent types remain non-executable. It does not satisfy full follow-up scheduling/editor/SLA/communication provider workflows. Need real Staging positive/negative E2E, immutable audit and concurrency at scale, reviewer approval policy and signed rollout before enabling.