# QuickFurno Finance V2 PAY-2 — Append-only payment/refund audit foundation
**NO changes to existing Razorpay checkout, credit activation, refunds or external provider. Uninstalled SQL only.**
- `finance_payment_attempts`: order-linked UUID for each payment attempt, distinct external provider payment ID, merchant/mode (TEST/LIVE) uniqueness and paise amount.
- `finance_provider_events`: deduplicated Razorpay event ID scoped to merchant/mode, verified signature flag, hashed raw-body digest (NO raw provider payload or secrets), event time/ingest time, links to order/attempt.
- `finance_refunds`: immutable local refund-request ID, external provider refund ID composite uniqueness, linked original attempt, amount in paise, approval reference and source reason. **Not a refund execution/status engine**, no refund calls.
- `finance_audit_events`: append-only Staff/Owner/provider action proof references, no actor secrets.
- 4 finance tables FORCE RLS, no anon/auth SELECT or DML, service_role only SELECT+INSERT. Trigger rejects UPDATE and DELETE even by privileged runtime. IDs and business events are append-only; resolution workflow must append new events.
- `lib/payments/financeV2ProviderEvent.mjs` + adjacent `.d.mts` contract verifies signed raw webhook + canonical external event ID and returns only whitelisted metadata; **not wired** to existing webhook until migrations and signed tests are authorized.
- The future operational workers must enforce payment/attempt/order correspondence, signature authenticity before insert, refund cumulative cap and review approvals, versioned reconciliation state, bounded replay and provider callback recovery. These are **NOT certified by history-schema-only work.**
- Release gates: independent SQL ACL/trigger/fk/lock audit, offline PostgreSQL17 rollback test, authenticated provider TEST delivery/refund canaries, Staff ABAC/AAL2 dashboard (PAY-3), separate Owner GO.
**SOURCE STATUS HOLD.**