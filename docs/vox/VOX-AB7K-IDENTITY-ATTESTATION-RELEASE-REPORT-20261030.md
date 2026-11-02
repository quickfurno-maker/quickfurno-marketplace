# VOX AB7K — Privileged identity and approval attestation release report (issue #444)

Branch `fix/vox-ab7k-identity-attest-20261030` from `7c7508a0`. Source-only. **Nothing here was executed**: no shell, git, database, network or test runner was available in this session. Every statement below is from reading the source.

## Verdict

**HOLD for AB7F/J identity and AB7G/H approval attestations.** No feature is authorized. The new gate (`contracts/vox/ab7kIdentityAttestationGate.mjs`) returns `authorized:false` for all four features by construction.

## Verified in source vs. unproven

| Item | Status |
|---|---|
| AB7G approval table (`vox_ab7g_eod_owner_approvals_candidate_v1`) has any writer | **None exists.** The only inserts anywhere are PG17 test scripts using `repeat('f',64)`. |
| AB7H approval table (`vox_ab7h_operator_review_candidate_v1`) has any writer | **None exists.** Same. |
| `verified_signature_digest` / `verified_signature_sha256` are signature verification | **No.** They are `text` columns with a `^[a-f0-9]{64}$` check. No SQL verifies Ed25519 (the word appears only in comments). |
| Pinned Ed25519 verification elsewhere (AB7G signed manifest contract) | Exists in JS for the staging manifest, but it is not wired to any approval writer, and its result is not carried into the approval rows. |
| AB7J `qf_vox_ab7j_tl_approve_staff_suspend_v1` writes `vox_ab7i_staff_suspend_approvals_candidate_v1` | **Real writer in source.** It uses `auth.uid()` and JWT `aal`, and is granted to `authenticated` only. Its identity is a Supabase JWT, not an Ed25519 signature, and `signed_decision_digest` is just the caller-supplied request digest. |
| AB7J AAL2 check | **Defect in the candidate:** `(auth.jwt()->>'aal')<>'aal2'` is NULL when the claim is absent, and plpgsql `IF` treats NULL as false, so a JWT with no `aal` claim passes. Fixed in the overlay with `coalesce(...,'')`. |
| `me::text = jwt sub` check | Tautological, because `auth.uid()` derives from `sub`. It adds no independent assurance. |
| Owner identity | In SQL, "Owner" is only `profiles.role='admin' and is_active`. The HTTP route additionally requires `app_metadata.admin_role='Superadmin'` (`verifyVoxOwnerBearer`). The DB does not check Superadmin. |
| Team Leader identity | `vox_staff_memberships_v1.staff_role='team_leader'`, active, not revoked, unexpired, same team, `profiles.role is null`. Consistent across AB7F/G/H/J. |
| MFA principal consistency | AB7J checks Owner AAL2 only at propose time and TL AAL2 only at approve time. Owner AAL2 is not re-proven at approval or execution; Owner is only re-checked as an active admin. The 10-minute lease bounds this. AB7G/H/F-conversation have **no** MFA check in SQL; they rely on a caller-supplied UUID. |
| AB7G publish, AB7H, AB7F-conversation RPCs | `SECURITY DEFINER`, `service_role` EXECUTE, trust caller-provided `p_owner`/`p_tl`/`p_operator`. A `service_role` caller has no `auth.uid()`, so the current principal cannot be proven. AB7F-conversation has **no** attestation at all. |
| AB7F staff suspend | Gated by an exact matching AB7J approval row, which `service_role` cannot create. A `service_role` caller can execute only exactly what both humans approved. |
| Candidate ledger privileges | The AB7F receipts and EOD tables revoke only `public`/`anon`/`authenticated`, so Supabase default privileges leave `service_role` with INSERT/UPDATE/DELETE. That allows forged EOD reports and receipts. |
| Any behavior against a real PostgreSQL | **Unproven** (not run). |

## Changes

1. `ops/vox/identity-attestation-overlay/20261030010000_vox_ab7k_identity_attestation_fail_closed_overlay.sql` (new, uninstalled):
   - Precondition `DO` block fails if the AB7F–J candidates are absent.
   - An always-on trigger (`enable always`, row and truncate) blocks all writes to the AB7G and AB7H approval tables, even for superusers, until a reviewed writer replaces it.
   - Revokes EXECUTE from `public`/`anon`/`authenticated`/`service_role` on the AB7G publish, AB7H and AB7F-conversation RPCs.
   - Reduces `service_role` to SELECT on all nine AB7F–J ledgers.
   - Null-safe AAL2 and `role='authenticated'` checks in the two AB7J functions (`create or replace`, same grants).
   - No broader role is granted anywhere.
