# Anisha A2g — Real Next.js HTTPS route certification (ephemeral Docker)

Date: 2026-10-12 IST. **Application HTTPS route certification: PASS (9/9). Persistent hosted staging: NOT DEPLOYED. Production: OFF.**

## Environment

Tested the exact QuickFurno Core staged branch in a one-shot Linux container, built from `ops/anisha-a2g/Dockerfile.cert` using Node.js 20.20.2 and `npm ci` from the checked-in lockfile. Docker Linux engine 29.8.2; container run with `--network none`, `--memory 3g`, `--cpus 2`, no host port exposure, no mounted production secrets, no WhatsApp provider or external Supabase use.

The harness `scripts/mvp/jarvis/certify-anisha-https-next-routes.mjs` starts an actual Next.js development application, a temporary local TLS reverse proxy, and an isolated synthetic-only PostgREST-shaped stub. It creates an ephemeral Ed25519 keypair and short-lived self-signed TLS certificate, executes signed HTTPS requests and removes the temporary certificates. It passes only explicit nonsecret test environment variables to the Next child process. The entire test runs inside the network-disabled Linux container.

Reproduce:

```powershell
docker build --progress=plain -f ops/anisha-a2g/Dockerfile.cert -t qf-anisha-a2g-core-cert:local .
docker run --rm --name qf-anisha-a2g-route-cert --network none --memory 3g --cpus 2 qf-anisha-a2g-core-cert:local
```

## Actual Next.js HTTPS test results

1. The actual Next.js app served HTTPS via the isolated TLS proxy.
2. Real signed-claim route rejected a tampered Ed25519 signature before database access.
3. Claim route rejected an unsigned request.
4. Claim route accepted a correctly signed request and used only the synthetic database backend.
5. ACK route refused acknowledgement before synthetic deletion was marked committed.
6. Correct signed ACK was accepted after synthetic commit.
7. Duplicate ACK was refused.
8. Actual consent route rejected a tampered signed request.
9. Signed consent route **failed closed with 503** when no Core vendor authority existed.

`ANISHA_REAL_NEXT_HTTPS_STAGE_CERT_PASS 9/9` and process exit code 0. No live credentials, production records or real vendor account data were used.

## Integration context

Previously passed:
- Jarvis signed client localhost transport tests (real Ed25519 claim, ACK and consent signing).
- Hosted temporary isolated Supabase Core/Jarvis migrations and two synthetic vendor consent→revoke→actual PostgreSQL erase→ACK→regrant cycles.
- Both isolated preview branches were deleted after the previous certification, and original parent databases were unchanged.
- Jarvis source CI 224/224 tests and Core source CI were green at their previously reported SHAs.

This A2g test verifies **actual Next.js Core application routes over TLS**, not a permanently deployed Core/Jarvis worker-to-worker deployment. The synthetic database stub also does not substitute for a test of the exact API against real Supabase Auth session state or a real on-disk deletion during this specific test. The full end-to-end proof consists of separate, non-equivalent evidence streams and must not be described as one hosted production-like rollout.

## Remaining activation gates

1. Dedicated persistent stage URLs and exact Core + Jarvis service images with matching signing-key references, TLS policy, backup/restore, test vendor auth and purge-worker staging settings. No provider sends.
2. Demonstrate one actual Jarvis process calling the deployed Core Next.js endpoints against isolated, restored-stage Supabase DB, including invalid signature, revoked consent and deletion ACK.
3. Owner-approved vendor privacy notice and purpose-specific opt-in copy, plus live vendor dashboard session validation.
4. Human security review and approval of the stacked Core/Jarvis PRs; release signing and rollback, production-only migrations/activation in an authorized canary.
5. Keep the long-term memory and erasure workers disabled outside specifically authorized staging until all gates are green.

No release, environment, data, message or financial side effect was made during the Docker application certification.
