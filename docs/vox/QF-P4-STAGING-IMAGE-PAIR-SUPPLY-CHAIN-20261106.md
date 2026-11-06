# QF P4 — Staging Core + VOX signed image pair (NO DEPLOY)

**6 Nov 2026 · Draft source work only · Production / public registration / Finance / provider messaging / staff / lead routing HOLD.**

## Why this exists

The QuickFurno Phase 15 `scale-container-supply-chain.yml` legitimately permits signing/publishing **production** image releases only from reviewed `main`, with the production public build configuration. Reusing that output for Staging could bake the wrong Supabase public project into browser code. The new **separate** `.github/workflows/qf-p4-staging-image-pair.yml` closes the missing **Staging-specific** source-to-signed-image handoff, without changing the protected production publisher.

Source branch is stacked on Draft PR #501. The workflow is not eligible for manual dispatch until reviewed and merged onto protected default `main`. A PR run only verifies the workflow policy. Nothing is published automatically.

## Hard guardrails

- Manual `workflow_dispatch` must originate from `refs/heads/main` with `publish_staging_pair=true` and exact typed `PUBLISH_STAGING_PAIR_ONLY`; repo variable `QF_STAGING_IMAGE_PUBLISH_APPROVED=true` must be explicitly set at an authorized release window, not beforehand.
- Job uses the already-configured **staging** GitHub environment (observed 6 Nov: required reviewer, 1-minute wait timer and branch restriction); it requires separate environment approval. Do not loosen these rules.
- GitHub environment public-only variables `QF_STAGING_PUBLIC_SUPABASE_URL` and `QF_STAGING_PUBLIC_SUPABASE_ANON_KEY` must be set manually after verification. URL must equal `https://uckafzuochmbvtiodmcl.supabase.co`; legacy JWT key role/ref must equal `anon` and the Staging project; only an explicitly configured publishable key is otherwise allowed. Never use production URL/key or any service-role secret. As of 6 Nov these variables were **not present**; the repo publication approval variable was also absent, so publication is disabled.
- Two **separate staging-only GHCR packages**, exact source SHA labels, HIGH/CRITICAL fixable Trivy report enforcement, SPDX JSON SBOMs, pinned third-party GitHub Actions, keyless Cosign signing and signature verification, GitHub build provenance for **both immutable OCI registry digests**. No `actions/upload-artifact` storage quota dependency.
- There is **no SSH, database migration, Docker container run, reverse proxy change, Staging VPS deployment, enabled provider flag, wallet/lead operation or Production capability** in the workflow.
- The signed image workflow can still fail closed if GHCR permission, GitHub private-repository attestations, fixable security findings or environment approvals are not available. No downgrade to unsigned releases, no silent waiver.

## Present exact-head preview evidence (not equivalent to a signed release)

Review candidate PR #501 SHA `1841b37a36e2fee1c20269979d9f6147f8bd4fa5` produced an **unsigned inactive preview pair**: Core image ID `sha256:216680877723679b5baab5c1dee16ae7a24242ad4a7ce6a38063e767a5893e26`, VOX image ID `sha256:27db95d7feccc1d868fc3a07fa5204d81505c90087876d5a00dc156d9ad58a1b`. Both were hashed, loaded into the Staging VPS and tested in ephemeral `--network none` containers; no live service swapped. New Core /livez 200, Owner queue/case 503 (flags OFF), private evidence GET 405, VOX overview no-session 401; new VOX health/Owner page 200 and disabled queue 503. Existing running Core remains older image and has new routes 404.

