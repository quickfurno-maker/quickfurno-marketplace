# VOX TO-04E — consolidated database and first Team Leader review packet

**15 October 2026 — DRAFT / RELEASE HOLD.** Candidate integration inherits #285 and uses existing sole Core Superadmin and ONE neutral Supabase Auth login per Staff employee. No second Admin account, duplicate Auth system, employee invitation, SQL migration or feature activation.

## Live, read-only metadata evidence
- Connected QuickFurno staging and production each have 86 migration-history rows; only 34 exact version IDs overlap, 52 per environment do not. Equal counts do **not** mean schema parity.
- Required direct Core/VOX tables and columns inspected through read-only information_schema: **six existing source tables ready**, **ten VOX Staff/queue tables absent** in each environment. The existing sources are `profiles`, `cities`, `aarohi_prospects`, `vendors`, `marketplace_service_zones`, `vendor_support_threads`.
- Staging 142 public tables, production 141. Staging-only table at inventory point `vendor_change_review_audit_v3`.
- Supabase Security Advisor in both environments: ERROR `public.vendor_public_v` SECURITY DEFINER view; WARN `is_admin()` and `owns_vendor(uuid)` authenticated callable SECURITY DEFINER functions. These are **review findings**, not a proven exploit and not permission to revoke privileges blindly. Proposed remediation requires DBA/RLS evaluation with the vendor public listing and client functionality tested.
- Evidence snapshot is metadata-only in `ops/vox/certification/TO04C-LIVE-SCHEMA-EVIDENCE.json`. Node source check `--release-check` exits **42** while uncertified; passing its CI means the release was successfully **blocked**, not approved.

## First Team Leader approval: how the next authorized decision must work
- Existing Core Superadmin nominates a *verified existing neutral Staff account UUID* with exact team/city, bounded expiry, immutable nonce, rationale and AAL2 evidence.
- A **different, independently authorized human reviewer**, who is neither owner nor candidate, checks identity, the exact nomination and business scope and signs the canonical packet using a separately governed Ed25519 key.
- A Core-only offline signature verifier in `contracts/vox/firstTlAttestation.mjs` checks reviewer identity, cryptographic signature, the **trusted pinned server-side reviewer public key/fingerprint**, nonce, scope and 24h freshness. It **never** returns bootstrap authorization; passing the signature is necessary but not sufficient.
- Separate DBA/security-reviewed *one-time* DB transaction must independently verify genuine Supabase AAL2, active candidate, reviewer authority, consume the nonce atomically, audit, grant only scoped TL membership and support immediate revocation. **That transaction has NOT been implemented, applied or approved here.**
- No real independent reviewer trust anchor or human attestation exists yet. No candidate account was nominated/created. A generated synthetic CI key is NOT human approval.

## Further P0s before any stage deployment
1. Independent DBA decides the single canonical Core grant SQL/HTTP path (B currently only source baseline), compares old candidate A, reconciles actual staging migration history and verifies restricted backup/isolated restoration. No automatic history rewrites.
2. Real synthetic Supabase Auth MFA/AAL2 Staff/Admin/TL positive and negative HTTP/IDOR, cross-team, replay and revocation on the *reviewed actual schema*.
3. Core ↔ Jarvis Riya/Anisha/Aarohi signed pause/consent/ack handover; AGNI visibility and regulated provider-outbox checks. Current Riya code is **non-executable intent only**, not live human chat.
4. Real source city and verified Google Places invariant, task capacity/concurrency, staff invitation lifecycle and end-to-end EOD watermark completeness.
5. Protected independent security/DBA review, signed images exact digest, private stage, rollback rehearsal, owner explicit go/no-go. No permission activation without these.

**Status: All source code and CI here are release-hold safety prerequisites, NOT production launch certification.** Full human, staged and provider dependencies remain OPEN.