2. `app/api/vox/v1/official-eod-publish/route.ts`: hard-off constant `VERIFIED_APPROVAL_WRITER_INSTALLED=false` returns 503 before any auth or DB call, so env flags alone cannot enable it.
3. `contracts/vox/ab7kIdentityAttestationGate.mjs`: replays grants and DDL from the actual SQL (comments stripped) and reports writers, executable roles and `service_role` write access.
4. Tests: `scripts/mvp/vox/validate-voxAB7K-identity-attestation.test.mjs` (new), and `validate-voxAB7G-eod-http.test.mjs` (updated: shipped route asserted hard-off; the old downstream-gate tests are kept by patching only the constant in the test transpile).
5. `ops/vox/identity-attestation-overlay/verify_ab7k_identity_overlay_disposable_only.sql`: a rolled-back privilege and guard assertion script for a disposable PG17.

Not changed: applied migrations, the 30 pinned candidate SQL files, AB7B, the recovery packet, the manifest and the fingerprint JSON.

## Least privilege after overlay

- `service_role`: SELECT on ledgers; EXECUTE only on `qf_vox_ab7f_staff_suspend_atomic_candidate_v1` (bound to the AB7J approval).
- `authenticated`: EXECUTE only on the two AB7J functions; each denies non-Owner and non-TL callers inside.
- `anon`, `public`: nothing.

## Test coverage (source level, not executed)

Self-review, unknown approver, expired approval and replay are tested against the real `publishReviewedEod` and `suspendCoreStaffGrants` contracts with RPC call counts of zero for every pre-RPC denial. **Caveat:** these contracts take their verifiers as injected functions, so the tests show orchestration, not cryptography. SQL-level replay and expiry (nonce primary keys, `expires_at>clock_timestamp()`) are asserted structurally and still need the disposable PG17 run.

## Residual gaps

1. **The overlay is not in the pinned 30-file manifest or fingerprint.** I could not regenerate SHA-256s without a shell, and the manifest expects exactly 23 candidates. Until a human pins and orders it, a deployment of only the 30 files lacks these fixes. The release owner must extend the manifest and fingerprint deliberately.
2. No AB7G/H attestation writer or in-database Ed25519 verifier exists. Closing this needs a reviewed design (for example an `authenticated` AAL2 two-party writer like AB7J, or a pinned-key verification extension) and removal of the guard trigger in a reviewed migration.
3. `jarvisOperatorCommandService.ts` still has the legacy split-write path when `VOX_AB7H_SIGNED_OPERATOR_ATOMIC_ENABLED` is off, and the AB7H branch now gets a permission error (UNAVAILABLE, retryable) after the overlay. Not changed here.
4. Owner Superadmin is not enforced in the database. Owner AAL2 is not re-proven at execution.
5. A superuser can drop the guard trigger; the guard is not protection against a compromised DBA.
6. Supabase `aal` is a JWT claim, so assurance depends on correct Supabase MFA enrollment.

## Exact remaining Owner/TL AAL2 requirements

- A real, independent first Team Leader enrolled in TOTP/AAL2, distinct from the Owner and from every target.
- A real Owner with `profiles.role='admin'`, `app_metadata.admin_role='Superadmin'`, and AAL2.
- A live AAL2 Owner propose followed by a TL approve within 10 minutes for each suspension, on protected staging.

## Tests not executed

All of them, including: `validate-voxAB7K-identity-attestation.test.mjs`, `validate-voxAB7G-eod-http.test.mjs`, `validate-voxAB7K-manifest.test.mjs`, the AB7F/K PG17 scripts, `verify_ab7k_identity_overlay_disposable_only.sql`, and `npm run build`. The regex-based SQL analysis is itself untested code.

## Human sign-off required

Independent DBA and AppSec review of the overlay and writer design, an Owner GO/NO-GO, a manifest/fingerprint decision, and a disposable PG17 run. **RELEASE HOLD; no merge, staging apply or production use.**
