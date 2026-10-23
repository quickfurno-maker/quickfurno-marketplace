# Step 3B-6C — Existing Owner identity / privileged transition acceptance
SOURCE-ONLY, dry-run and negative cases; not permission to execute bootstrap.
- Existing Owner email is identified in private preflight; confirm actual Supabase Auth ID, verified email, active provider principal, matching Core profile and disabled/revoked identity states without making a duplicate account.
- Current legacy inherited privileged placeholder must not be retired before durable replacement proof, session invalidation plan and independent emergency/break-glass approval.
- Do not reenable `scripts/grant-superadmin.mjs`. Entry point intentionally throws before Auth / DB operations.
- Source-only planner `scripts/owner-superadmin-transition-plan.mjs` always returns authorizedToExecute=false even if evidence is synthetically complete. Assert false for stale approvals, mismatched hashes, duplicated reviewer identities, stale identity epochs, replay IDs, wrong project, absent rollback and simulated partial Auth/DB failures.
- Before any actual controlled Staging change: independent DBA and AppSec approval, Owner signed exact-SHA Staging-only consent, fresh backup with proven full rollback, real AAL2, and explicit post-transition removal/revocation tests.
- Supabase Auth admin metadata and Postgres durable roles cannot be assumed one atomic transaction. Record each stage and compensation; never claim success based on plan output.
- Genuine real Owner login, Team Leader enrollment, AAL2 and revoked-token validation are gated managed-environment acceptance, not accomplished by offline tests.
Decision: no privileged grant, no identity change, no Team Leader bootstrap. HOLD.
