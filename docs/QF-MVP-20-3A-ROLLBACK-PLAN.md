# QF-MVP-20.3A — Rollback Plan

Rollback design for each remediation migration. **Nothing is executed in this task.**

## Governing rules

1. **Staging-first.** Every rollback is rehearsed on staging (`uckafzuochmbvtiodmcl`) before any production application is even proposed.
2. **No destructive reset against production.** `db reset`, `migration repair`, and history rewriting are prohibited on production under all circumstances.
3. **Additive objects are disabled before they are removed** — a trigger is disabled, a function's grants are withdrawn, and only a later reviewed migration drops the definition.
4. **Consumer code must be reversible** during the compatibility period: legacy RPCs remain present and `service_role`-executable until Migration E, so a runtime revert is always possible without a database rollback.
5. **Grant-revocation rollback must never reopen PUBLIC authority.** Re-granting is permitted **only** to `service_role`. Restoring `PUBLIC`/`anon`/`authenticated` EXECUTE on any mutation RPC is forbidden even as an emergency measure.
6. **Data created under canonical authority is never deleted to roll back code.** Assignments, lineage rows, ledger rows, approvals and intents are business truth; a code revert leaves them in place.
7. **Migration history is never manually falsified.** Rollback is expressed as a new reviewed forward migration (or a staging project rebuild), not by editing `supabase_migrations.schema_migrations`.

---

## Per-migration rollback

### Migration A — foundation (additive)
- **Blast radius:** none at runtime (nothing reads the new objects until B).
- **Rollback:** drop the 5 new tables and the added columns on `lead_assignments` / `vendor_credit_logs`; restore the previous `vendor_credit_logs.change_type` CHECK.
- **Data caution:** if A has been live long enough to accumulate lineage/operation rows, **do not drop** — disable use from the service instead and keep the tables (rule 6). Dropping is only safe while the tables are provably empty.
- **Reversibility:** full while empty; degrades to "leave in place, stop using" once populated.

### Migration B — canonical authority + enforcement triggers
- **Blast radius:** the three triggers are the only behaviour-changing objects; they can reject legacy writes.
- **Rollback (fast path):** `ALTER TABLE … DISABLE TRIGGER` for the three triggers — restores pre-B write behaviour instantly without dropping anything.
- **Rollback (full):** drop the 5 canonical functions and the 3 triggers. Legacy RPCs are untouched and immediately serve traffic again.
- **Data caution:** assignments/ledger rows created by the canonical engine **stay** (rule 6).
- **Reversibility:** full.

### Migration C — public projection + privilege hardening (restrictive)
- **Blast radius:** public vendor reads; anon privileges.
- **Rollback:** drop `vendor_public_v` and revert the runtime to the previous server-owned DTO path (which still works, because it reads `vendors` as service-role).
- **Forbidden rollback action:** re-granting `anon` on `vendors` (that is the very exposure being closed). If the projection must be withdrawn, public reads fall back to the **server-side service-role DTO**, never to anon table access.
- **Index changes:** the 3 dropped duplicate indexes are recreated by name if a revert is needed (they are redundant, so this is cosmetic).
- **Reversibility:** full, with the one forbidden action noted above.

### Migration D — Auth trigger (independent)
- **Blast radius:** new-user profile provisioning only.
- **Rollback:** `DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;`
- **Data caution:** profiles already created remain. Re-application is idempotent (existence-checked), so a re-apply after rollback is safe.
- **Reversibility:** full; deliberately decoupled so an Auth issue never forces an assignment-authority rollback.

### Migration E — legacy revokes (restrictive)
- **Blast radius:** any un-migrated legacy caller fails closed.
- **Rollback:** re-`GRANT EXECUTE … TO service_role` **only**. This restores server-side legacy operation while leaving the public/anon bypass permanently closed.
- **Forbidden rollback action:** `GRANT … TO PUBLIC | anon | authenticated` (rule 5).
- **Reversibility:** full within the service_role boundary.

---

## Failure-mode playbook

| Scenario | Action |
|---|---|
| Migration fails mid-apply on staging | Do **not** retry blindly. Inspect transaction status SELECT-only; if the migration was transactional the state is already clean. Do not hand-patch. Fix the migration file and re-apply to a **rebuilt** staging if the schema is left partial. |
| Triggers reject legitimate legacy traffic | Disable the three triggers (B fast path), migrate the offending consumer, re-enable. Do **not** relax the caps. |
| Canonical engine defect discovered after consumer migration | Revert the **application** to the legacy service path (legacy RPCs still exist and are service_role-granted until E). No database rollback required. |
| Public projection breaks a public page | Revert the runtime to the service-role DTO; keep the anon revoke in place. |
| Staging left partially initialised and unrecoverable | Delete and recreate the **staging** project, re-apply the reviewed baseline (`920a4aa0…`), re-run the corrected verifier (`7ba9792f…`), then re-apply migrations. Never do this to production. |
| Production application proposed | Requires: staging rehearsal green, rollback rehearsed, backfill mapping approved (design §17.1–§17.2), founder sign-off. Production rollback is forward-migration only. |

---

## Rollback rehearsal requirement (T21)

Before any production proposal, staging must demonstrate: apply A→D → run the full test matrix → roll back per this plan → confirm the catalog returns to the pre-migration shape and the corrected verification artifact still passes on the restored shape. The rehearsal itself is part of the 20.3B exit gate.
