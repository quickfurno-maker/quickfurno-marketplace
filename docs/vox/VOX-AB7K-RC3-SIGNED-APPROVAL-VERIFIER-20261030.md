# VOX AB7K RC3 — Ed25519 signed-approval verifier component

**Date:** 2026-10-30. **Base:** `35765ea7`. **Status: DRAFT / HOLD / canApply=false.** Source-only; nothing here was executed, applied or reviewed by an independent human. AI review is not independent sign-off.

## What was built

`contracts/vox/ab7kSignedApprovalVerifier.mjs` — a reusable verifier, **not** a writer and **not** an approval.

- Real `node:crypto` `verify(null, bytes, publicKey, signature)` over canonical bytes. Header `qf.vox.ab7k.signed-approval/v1`, then fixed-order `key=value\n` lines for: `domain, version, type, environment, keyId, signerRole, signerId, ownerId, teamLeaderId, subjectId, digest, targetHash, nonce, issuedAtMs, expiresAtMs`. Every value is strictly validated (lowercase UUID / 64-hex / bounded ints), so no field can inject a delimiter. Types: `EOD_OFFICIAL_RELEASE`, `OPERATOR_COMMAND`. Environment is `staging` only.
- Pinned signer registry (`VOX_AB7K_APPROVAL_SIGNER_REGISTRY_JSON`, **public keys only**). Entry = keyId, SPKI PEM, SHA-256 SPKI fingerprint, signerId, role, validity window. **Empty/missing/invalid => DENY.** Any invalid entry voids the whole registry. Rejected: private-key PEMs (`createPublicKey` would silently derive a public key from one), non-Ed25519, fingerprint mismatch, duplicate key/keyId, and one signer enrolled as both Owner and Team Leader.
- Checks: exact shape; subject/digest/target/Owner/TL binding to caller-supplied expectations; signer == Owner (resp. TL) of the subject and key enrolled for that role; Owner != TL, distinct keys and nonces; max 15 min lifetime, 30 s skew, key validity window; canonical 86-char base64url signature (one encoding per signature); replay nonce claim **after** signature success, **only after both halves verify** for the pair.
- Result is always `approved:false, canAuthorize:false` with an explicit `requires[]` list.

## Tests (written, NOT executed)

`scripts/mvp/vox/validate-voxAB7K-signed-approval-verifier.test.mjs`, run with `node --test`. Throwaway keys are generated in-process only; none is written to disk or env. Covers a golden-bytes check against an independently written message, positive single and pair, forged/tampered signatures, wrong subject/digest/target/Owner/TL, wrong role and relabelled keys, unknown/revoked/out-of-window keys, private/RSA/EC/fingerprint/dual-role registry rejection, empty env registry, expiry/not-yet-valid/over-long, replay (including no nonce burn on failure and throwing stores), cross-type/domain/version/raw-JSON replay of signatures, digest-only and boolean "evidence", and source guards that no route or service imports the verifier and the AB7G route and overlay remain hard-off.

## Deliberately unchanged

- `app/api/vox/v1/official-eod-publish/route.ts` still returns 503 via `VERIFIED_APPROVAL_WRITER_INSTALLED=false`.
- `services/jarvisOperatorCommandService.ts` untouched; `VOX_AB7H_SIGNED_OPERATOR_ATOMIC_ENABLED` still must not be set.
- SQL overlay, AB7B consent and recovery files untouched. No provider send, env, managed or production change.

## Still missing (why AB7G/AB7H stay OFF)

1. **Enrollment/attestation:** nobody has enrolled real Owner/TL human signing keys. The registry is only as trustworthy as its out-of-band provisioning; the fingerprint inside the same config is a typo guard, not an independent pin. Needs a governed enrollment ceremony and a reviewed source of truth.
2. **Server-verified AAL2:** a signature does not prove the current session is the Owner/TL at AAL2. The existing `verifyVoxOwnerBearer` covers Owner only; no TL equivalent was found.
3. **Durable replay store:** only the interface exists. Tests use an in-memory stub. Production needs a durable, atomic, unique-key store (`durable:true`).
4. **DB writer/gate:** the SQL publish RPC still takes a caller-supplied Owner UUID, and the overlay blocks all approval-table writes. Postgres has no Ed25519 verification here, so the DB cannot re-check the signature. A SECURITY DEFINER writer must re-validate current AAL2, roles, membership, expiry and independence atomically, with the verifier result bound in by an authorized path. None exists.
5. Independent DBA/AppSec review; the 3 open recovery catalog differences (RC2 doc, Track C) remain.

SHA-256 `digest`/`targetHash` fields are content bindings. They are never treated as verification anywhere in this component.
