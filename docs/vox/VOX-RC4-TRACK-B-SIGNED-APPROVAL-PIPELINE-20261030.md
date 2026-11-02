# VOX RC4 Track B: signed EOD / operator approval PREPARATION pipeline (2026-10-30)

Base `f5dd7e48` (PR #446 DRAFT). Source-only. **Nothing here was executed**: this
session had no shell, so no test, SQL or build has been run. Treat every
"expected" below as unverified until a human runs the commands in section 4.

## 1. Status

`approved:false`, `canAuthorize:false`, `officialEodEnabled:false` on every code
path. No signer is installed or claimed. `RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS`
is empty, so the pipeline denies every real registry by default
(`KEY_ENROLMENT_NOT_HUMAN_APPROVED_DENY`). The official EOD route and its
`VERIFIED_APPROVAL_WRITER_INSTALLED=false` gate are untouched.

## 2. Files (all new; no existing file edited)

| File | Purpose |
|---|---|
| `contracts/vox/rc4ApprovalPipeline.mjs` | Pipeline; composes the RC3 `ab7kSignedApprovalVerifier.mjs` unchanged |
| `scripts/mvp/vox/rc4-approval-pipeline.test.mjs` | Node tests with real throwaway Ed25519 keys |
| `ops/vox/rc4-approval-overlay/20261030020000_vox_rc4_approval_nonce_ledger_disposable.sql` | Disposable-PG17 append-only nonce/subject ledger + revocation table |
| `ops/vox/rc4-approval-overlay/verify_rc4_approval_ledger_disposable_only.sql` | Rolled-back verification script for the ledger |
| this file | |

## 3. Design

- **Actors come only from verified Core-auth.** `mintRc4VerifiedAuthContext` returns
  a frozen, WeakSet-branded object, or `null` unless: `jwtRole=authenticated`,
  `aal=aal2`, active profile, no membership revocation, and an unambiguous role
  (Owner = admin profile with no staff role/team; Team Leader = non-admin profile
  with `team_leader` membership, team and city). A request body cannot carry the
  brand; request keys that look like actor claims are rejected
  (`ACTOR_CLAIM_IN_REQUEST_DENIED`). The request may contain only
  `type, subjectId, digest, teamId, cityId` and the two envelopes.
- **Currency is re-checked at `now`:** AAL2 within 15 min, session and TL
  membership unexpired, distinct users and distinct sessions.
- **Signed expected values are derived server-side:** Owner/TL ids come from the auth
  contexts; `targetHash = deriveAb7kTargetHash("RC4_SCOPE",[type,subject,team,city])`,
  so team/city are inside the signed bytes without changing the RC3 payload format.
  TL context team/city must also equal the request scope.
- **Two pins on keys:** RC3 registry validation (Ed25519 public only, fingerprint,
  one role per signer, validity window) plus an out-of-band registry fingerprint
  allow-list (empty). Explicit revocation lists (`keyIds`, `signerIds`) are required
  input; absent/malformed => deny.
- **Replay:** verification runs first with a collecting store (nothing persisted);
  then one `ledger.claimAll({nonceKeys[2],subjectKey,expiresAtMs})` claims both
  nonces **and** the subject atomically. A subject can be prepared once; a retry
  needs a new subject id. Failed verification never burns a nonce; a failing or
  non-`true` ledger denies and claims nothing.
- **SQL ledger (disposable only):** refuses to install unless the database name starts
  `qf_disposable_` and server is PG17+; PK on key hash; append-only (always-on row
  and truncate triggers); `qf_vox_rc4_claim_approval_keys_v1` inserts 2 nonces +
  subject inside a sub-transaction (unique violation => `RC4_REPLAY_DENIED`, nothing
  kept), rejects expired or >15m30s expiries; no role is granted anything. It does
  not verify signatures and writes no approval row.

## 4. Tests to run (by a human)

```
node --test scripts/mvp/vox/rc4-approval-pipeline.test.mjs
node --test scripts/mvp/vox/validate-voxAB7K-signed-approval-verifier.test.mjs
```
Disposable PG17 only (database named `qf_disposable_*`): apply the ledger SQL, then
run the verify script as owner; expect notice `RC4_LEDGER_VERIFY_PASSED_DISPOSABLE_ONLY`.
Neither the SQL nor the tests were run by the author; the SQL in particular is
unexecuted and may contain syntax errors.

Negative coverage in the Node test: forged/attacker-key/bit-flipped/tampered/digest-only
signatures, expired / not-yet-valid / over-long, stale AAL2, expired session or
membership, replay (same pair, fresh nonces same subject, reused single nonce),
wrong role and swapped slots, same user/session/dual-role/same nonce, wrong
team/city (context and signed scope), revoked key and signer, missing/garbled
revocation list, ledger failure atomicity, 8-way race with one winner, request-body
actor claims, JSON look-alike auth contexts, and source guards (unwired, no key
material/env/network, SQL grants nothing).

## 5. Open blockers / safe activation prerequisites

1. Human enrolment ceremony for Owner and Team Leader signing keys (private keys
   never touch the server); reviewed commit adding the registry fingerprint.
2. A real Core-auth adapter that verifies the JWT, reads `aal`, re-reads profile and
   `vox_staff_memberships_v1`, and is the only caller of `mintRc4VerifiedAuthContext`.
   Not written here (outside this track's paths).
3. A durable `ledger.claimAll` adapter over the SQL function, executed by a dedicated
   reviewed role (no grants exist today); the in-memory ledger is test-only.
4. A revocation source wired to `vox_rc4_key_revocations_v1`
   (`qf_vox_rc4_is_revoked_v1`) with a freshness requirement.
5. An authorized atomic DB writer that re-verifies in the database. The AB7K overlay
   trigger `AB7K_VERIFIED_ATTESTATION_WRITER_NOT_INSTALLED` still blocks AB7G/AB7H
   approval writes; this track does not lift it. RC3 notes DB-side Ed25519 is absent.
6. The ledger migration needs placement in the release ordering (it sits outside the
   pinned AB7K fingerprint); nonce rows are never pruned (append-only by design).
7. Independent DBA/AppSec review, PG17 execution of the SQL, then Staging evidence.
8. Auth-to-key binding is by signer UUID equality only; there is no proof that the
   key holder is the logged-in human beyond the enrolment ceremony.
9. Operator-command (`OPERATOR_COMMAND`) uses the same scope hash; per-command target
   binding (conversation/revision/action) should be folded in when that track wires it.
