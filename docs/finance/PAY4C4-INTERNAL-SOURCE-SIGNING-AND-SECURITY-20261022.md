# PAY-4C4 — Internal parallel engineering and operational dependency handoff
**22 October 2026 | SOURCE + DISPOSABLE PostgreSQL 17 only | FINANCE RELEASE HOLD**

Stack: PAY-4C3 [draft PR #394](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/394), parent exact `d6f30aadf88b6fa6beff0ceb7990a2ac865072fa`. PAY-4C4 remains a stacked DRAFT source candidate and not a signed deployment.

## A — Migration truth fixed as actionable FAIL, not falsely green
Previously the canonical tree validator crashed `ENOENT` on the first of 7 deliberately quarantined VOX SQL files. It now enumerates **7 explicit missing post-G1 SQL checks**, plus expected filesystem count **169** versus actual runnable file count **162**, and continues **exit code 1 / MIGRATIONS FAIL**. Quarantined source hashes, migration manifest, expected count, runnable files and managed DB histories are unchanged. This does NOT reconcile database history; review needs exact intended applied/unapplied versions before correcting the canonical manifest by approved process.

Live first-party read-only observations rechecked: QuickFurno Staging **1 Auth user, 0 verified MFA factors, 0 Finance tables, 0 VOX tables**; QuickFurno Production **10 Auth users, 0 verified MFA factors, 0 Finance tables, 0 VOX tables**. Prior managed migration lists both showed 86 versions, without Finance candidates or legacy VOX 20261014. NO managed Staging/production SQL writes or migrations.

## B — Genuine identity: human enrollment dependencies kept explicit
Core Owner Superadmin and Staff use the existing Supabase Auth AAL2 checks, independent approval, scoped grants and revocation. Neither environment currently has a verified MFA factor. Owner must enroll a real existing Core Auth TOTP/WebAuthn factor (per supported policy), independently validate its actual AAL2 session; distinct Staff/first Team Leader must be onboarded via approved independent reviewer with its own AAL2 and Finance grant lifecycle. No fake MFA factor, staff user, reviewer, or self-approval bypass created. Genuine positive/negative authenticated tests cannot run until Staging schema is approved and installed.

## C — Isolated PostgreSQL security remediation trial, not production SQL
New `PAY4C4_` test in network-isolated PostgreSQL17 models the public vendor discovery view using `security_invoker=true` and FORCE RLS on an **isolated synthetic vendor table**, not the real Core vendors schema. It PROVES:
- With RLS enabled and no explicit public read policy, anonymous public view returns **0** vendors.
- With an explicit read-only public eligibility policy, anonymous and authenticated users see **1** Approved, active, visible, positive-credit vendor; pending/invisible/zero-credit rows are hidden.
- Neither anonymous nor authenticated roles has UPDATE privileges.

Real `public.vendor_public_v` currently uses security-definer view semantics; `is_admin()` and `owns_vendor(uuid)` are existing Core RLS helper functions. Switching live view policies or revoking RLS helper EXECUTE without a fully reviewed Core migration could break public discovery. No managed schema/privilege remediation was applied. Real AppSec/DBA review is still P0.

## D — Real cryptographic verification logic, unsigned bundle
`scripts/mvp/payments/financePay4c4ReleaseBill.mjs` creates deterministic SHA-256 source bill-of-materials for 9 sensitive Core+VOX paths plus ordered hashes of **12 Finance SQL candidates** and a caller-asserted 40-character git commit. Ed25519 **detached signature verification** is implemented and tested with ephemeral test keys. Wrong signing key, mismatched digest, malformed signature fail. Even a valid detached signature does **NOT** imply trusted signer-chain pinning, verified immutable GitHub source, backup or Staging approval; `deployAllowed=false` and release HOLD are invariant. No private signing key or real signed deployment artifact generated.

## E — Executable, offline Razorpay TEST rehearsal
`lib/payments/financePay4c4OfflineProviderSuite.mjs` runs the earlier **nine TEST scenarios** through the Finance provider-outcome logic, with deterministic synthetic raw webhook bodies signed and verified with a clearly synthetic local HMAC secret. It checks successful capture, authorized-but-uncaptured, failed, late capture/failure, order mismatch, amount mismatch, merchant mismatch, LIVE event in TEST mode and outage. Each outcome must match fail-closed policy; **zero real provider requests, wallet mutations, refunds or bank transfers**. Signature forgery and malformed HMAC inputs are rejected. This is NOT actual Razorpay sandbox certification or proof of consent/bank statement authenticity.

## F — Continuous QA and exact-commit evidence
PAY1–PAY4C4 Node-focused deterministic finance suite; previous 51 Razorpay integration assertions; isolated native disposable Docker `--network none` PostgreSQL17 candidate SQL RLS + two independent concurrent refund reservations and inbox lease claims + replay/immutability/dead-letter/restore; full Core and VOX TypeScript and production builds; all exact-head GitHub CI checks. Any unexpected failure blocks promotion. The original migration history validator **intentionally remains FAIL** and must be treated separately, never counted as green.

## Exact prerequisites before approved TEST-only Staging application
1. **A + C DBA/AppSec:** resolve seven quarantined VOX versions vs canonical 169 migration manifest and two managed DB histories, role/grants/RLS, vulnerable objects, approved precise 12 candidate SQL order, rollback/forward-fix; obtain independently reviewed approval.
2. **B genuine people:** Owner verified AAL2 MFA and independent first Team Leader/Staff AAL2, reviewer separation and Finance grants through existing Core Auth; human action required.
3. **D protected Staging:** approved fresh backup + actual restore, signed trusted Core+VOX release from pinned Git SHA and reviewed SQL sources, monitoring/alerting/kill switch/worker OFF, Owner TEST-only authorization.
4. **E real Razorpay TEST:** after verified Staging install/MFA/permissions, test actual checkout/capture/failure/signed replay/refund/settlement and bank statement ownership/UTR proof, consumed-credit human policy and staff-visible immutable history. Monitor one-credit-only and refund under captured cap.
5. Independent AppSec/DBA evidence and separate Owner GO/NO-GO **before PRODUCTION** payment activation.

**All release flags OFF; no money actions or managed DB writes. Status: RELEASE HOLD.**
