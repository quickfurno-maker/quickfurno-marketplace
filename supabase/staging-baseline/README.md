# QF-MVP-20 Staging Baseline — STAGING ONLY

**This directory is staging-only. It is intentionally OUTSIDE `supabase/migrations/` so that `supabase db push` can never discover or apply it.**

- **Never apply to production** (`yqpgcsduqbxulrlzwzap`). The only permitted apply target is **staging `uckafzuochmbvtiodmcl`**.
- The **raw production dump is NOT stored here** (or anywhere in Git). It lives only in the external workspace.
- **Not yet applied.** Only **QF-MVP-20.2C** may apply this baseline, after verifying the target is staging.
- **No `supabase db push`** and **no migration-chain replay** — this baseline is applied under one controlled identity, not as part of the repository migration chain.

## Files

| File | Purpose |
|---|---|
| `20260722000100_qf_mvp_staging_baseline_269c9265.sql` | The generated staging baseline (schema-only; least-privilege grants; blockers service_role-only). |
| `verify_qf_mvp_staging_baseline.sql` | SELECT-only post-application parity/safety verification (run after apply in 20.2C). |

## Source evidence

- Source: production **public** schema dump (schema-only).
- Source SHA256: `269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f`
- Generated baseline SHA256: `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81`
- Verification SQL SHA256: `7ba9792f300119b7c1aa84a4c02394186116a507c9097bd6f95f23f55e504193` (**current**, QF-MVP-20.2C2R — exact `to_regprocedure` OID function resolution + `conindid` index classification). Superseded: `e82b757f…` (20.2C1R identity-scoped) and `89362a35…` (original).
- **Status: baseline APPLIED to staging and FULLY VERIFIED** — all 40 corrected verification rows PASS. Migration history holds exactly one row (`20260722000100` / `qf_mvp_staging_baseline_269c9265`).

## Regenerate (deterministic, offline — no DB/network)

Portable form (adjust the external dump path for your machine):

```
node scripts/mvp/staging/generate-staging-baseline.mjs \
  --input "<path-to>/production-public-schema.sql" \
  --output "supabase/staging-baseline/20260722000100_qf_mvp_staging_baseline_269c9265.sql" \
  --grants "scripts/mvp/staging/staging-baseline-grants.json"
```

PowerShell: use backtick (`` ` ``) line continuations instead of `\`.

The generator refuses to run unless the source SHA256 matches, and produces byte-identical output for identical input.

## Validate (offline — no DB/network)

```
node scripts/mvp/staging/validate-staging-baseline.mjs \
  --baseline "supabase/staging-baseline/20260722000100_qf_mvp_staging_baseline_269c9265.sql" \
  --source "<path-to>/production-public-schema.sql" \
  --grants "scripts/mvp/staging/staging-baseline-grants.json"
```

## Application (QF-MVP-20.2C only — NOT in this task)

1. **Verify the target project reference is `uckafzuochmbvtiodmcl`** (staging). Abort if it is `yqpgcsduqbxulrlzwzap` (production) or anything else.
2. Apply the baseline SQL to the empty staging database (single controlled identity `qf_mvp_staging_baseline_269c9265`); the embedded preflight aborts unless the project is empty and the managed prerequisites exist.
3. Run `verify_qf_mvp_staging_baseline.sql` (SELECT-only) and confirm every row is `PASS`.
4. Do **not** push to the migration chain, do **not** insert the 68 repo migration versions into history, do **not** touch production.

## Safety properties (enforced by the generator + validator)

- No production table rows, no secrets, no production URLs, no provider accounts/activation.
- No `ALTER … OWNER TO`, no copied GRANT/REVOKE, no `ALTER DEFAULT PRIVILEGES` for anon/authenticated.
- The four assignment blocker RPCs + legacy credit primitives + `qf_apply_vendor_credit_delta` are **service_role-only** (revoked from PUBLIC/anon/authenticated).
- `anon` receives **no table access** and **no monetization-column reads**.
