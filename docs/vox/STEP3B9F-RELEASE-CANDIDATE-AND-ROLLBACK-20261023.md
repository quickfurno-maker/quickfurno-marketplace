# 3B-9F — Source release preflight, signed-image and rollback preparation

## Source-of-truth
- Earlier fully source-CI-verified PR #404 `0b17ec8d432d641fcf6a5d04f5abc867fa770044` (7/7 workflows PASS), stacked on #403.
- New 3B9D/E/F branch must have its own exact-head CI check, separate draft PR and current SHA before anybody treats it as source-reviewed.
- Machine-readable preflight `ops/vox/certification/STEP3B9F-UNSIGNED-RELEASE-PREFLIGHT-20261023.json` records SHA-256 for current source-only evidence artifacts, but is **unsigned** and has final release SHA null.

## Staging readiness and immutable images
- Existing Staging VPS `qf-staging` has Core/Jarvis/AGNI services. Old VOX Web production-mode RC3 image `qf-vox-rc3-release-smoke:12eb177f` has manifest ID `sha256:cf5c24ce1dab1a8ef76dddd4b7668725a04af9ea077d13ea242a175c38b6267f`. It is reachable only on `127.0.0.1:3318` and **auth-disabled**; it is not final signed image of the new release.
- Protected Core `/api/vox/v1/overview` last verified HTTP 404; no genuine Owner AAL2 or Staff integration acceptance. Managed Supabase has 0 VOX/Finance V2 public tables and 0 verified MFA as last checked.
- Before Stage enable: independent DBA + AppSec signed exact SQL decisions, complete verified rollback/ACL/PITR, existing Owner exact **Staging-only** written GO with reviewed SHA and image digest, secure staging secrets, immutable Core/Jarvis/AGNI/VOX builds and read-only preflight.

## Security and runbook
- Public Cloudflare origin/DNS and Production remain unchanged. **Production GO is separate** from Staging approval and cannot be inferred from green source CI.
- Capture desired pod/container SHA, SBOM/dependency/OS scan, signed manifest, healthcheck, ports, secrets from secret manager, WAF, TLS, uptime monitor and genuine negative tenant/MFA tests. Current script does not create attestations/signatures.
- Validate genuinely enrolled Owner AAL2 and first Team Leader's independent bootstrap, revocation, isolated Staff sessions, Agents, Vendor360/ServiceDesk/Finance and Razorpay TEST only after approved Stage deployment.
- **Rollback limitation:** 22-Oct four-schema Staging logical dump is not complete point-in-time/role ACL/physical storage/Auth session recovery. Qualified DBA must certify full rollback/failforward under exact migration and production conditions.
- No auto-promote, no payments, no outbound WhatsApp, no actual new Staging schema grant until gates satisfied.
