# VOX AB-7K — Protected Staging release packet (SOURCE CERTIFIED; LIVE RELEASE HOLD)

## Baseline
- Parent certified Core VOX [AB-7J draft #378](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/378) exact HEAD `19b5f889a25a51fd51837e34f2c1deefa3de18f6`, 10/10 workflows.
- Connected **QuickFurno Staging READ-ONLY** confirmed **0 installed public VOX tables**, 86 applied migration versions, 1 Auth user, 0 verified MFA factors. No managed database write, provider send, Auth mutation or deployment performed for this packet.
- Repo `supabase/migrations/`: 162 tracked files. Exact version comparison: **31 Staging-only IDs**, **107 repository-only IDs**. A different version might represent the **same SQL under a renamed/superseding staging migration**; DO NOT blindly run repo-only migrations. See `VOX-AB7K-MIGRATION-LINEAGE-RECONCILIATION-20261018.md` for exact differences.

## Source validation completed
- New **single fresh network-isolated postgres:17-alpine** run installs all **30 actual VOX SQL files** in required sequence against a **synthetic Core schema**: seven **quarantined** legacy foundation files, then 23 later uninstalled SQL candidates. Script: `scripts/mvp/vox/validate-voxAB7K-full-schema-pg17.ps1`.
- PostgreSQL reports **39 VOX public tables, all 39 enable and FORCE RLS**, **0 anon table DML**, **0 authenticated direct VOX table DML**, proper `team_leader` membership constraint after the fifth foundation migration, privileged suspension RPC cannot be called by `authenticated`. Human TL-review RPC is authenticated but enforces current user/session AAL2.
- The exact SHA-256 of **every byte** of all 30 files is pinned in `VOX-AB7K-REVIEWED-SOURCE-FINGERPRINT.json` with aggregate digest `8e85cd5549969df17c0bf3465b0cb3c8d2985e238cb79b05f712b5eaaf1bacb7`. Test `validate-voxAB7K-manifest.test.mjs` fails if bytes drift without a reviewed fingerprint update.
- This offline test **does not prove equivalence to the complete real Staging schema**, and never creates a Staff/TL login, AAL2 factor, real production signing key or genuine external review.

## Required approval and cutover order — MUST NOT SKIP

**Gate G1 — Independent DBA source-to-Staging reconciliation**:
1. Read existing 86 historical migration versions and their actual effective schema; map all 31 Staging-only version aliases to 162 Git repo entries and superseding changes by SQL semantics, not matching filenames.
2. Resolve all actual table/column/constraint/RPC/RLS/permission dependencies against the existing live Staging schema (not synthetic fixture).
3. Produce exact **approved** ordered forward SQL and rollback/restore plan for only missing VOX objects; never replay applied historical database schema files.
4. Create a fresh Staging **read-only backup** with chain-of-custody SHA and independently **restore-test** on a disposable PG17 DB. Verify restore data and schema, locking, account/consent isolation. DBA signs exact source digest, permissions, source aliases and rollback.

**Gate G2 — Independent AppSec / Cursor review**:
Inspect the seven quarantined foundations, 23 candidate SQL functions, SECURITY DEFINER roles, RLS and identity grants, signed Jarvis command, current consent/suppression, Staff suspension RPC and first TL bootstrap. AppSec signer must be **independent of Owner**. Unreviewed DDL stays quarantined; no bootstrap bypass.

**Gate G3 — Owner authorization and genuine identity setup**:
Retain the *existing Core Superadmin* as the sole Admin. Provision **one neutral Staff Auth identity per employee** through the approved existing Core/Supabase Auth, never a second authentication system. Enroll **real MFA AAL2** for Owner and first Team Leader through approved independent bootstrap. Before this, Current Staging has **0 verified MFA factors** and no verified TL. Staff suspension requires two genuine distinct AAL2 subject claims and current Core membership, not synthetic JWT fixtures. Supabase global signout may revoke refresh but existing access JWTs persist until expiry; Core fresh membership/department/object check must deny every protected action.

**Gate G4 — Signed protected Staging activation, NO SEND**:
Install exact reviewed SQL digest only after G1–G3. Deploy signed Core, Jarvis, VOX Web and AGNI Staging builds. Activate feature flags one at a time with a rollback plan; outbound WhatsApp and client/vendor real provider delivery remain disabled. Test authenticated Staff/Owner/TL, Aarohi CRM, Vendor 360, Riya Client Cases, Anisha agent chat and consent, Jarvis PAUSE/TAKEOVER signed receipts, frozen/stale/duplicate/revoked authorization, Service Desk, queues, EOD four signed Core sources and independent Owner official release. Run bounded internal notification worker with providers disabled, reconcile dead-letter/unknown results and observe sanitized AGNI/AOS advisory.

**Gate G5 — Owner GO/NO-GO**:
Collect independent approvals, source attestation and protected staging test evidence; review rollback and audit trail, then approve any production release separately. No unsupported claims, synthetic self-signatures or automatic promotion.

## Stop conditions
- No genuine independent DBA and AppSec sign-offs.
- No verified real Staff Team Leader AAL2 enrollment or first TL approved bootstrap.
- No current managed Staging schema parity/validated backup restore/approved rollback.
- Any production or real provider send triggered by Staging.
- Unknown state on Core transaction or any Staff Auth/session inconsistency.
- Any missing signed Owner release.

**No production or managed Staging modification is authorized by this document. Release HOLD; all PRs DRAFT and UNMERGED.**
