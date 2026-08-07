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

## 4. Applied anchor (superseding the original "pending target" section)

`20260803000000_qf_mvp_50_2c_lead_communication_recipient.sql` was operationally `PENDING` and absent remotely **at L3**. Its locked SHA-256 remains `77d2bb1162e0522b061f36df787d94c2dad4f0ceeff3e4a07c8946cd4e1d56ca`. G1 imports the accepted S1 preflight record into source control; it does not apply the migration and does not make the historical S1 observation permanent current-state proof.

**QF-MVP-50.2C-S2-D2-R1 subsequently applied and verified it on QuickFurno Staging** under the owner-reviewed marker `QF_MVP_50_2C_S2_D2_R1_STAGING_MIGRATION_APPLIED_AND_VERIFIED`: applied exactly once, remote history count `20`, target present exactly once, local/remote SHA exact, `recipient_type` vocabulary now including `lead`, with no repair and no replay.

It is therefore recorded in the manifest as the frozen **applied anchor** (`appliedAnchor`, `operationalStatus: APPLIED`). The `remoteVersionStatusAtL3: ABSENT` field is retained deliberately: it is a historical L3 observation, not a current-state claim. G1 performs no database access and re-proves none of this itself — the applied status is imported owner-reviewed evidence, exactly like S1.

## 4a. Post-anchor migration pin — QF-MVP-50.2E-R1

This rule has now been re-pinned twice, and never loosened:

| Revision | Rule |
|---|---|
| original | `20260803000000` must be the newest local migration; zero newer ones |
| QF-MVP-50.2D-R1 | exactly **one** hash-pinned post-anchor migration, `PENDING` |
| **QF-MVP-50.2E-R1** | exactly **two** hash-pinned post-anchor migrations, in exact order: one `APPLIED`, one `PENDING` |

> The anchor is frozen and applied. **Exactly two** explicitly declared, hash-pinned post-anchor migrations may exist, in exactly this order. The first is `APPLIED` on QuickFurno Staging under imported owner-reviewed evidence; the second remains `PENDING` until its own separately authorized staging deployment gate.

**Applied post-anchor migration:**

| Field | Value |
|---|---|
| Version | `20260804000000` |
| Name | `qf_mvp_50_2d_automation_transport_completion_route` |
| Phase | QF-MVP-50.2D |
| SHA-256 | `043f1e3bbe261aef516ca35b54eb3e1c339d21d6b0c55c77f1d138eb502fa2c2` (unchanged) |
| Operational status | `APPLIED` |
| Applied-evidence marker | `QF_MVP_50_2D_S2_STAGING_MIGRATION_APPLIED_AND_VERIFIED` |
| Evidence type | `IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD` |
| Remote history count after apply | `21` |
| Applied by the phase that pinned it | **No** — QF-MVP-50.2E applies nothing |

QF-MVP-50.2D-S2 applied and verified it on QuickFurno Staging: applied exactly once, remote migration history count `21`, target present exactly once, local/remote SHA exact. As with the `20260803000000` anchor in §4, G1 performs no database access and re-proves none of this itself — the applied status is **imported owner-reviewed evidence**, not an offline claim. Until this re-pin, source still recorded it as `PENDING` while it was operationally `APPLIED`; that gap existed because the staging deployment gate deliberately made no source edit, and closing it is a truthfulness obligation of the next phase that touches G1.

**Pending post-anchor migration:**

| Field | Value |
|---|---|
| Version | `20260805000000` |
| Name | `qf_mvp_50_2e_automation_transport_client_execution_route` |
| Phase | QF-MVP-50.2E |
| SHA-256 | `9a8a29975e18135b96e7be7d4510104033c5de00cf080df5dab4326e3891250b` |
| Operational status | `PENDING` — not applied by QF-MVP-50.2E |
| Remote status | `NOT_PROVEN_OFFLINE` — G1 makes no network claim about it |

No generic future-migration allowance is granted. G1 still fails closed on a third post-anchor migration, an out-of-order pair, a renamed candidate, a candidate whose on-disk or manifest hash drifts, a missing candidate, a second manifest `PENDING` entry, a candidate silently marked `APPLIED`, a pending candidate forging applied evidence, an applied candidate demoted back to `PENDING`, a forged applied marker, an altered remote history count, an applied candidate also listed as pending, and an understated post-anchor count. Direct migration count is pinned at exactly `89`.

### 4b. This pin is a checkpoint, not a roadmap prohibition

G1 freezes the **current** candidate state. It is **not** a statement that no further migration may ever exist, and it does not block QF-MVP-50.2E, 50.3 or any later phase.

The pin is designed to be **re-pinned, never loosened**. A later phase that legitimately adds a migration must, in the same commit:

1. bump the exact migration count;
2. add that migration's exact version, name, path and canonical SHA-256 to `pendingPostAnchorMigrations`;
3. move any migration that has since been applied to staging out of the pending list and record it with its own imported owner-reviewed evidence marker, as §4 did for `20260803000000`;
4. keep every mutant honest — a second unpinned, renamed, hash-drifted or missing candidate must still fail.

What is permanently forbidden is the *shape* of the relaxation, not the act of adding migrations: never `version > anchor`, never `count >= N`, never a wildcard, and never a remote status asserted by an offline validator. Each new migration is pinned individually and deployed through its own authorized staging gate.

## 5. Fail-closed deployment boundaries

- **No replay:** never replay the 68 pre-baseline versions on staging.
- **No mass repair:** never mass-repair the 68 versions as applied.
- **No baseline revert or copy:** never revert the remote baseline row or copy the baseline into `supabase/migrations/`.
- **No `--include-all`:** `--include-all` is forbidden for this lineage.
- **No normal full-repo push:** an ordinary full-repository `db push` is not an authorized target-deployment mechanism.
- **No authority from G1:** this document, manifest, validator, and imported evidence authorize no migration or database mutation.

A target-deployment phase must use an isolated, version-preserving workspace; re-prove the staging identity and live preconditions at the last moment; perform an owner-authorized dry-run that proposes exactly the one intended version; apply only after separate authorization; and independently verify the postconditions. QF-MVP-50.2C-S2-D2-R1 discharged this for the `20260803000000` anchor, and QF-MVP-50.2D-S2 discharged it for `20260804000000`. The pinned `20260805000000` post-anchor migration has NOT been through it and must repeat it in full.

This is an environment-specific staging model. It provides no production deployment authorization or migration-history conclusion for production. Production, Jarvis, and OneDecore remain forbidden targets for this lineage.