Offline Staging backup restore with historical real data and seven vendor SQL rehearse **PASS**; see [Notion recovery certificate](https://app.notion.com/p/410751ba167c8188a58dff4fa0aabba8). This does not replace a fresh post-migration managed restore or real rollback.

## Release procedure (NOT EXECUTED)

1. Obtain full source/security review of the stacked PR train, independent AppSec/DBA exceptions, correct migration inventory and protected main merge. Do not merge solely because source tests pass.
2. Verify Staging GitHub environment protections and variables, confirm registry/private attestations available; request explicit Owner publication authorization and set the repo opt-in **only for the approved publication window**.
3. Manually dispatch the workflow from reviewed main. Capture exact SHA, registry digest references for **both** signed Staging images, signatures, attestation and security scans. Disable the temporary opt-in afterward.
4. Run protected RC38 / owner staging release gates; verify current managed backup, Auth/Storage restore, signed rollback plan, Cloudflare Owner AAL2 and feature switches remain OFF. A signed pair is only an artifact, not an automatically approved Staging deployment.
5. Separately authorize protected Core/VOX Staging image deployment/rollback, then genuine MFA positive/negative Owner queue/case E2E with safe synthetic records and **no private document approval** while ClamAV deferred. Public registration, provider sends, lead routing, Finance, staff and Production remain OFF.

## QA and mutation gates

`node scripts/mvp/launch/validate-staging-image-pair-workflow.mjs`
`node --test scripts/mvp/launch/validate-staging-image-pair-workflow.test.mjs`

The validator always reports `releaseAuthorized:false` and `deploys:false`. Mutation tests reject auto-publish, bypassed main, absent typed approval, missing opt-in, wrong project URL, missing vulnerability check, missing provenance, secret injection, unpinned action and SSH deployment attempt. Syntax also verified with the existing cached YAML parser.

**Operator decision:** review-only PR, no publishing and no Staging/Production deployment authorized. ClamAV and 8→16 GB upgrade remain the final-stage HOLD per Owner.


## 6 Nov 2026 — Main-branch integration hazard verified before protected merge

Direct comparison of source candidate `515aec6a` against protected `main` at `b9f8ada9` on JARVIS found **1,257 candidate-only commits and 1,545 changed paths** (109,288 added lines / 605 removed). Approximately **151 changed paths match Staff, Team Leader, Presence, Meet, task-time or attendance terms**; 84 newly introduced API route source files and 7 vendor migration files are also in the history. The independent `apps/vox-web/Dockerfile` and `apps/vox-web/package.json` are **absent on main**, so cherry-picking only this workflow and immediately publishing would fail. The branch merges cleanly at a textual level, but that is **not a product-scope release certification**.

**Owner-only release constraint:** Staff **activation** remains frozen for the vendor pilot, while Staff engineering proceeds independently in Track B. Do not merge or promote the full branch stack to `main` as an incidental step to sign the image pair. First create and review a minimally scoped Owner-only Core + VOX release tree with explicit import/dependency ownership and all Staff flags OFF; independently reconcile the seven already-live Staging SQL migrations, run source/security/rollback gates, and obtain protected approval. This scoped extraction is an **OPEN engineering task**: the current PR stack is an evidence source, not itself a safe mainline release bundle.

## Additional publisher integrity gates (this batch)

- **Public key project binding:** An opaque `sb_publishable_` key cannot be cryptographically tied to this Staging project from its string alone; the workflow now **fails closed** on it. For the planned offline project-ref check, use the legacy Staging `anon` JWT and verify `role=anon` + `ref=uckafzuochmbvtiodmcl`; no key material is logged. Revisit the publishable-key option only after a separate trusted project binding is implemented.
- **Push/pull swap:** Record exact Docker image IDs after both successful builds; after publishing and pulling, require both image IDs to match the recorded pre-push images before digest signing.
- **Attestation verification:** After GitHub writes both registry provenance attestations, verify **both** immutable Core and VOX references through `gh attestation verify`; failure aborts publication certification.
- **Authenticated attestation check:** `gh attestation verify` uses the standard ephemeral GitHub Actions `GH_TOKEN` for private-repository API access, checks both OCI digests against this repository, and fails closed if unavailable; no token is logged.
- **QA:** source-only workflow/mutation suite and YAML parser must pass on the final committed head. Signed images remain **NOT published**, publication variables unset, PR DRAFT.
