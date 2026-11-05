# VOX Owner ↔ Core Vendor Verification: local image provenance precheck (5 Nov 2026)

**Draft stacked on #486; source-only; RELEASE HOLD; no deployment.**

## What is and is not measured

`node scripts/mvp/vox/owner-vendor-image-provenance.mjs --web qf-vox-owner-studio:mfa-ui-20261102 --core qf-vox-core-owner:qa-dd91fa38` uses only *local* `docker image inspect`. It compares the two local images' OCI source-revision labels to the reviewed #486 candidate commit `49cf169eb84be743e6db30b23ee9d9cd57089976`, rejects missing/mismatched image refs and requires immutable `RepoDigests`. It does not pull/build/run an image or touch any server, secret or managed database.

**Observed on JARVIS:** the named Owner image was not installed (`LOCAL_IMAGE_NOT_AVAILABLE`); the named local Core QA image had a different OCI source revision (`OCI_SOURCE_REVISION_MISMATCH`). As expected, `sourcePairMatchesLocally=false`, `deployedHostVerified=false`, `releaseDecision=HOLD`. This does NOT establish which images are currently running behind `vox.quickfurno.in` or `staging-core.quickfurno.in`.

A passing **local** probe would only show local Docker metadata, not a signed build, actual host provenance, UI content, secure storage or live Owner MFA. This tool **never** outputs deployment approval even if local labels match.

## Operator evidence still needed (separate explicit Owner Staging authorization)

1. Identify the *actual* protected VOX Owner host/runtime and Core Staging host; capture their deployed image digests and immutable content identifiers read-only, from the host/runtime/registry rather than old filenames or tags. Do not send secrets, cookies or tokens in the evidence packet.
2. Match the deployed digests to signed CI build provenance, exact native VOX Web #485 and Core #486 source, SBOM and deployment rollback image; verify image signatures/attestations separately. The code-only #486 bridge does not include the seven #484 vendor SQL migrations.
3. Independently reconcile managed Staging migration/schema dependencies and private Storage/scanner before positive Core RPC claims. Verify private bucket ACL and ClamAV EICAR test after separate approval.
4. Perform genuine Cloudflare Access → Owner login → TOTP AAL2 browser testing and negative unauthorized-session tests with feature flags OFF first. After authorized Staging schema, enable read-only queue independently; decision writes remain OFF until further authorization.
5. Capture exact signed rollback procedure and restore drill. Require a separate Owner GO for any deploy. Production and public onboarding remain HOLD.

## Checks

`node --test scripts/mvp/vox/owner-vendor-image-provenance.test.mjs` exercises genuine local-only metadata shape, wrong source label, missing digest, mismatch, missing Owner image, unsafe refs and ensures even a valid local pair returns HOLD. CI runs these *mock-only* tests without contacting Docker or a remote host.
