# QF-MVP-50.2C-S2 — Staging Migration-History Governance

**Status:** G1 source-governance candidate only  
**Environment:** QuickFurno Staging (`uckafzuochmbvtiodmcl`)  
**Database or migration application authorized by G1:** **NO**

## 1. Intentional staging-history model

QuickFurno Staging has an intentional migration-history shape. It is not expected to mirror the repository's complete historical migration chain version-for-version.

```text
Historical repo chain (68)
        X  not replayed to staging
        |
        v
Controlled staging baseline 20260722000100
        |
        v
18 forward applied migrations
        |
        v
20260803000000 PENDING
```

The legitimate remote-only row `20260722000100 / qf_mvp_staging_baseline_269c9265` records the controlled staging baseline. The baseline remains outside `supabase/migrations/`, so the ordinary repository migration chain cannot discover it.

The 68 earlier repository migrations are retained as historical source. For this staging environment they are classified as `PRE_BASELINE_CHAIN_INTENTIONALLY_SUPERSEDED_FOR_STAGING`, with semantic role `HISTORICAL_SOURCE_CHAIN_NOT_REMOTE_LEDGER_ENTRIES`. They are not pending staging work and must not be replayed, mass-repaired as applied, or inserted into remote history. The baseline row must not be reverted, and the baseline SQL must not be copied into `supabase/migrations/`.

## 2. Baseline checksum provenance correction

The immutable tracked baseline has one Git content revision, Git blob `65e56c0419a986cc14a5abcfb184dd4a82625630`, and current tracked SHA-256 `101ac82c7840eec8802155fec4d4a18cba445447b7d773aaf168417f737aa33c`.

The historical `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81` value is `DOCUMENTATION_ERROR_UNREPRODUCIBLE`: it was not produced by the immutable Git source or the tested LF, CRLF, BOM, and final-newline representations. It is retained only as historical documentation and is not a valid source-integrity gate.

The historical external apply workspace is no longer retained, so its exact file bytes cannot now be re-proven. Application evidence instead remains the exact remote version/name, its 821-statement ledger identity and ordered digest, and the successful staging verification. The source-schema SHA-256 remains `269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f`.

## 3. Forward-applied migrations

Exactly 18 post-baseline versions are approved as common local/remote staging history. The six versions reopened by L3—`20260723001200`, `20260723001300`, `20260728001500`, `20260728001600`, `20260801110000`, and `20260801152049`—are deployment non-blockers: their ledger application and durable semantic postconditions are proven. Missing original whole-file byte streams for some versions do not authorize replay.

The machine-readable manifest is authoritative for the exact 18-version set and the six captured remote statement digests. It deliberately does not invent remote digests for the other 12 versions.

## 4. Pending target

`20260803000000_qf_mvp_50_2c_lead_communication_recipient.sql` is operationally `PENDING` and was absent remotely at L3. Its locked SHA-256 is `77d2bb1162e0522b061f36df787d94c2dad4f0ceeff3e4a07c8946cd4e1d56ca`. G1 imports the accepted S1 preflight record into source control; it does not apply the migration and does not make the historical S1 observation permanent current-state proof.

## 5. Fail-closed deployment boundaries

- **No replay:** never replay the 68 pre-baseline versions on staging.
- **No mass repair:** never mass-repair the 68 versions as applied.
- **No baseline revert or copy:** never revert the remote baseline row or copy the baseline into `supabase/migrations/`.
- **No `--include-all`:** `--include-all` is forbidden for this lineage.
- **No normal full-repo push:** an ordinary full-repository `db push` is not an authorized target-deployment mechanism.
- **No authority from G1:** this document, manifest, validator, and imported evidence authorize no migration or database mutation.

A future target-deployment phase must use an isolated, version-preserving workspace; re-prove the staging identity and live preconditions at the last moment; perform an owner-authorized dry-run that proposes exactly `20260803000000`; apply only after separate authorization; and independently verify the postconditions.

This is an environment-specific staging model. It provides no production deployment authorization or migration-history conclusion for production. Production, Jarvis, and OneDecore remain forbidden targets for this lineage.
