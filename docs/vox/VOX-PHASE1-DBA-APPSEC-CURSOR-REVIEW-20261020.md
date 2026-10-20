# VOX Phase 1 — Cursor technical review + independent DBA/AppSec authorization packet

**Date:** 20 October 2026
**Review target:** [Core RC1 DRAFT PR #383](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/383), immutable review SHA `238fcb943cbdf7e2952592f813dd6a615df3c107`. This packet is an **internal evidence handoff**, not an approval.
**Related unmerged source heads:** Jarvis PR #327 `0e6f432985b156bcee148a3521165d2285384da7`; AGNI PR #87 `6fa59afe8627f9a585189d759daa5bee6648c359`.
**Canonical RC1 local JSON (do not reissue or edit):** `D:\QuickFurno-Workspace\VOX-release-candidates\VOX-RC1-238fcb943cbdf7e2952592f813dd6a615df3c107.json`, SHA256 `F7395CDEFE2A437221174B5BB37FC70D11F8A9477E73C70D94B67BF0406F13F4`.
**Full VOX SQL bytes digest:** `8e85cd5549969df17c0bf3465b0cb3c8d2985e238cb79b05f712b5eaaf1bacb7` (7 quarantined SQL + 23 uninstalled SQL). The reviewer must verify all 30 SHA-256 entries in `docs/vox/VOX-AB7K-REVIEWED-SOURCE-FINGERPRINT.json`.

## Read-only Staging security facts — verify independently

- QuickFurno Staging has **86 applied migrations**, **0 public VOX tables**, **1 Auth user**, **1 verified Core Superadmin profile**, **1 Auth session**, **0 verified MFA factors**, **0 unverified MFA factors**.
- Source migration lineage: **31 Staging-only IDs** and **107 repository-only IDs by exact version string**, **NOT** proof that 107 migrations are missing. Map semantically, checking collisions/superseding scripts, applied order and backup/restore before any DDL.
- Current connected Supabase Security Advisors: **1 ERROR** `security_definer_view` on `public.vendor_public_v`; **2 WARN** `authenticated_security_definer_function_executable` on `public.is_admin()` and `public.owns_vendor(uuid)`; **102 INFO** `rls_enabled_no_policy` (may be intentional deny-all; review). These are **review findings, not concluded vulnerabilities**.
- `vendor_public_v`: PostgreSQL view has **default security-definer behavior**, SELECT granted to both `anon` and `authenticated`; currently projects public vendor fields only and filters `status='Approved'`, `is_active=true`, `public_visibility=true`, `remaining_credits>0`. The view bypasses underlying RLS if owner has privileges; do not change to `security_invoker=true` without confirming intended anonymous vendor listing still functions with explicit RLS/grants. Independent AppSec must sign exact exposure contract and flag any private columns, side channels or row visibility bypass.
- Two `SECURITY DEFINER` functions callable by `authenticated`: `is_admin()` returns an identity-scoped boolean from `profiles` via `auth.uid()`; `owns_vendor(uuid)` checks vendor ownership via `auth.uid()`. Both use `SET search_path TO 'public'`. Current `anon` and `authenticated` roles **cannot CREATE in schema public**, reducing function search-path spoofing risk, but validate privilege boundaries and dependent policies. In public namespace there are **144** SECURITY DEFINER functions; **0 anon EXECUTE**, **2 authenticated EXECUTE**, and **0 without proconfig**. Review RPC PUBLIC grants, side-channel disclosure, role changes, SET search_path and indirect function invocation. Avoid blind revoke; may break policy functions.
- Five sampled canonical Core tables `profiles`, `aarohi_tasks`, `communication_conversations`, `communication_conversation_events`, `jarvis_os_operator_command_receipts` are owned by postgres and have RLS enabled but legacy FORCE RLS false; do not present as FORCE. No anonymous SELECT or DML and no `authenticated` INSERT/UPDATE/DELETE; only `profiles` allows authenticated SELECT subject to RLS. Full tables, functions, trigger, view, role ACL and RLS audit still pending.
- RC1 verified only on isolated PG17: all 30 SQL sources installed against actual archived Staging **schema-only** snapshot; 39/39 candidate VOX tables FORCE RLS and no browser direct DML, rollback of synthetic baseline passed. This is NOT evidence of data migration safety, current managed ACL equivalence or full validated Staging restore.

## Required Cursor technical review (read-only, no modifications by default)

1. **Source/branch integrity** — verify exactly Core RC1 SHA and every SQL/file digest; inspect `docs/vox/VOX-RC1-FINAL-INTERNAL-SOURCE-RELEASE-CANDIDATE-20261020.md`, `contracts/vox/voxRC1ReleaseCandidate.mjs` and `contracts/vox/ab7mCrossServiceCandidate.mjs`. Report mismatches.
2. **SQL source-to-managed dependency graph** — review each foundation/candidate file in ordered sequence, generated functions and triggers, all grants/policies and definer search paths; deliver exact forward-only SQL changes, nonproduction rollback, and list unresolved migration aliases, without executing on managed Supabase.
3. **Auth identity boundary** — review `services/vox/verifiedStaffBearer.ts`, `services/vox/verifiedScopedStaff.ts`, `services/vox/verifiedVoxOwner.ts`, Team Leader first bootstrap and two-distinct-AAL2 signatures, current trusted `auth.users` and `auth.mfa_factors` checks, claims/session freshness. Ensure no app-supplied role or user_metadata controls authority.
4. **Staff and agents** — review Riya cases, Staff chat, work queue, staff notifications and Staff directory for correct **late authorization** under revocation, exact grants, bounded windows, signed Jarvis operator handovers, consent, replay, AI/provider no-send safeguards.
5. **Worker/EOD/AGNI/AOS** — confirm queue claiming/idempotency, replay, late reviewer expiry, no unapproved push/WhatsApp/agent autonomy, source ledger and operator rollback.
6. **View and functions warning** — separately assess `vendor_public_v`, `is_admin`, `owns_vendor` against Supabase advisors and public view exposure; report technical risk and required remediation evidence without unreviewed DDL.
7. **Build and QA** — check RC1 exact SHA 14/14 GitHub workflows, 504/504 Core tests, 30/30 candidate PG17, restorable archive scope and whether no-send signed Staging E2E is genuinely still missing.

### Output requested from Cursor

Produce `VOX-RC1-CURSOR-TECHNICAL-AUDIT.md` **outside the repository first** with P0/P1/P2 findings, exact file+line and reproduction steps, affected auth/ACL, proposed fix, whether isolated test exists, independent review questions and unresolved assumptions. Explicitly state **TECHNICAL REVIEW ONLY — NOT AN INDEPENDENT HUMAN SIGN-OFF**. Do not create synthetic reviewer JWTs as substitutes for real humans; do not generate MFA secret or staff identities. Do not modify managed Staging/Production, issue a release, merge PRs, trigger external providers, or use unreviewed Supabase service credentials.

### Independent human DBA / AppSec / Owner sign-off — all currently BLANK

- DBA reviewer (independent human, authenticated): **NOT SIGNED** — SQL source digest / source-to-managed migration lineage / current ACL / forward+restore plan / verified disposable restore
- AppSec reviewer (independent human, authenticated): **NOT SIGNED** — view/function exposure, identity role separation, signature trust/key custody, session revoke, no-send contracts
- First Team Leader appointment: **NOT APPROVED** — independent signed reviewer + actual neutral Staff Auth identity required
- Owner genuine MFA AAL2: **NOT VERIFIED**; Team Leader genuine MFA AAL2: **NOT VERIFIED**
- Owner signed protected Staging GO: **NOT SIGNED**; production GO: **NOT SIGNED**

**Outcome: STOP. All RC1 PRs remain DRAFT/UNMERGED and Release HOLD.**
