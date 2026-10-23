# Step 3B-6B — RLS/AppSec policy-by-policy decision matrix
Source-only proposed permission taxonomy, not a migration. Existing Staging read-only inventory: is_admin() in 59 policies (ALL 28 / SELECT 27 / UPDATE 3 / INSERT 1); owns_vendor() in 22 (SELECT 14 / INSERT 5 / UPDATE 2 / ALL 1).
## Required columns for each policy
schema, table, policy name, command, permissive/restrictive, roles, using expression, with-check expression, helper, resource classification, caller status, intended active/suspended/revoked rule, direct/indirect grant, cross-policy OR/AND impact, Auth JWT/session freshness, decision owner, reviewer, evidence digest, decision.
## Initial least-privilege proposals for per-policy review
- CREATE_NEW_WORK / WRITE / LEAD_ACCEPT / WHATSAPP_OUTBOUND / WALLET_SPEND: block inactive, unapproved or suspended vendor; require current linked identity and explicit operation eligibility.
- READ_OWN_HISTORICAL_INVOICE / REFUND / DISPUTE / SUPPORT_TICKET: consider retaining narrowly scoped own-record read for suspended vendors to meet support, accounting, and compliance needs; prohibit modification and cross-vendor reads.
- READ_EXISTING_LEAD / NOTIFICATION / CHAT: make an explicit case-specific post-suspension decision; historic visibility is not permission to accept new jobs or initiate communication.
- ADMIN_MANAGEMENT: current is_admin helper ignored is_active in a tested disposable Staging clone; review active check plus session/token revocation and authoritative durable role, then evaluate effects on all 59 policies.
- PUBLIC_VENDOR_DISCOVERY: separately confirm intentionally public SECURITY DEFINER view projection without exposing private data.
## Tests before approval
Active valid owner; inactive owner; suspended owner; suspended historical read; forged owner; stale JWT; reassigned ownership; removed principal; inactive Admin; revoked Staff; permissive OR policy bypass; restrictive AND; SECURITY DEFINER functions; anon/authenticated/service_role; READ versus INSERT/UPDATE/DELETE; payment and WhatsApp no-write on revoke.
Read-only proposed policy inventory SQL: `docs/finance/sql-review/STEP3B6-POLICY-MATRIX-READONLY.sql`. NON-RUNNABLE guard candidates remain under docs/finance/sql-review. No blanket helper swap, policy ALTER, or deployment without actual AppSec signoff and domain decisions.
Decision fields: product/finance history access = PENDING; independent AppSec = PENDING. Managed SQL change = NOT AUTHORIZED.
