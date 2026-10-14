# VOX-13/14/15 integrated source candidate — release HOLD

**Date:** 2026-10-14. **Scope:** Core + staff Web source integration and synthetic certification only. **Never deploy or promote this candidate directly.** This is an integration checkpoint, not a new production feature flag or approved release.

## Exact composition

- Core VOX-12 QA branch `test/vox-12-continuous` (#226), including approved native Aarohi follow-up executor contracts from #224 and earlier Core/QA prerequisites.
- VOX web `feat/vox-12c-dual-role-bff` (#229), containing owner/staff BFF and generic staff proposal workflow (#228), approved follow-up workbench (#225), and earlier Web prerequisites.
- Acquisition proposal work (#227) merged selectively by resolving overlaps: retained separate feature-gated Aarohi follow-up proposal, generic vendor/support/staff proposals, and pinned Origin + Host protection; renamed conflicting static validator so neither test suite is silently dropped.
- All actions remain default disabled. Both acquisition-proposal surfaces have independent staging flags; the generic form is suppressed when the dedicated acquisition form is enabled, so the page cannot show duplicate enabled forms.

## Local evidence

- Core source and adversarial contracts: **343/343 PASS**.
- Hardened launch-HOLD checks: **15/15 PASS**.
- Disposable PostgreSQL 17: native task=1, native event=1, receipt=1, replay blocked and revoked staff scope denied.
- Combined Web guards: source scripts PASS (including generic 28/28, dual role 19/19, pinned Origin/Host 14/14, acquisition-specific 21/21); Web TypeScript and optimized Next build PASS.
- Core TypeScript: PASS (local). Initial Linux TS7006 cross-platform failure corrected in explicit cookie writer typing; PR recheck required.
- Next standalone live HTTP smoke on developer Windows: **NOT CERTIFIED** (local server readiness failure; failure may be Windows/test environment dependent). Linux GitHub CI checks actual HTTP response gates.
- **Portable Auth boundary:** Core VOX owner/staff bearer lookups now call a single server-side Supabase Auth helper in the existing approved `lib/supabase.ts` boundary. Remote `auth.getUser(token)` still runs before AAL2/active staff and object authorization. Original strict portability audit locally PASS (651 runtime files); no exception or allowlist expansion.
- **Migration provenance reconciliation:** First-party Supabase migration inventories read from the canonical QuickFurno Staging and QuickFurno production projects show none of the seven VOX 20261014 migrations applied. Each file is now explicitly SOURCE-ONLY hash-pinned in the existing G1 extension ledger; no SQL was applied. Strict QF staging-history gate locally PASS **333/333 assertions and 153/153 mutation checks**. This is not evidence of restored staging or a migration apply certificate.
- No actual Supabase Auth owner/staff MFA staging login, Core provider delivery, staging migration, cross-city IDOR live matrix, Docker signed candidate deployment, rollback certification or public DNS activation has been completed by this integration PR.

## Release dependencies / safe merge

1. Treat this draft as a **combined CI checkpoint**; do not merge it alongside overlapping constituent VOX feature branches or duplicate implementation commits.
2. Review parent graph and reconcile every draft PR before a clean main-based release PR; QA-only branches should not be independently double-merged.
3. Read GitHub integrated CI on **this exact commit**; do not borrow success from individual PRs.
4. In private Staging run reviewed backups, restore proof, ordered migrations, real Supabase MFA AAL2, staff/team/city/IDOR/nonce/revocation E2E, Jarvis/AGNI signed runtime health, Meta consent/handover/delivery, outbox replay and rollback.
5. Require human review before any signed promotion. Live business execution flags OFF until staging certificates are verified.

**Verdict:** SOURCE INTEGRATION CANDIDATE ONLY; production **HOLD**.
