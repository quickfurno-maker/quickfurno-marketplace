# F21 — internal parallel Owner positive integration, protected release lineage, local archive recovery

**Date: 7 November 2026.** Internal-first, all external dependencies remain parked. **Release decision: HOLD.** No managed Staging, Meta/Supabase configuration, credential rotation, real OTP or Production deployment.

## Track A — Protected release-chain integration review

The original F0/F1/F5/F6/F7 GitHub protected workflows are intentionally unchanged. New `f21_protected_release_review.py` checks thirteen exact original security files and pinned manifests against the original BASE / F7 commit objects and reruns F10's signed, account-bound cross-phase source recert. It verifies that all ten F18 managed migration source SHA pins remain intact, F20 is an ancestor, and the only F21 runtime change is the named standalone VOX Owner verification bridge. **Ten hostile lineage tests PASS**: missing protected file, wrong historical F7 pin, nonexistent F20 base and no-deploy attestation fail closed.

The original historical GitHub workflow runs **remain FAILED** (F0 #42359751693, F1 #42213054624, F5 #42213054292, F6 #42213054355, F7 #42347125699) because their old per-source/per-branch exact checks don't understand stacked changes. This checker **does not waive, modify or disable** them, and explicitly returns `releaseVerdict=HOLD` and `newIntegratedReleaseApprovalGranted=false`. A formal protected branch rule/required-check review is still pending. Historical immutable verifiers and migrations remain untouched.

## Track B — actual positive synthetic Owner/VOX workflow

A real internal gap was found using `scripts/mvp/launch/f21_owner_positive_synthetic.test.cjs`: standalone VOX previously accepted extra unrecognized keys from a Core vendor review **decision** response. It projected only known keys, so this was not a demonstrated data leak, but accepting unreviewed Core fields violates the strict cross-service contract. **Production code fix in just** `apps/vox-web/lib/ownerVendorVerification.ts`: add an exact eight-key allowlist for `ownerVendorDecision` replies; reject any additional/unrecognized fields with the existing fail-closed `OWNER_DECISION_OUTCOME_UNCONFIRMED` path.

**23/23 synthetic tests PASS** against dynamically transpiled actual Core route and standalone VOX Owner BFF code, with in-process fake Core, AAL2 and DB **only** (no network, tokens, or real credentials). They verify successful Owner AAL2 GET and POST, immutable Owner decision without vendor activation or credits, second Owner authentication check, no forged reviewer identity, strict version and reason, cookie/origin and bad content, revoked session, fake Core RPC failure, full positive VOX queue/case/decision, exact trusted field schemas, duplicate and overlong queues, content-type spoof, wrong Core vendor, session revocation and owner-only gate. The original Core Owner overview synthetic AAL2 harness separately passed **6/6**.

Existing **VOX Owner/staff 161/161** and marketplace/assignment/communication **137/137** source tests PASS; **root and standalone VOX app TypeScript checks PASS**. The bounded staff source work is reused, not rebuilt.

**Internal test coverage gap identified transparently:** existing `apps/vox-web/package.json` `npm test` references **25 missing legacy script files**; the directory isn't present in this repository. Neither this PR nor F19's source tests silently certify those missing tests. A new additive `npm run test:internal` executes the *actually available* 161 VOX internal gates, 6 real Core Owner overview AAL2 simulation checks, and the 23 new Owner/vendor flow checks. **It passed on JARVIS**; the broken historical `npm test` entry was left intact as a tracked internal follow-up, not falsely marked green.

## Track C — true local archived Docker image import and isolated recovery

JARVIS local archive `qf-core-f17-candidate-cb9a1919.tar` (227,779,072 bytes; SHA256 `c2eb6c782a76496633834fac9355970ceb1602a0f5600f82ca4b779de1ab626c`) was fully hashed and loaded into **local** Docker with `docker load`. The imported image ID exactly matched `sha256:5cecf98b75ec64d52f78e6b3b3db97fe73c6e982c08c696b047b9587f1fc3dc4`. A temporary recovery alias was created and a real **17/17 local Core HTTP** rehearsal ran in `--network none`, without ports, real secrets or external providers. Alias and temporary container were removed; original source-tag image intact.

**Limits:** this certifies recovery of the **F17 candidate artifact** to a local Docker daemon, not rollback of the older *actual* October Staging image on the VPS, nor publisher signature or current F21 exact-source image. F21 changes VOX Owner BFF source; a new exact-head VOX release build and signed review are required before live promotion.

## Internal completion ledger

- **Resolved:** Owner Core→VOX decision exact-schema security gap; real synthetic Owner positive and negative contracts; a maintained standalone VOX internal test command; original source-lineage immutability review; local archive restore with no-network HTTP replay.
- **Pending INTERNAL:** restore/reconcile the missing 25 historical standalone VOX test script references (or formally replace coverage after review), complete positive STAFF simulated role/tracking workflows, and finalize governed integration-branch required-check acceptance and exact-head signed image packaging. These are not deferred *external* dependencies; continue in the next internal batch.
- **External LAST:** exposed Staging legacy Supabase service-role JWT and existing Meta bearer token rotation/revocation (P0, cannot be waived), vendor Meta callback, Supabase Send SMS Auth Hook registration and signing, distinct Riya+Anisha runtime secrets, fresh managed DB/Auth/Storage recovery, signed image Owner GO, consented handset OTP. ClamAV Owner-deferred with scan-dependent approval/assignment/credits fail closed. Aadhaar mandatory vs voluntary/alternative proof needs product/legal resolution.

Evidence file `docs/launch/qf-f21-internal-evidence-20261107.json` contains only safe aggregate results, archive hashes and unresolved gate names, no secrets or customer data. **No live Staging/Production action taken.**
