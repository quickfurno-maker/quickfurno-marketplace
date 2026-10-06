# Phase 17 — Backup, PITR & Disaster Recovery

Status: source implementation and isolated restore certification.

## Recovery objectives

QuickFurno defines recovery by domain rather than pretending one backup protects everything.

| Domain | Target RPO | Target RTO | Recovery mechanism |
| --- | ---: | ---: | --- |
| PostgreSQL transactional truth | 120 seconds | 60 minutes | managed PITR + off-site logical backup |
| Object/media storage | 60 minutes | 4 hours | independent versioned/content-addressed external backup |
| Git/IaC/config schema | zero committed-version loss | 60 minutes | Git remote + Phase 15 release metadata |
| Signed OCI images | exact digest | 60 minutes | registry retention + Cosign verification |
| Secrets/credentials | not backed up as plaintext | 2 hours | reissue/rotate from owner/provider inventory |

The 120-second PostgreSQL target is a **production target**. It may only be claimed when managed PITR is actually enabled. Phase 17 does not purchase or enable a paid PITR add-on.

## Live baseline — 2026-10-06

Read-only Supabase observations at phase start:

- QuickFurno PostgreSQL 17.6, approximately 49 MB.
- Jarvis PostgreSQL 17.6, approximately 11 MB.
- no logical replication slots were present in either project.
- QuickFurno Storage: one bucket, zero objects at the observation point.
- QuickFurno Auth: nine users at the observation point.

These counts are evidence only, never hardcoded capacity assumptions.

## PostgreSQL recovery

Production policy:

1. Managed PITR is the primary low-RPO recovery mechanism.
2. A daily logical backup remains required as a provider-independent second path.
3. Logical backups must be encrypted, off-site, access controlled and retained for at least 30 days.
4. Before any production restore, freeze writes and record the target recovery point.
5. A restore is never performed directly as an experiment against production. Certification uses a clean-room environment.
6. After restore, recreate and validate non-Realtime logical replication slots if future CDC introduces them.
7. Before future CDC/migration rehearsals, WAL retention and replication-slot lag must be monitored.
8. Custom database role passwords are reissued after restore; they are not treated as backup payload.

The isolated Phase 17 certifier uses PostgreSQL physical base backup + WAL archiving, restores to a target time, proves the pre-target transaction exists and the post-target transaction does not, then independently restores a logical pg_dump.

## Supabase Storage recovery

Supabase database backup metadata is not the same as Storage object recovery.

The Supabase S3-compatible API does not provide bucket versioning. Therefore QuickFurno must not assume source-provider version history.

Policy:

- copy Storage objects to a separate backup destination at least hourly once objects exist;
- backup destination must provide immutable/versioned snapshots or equivalent content-addressed retention;
- every snapshot has a SHA-256 manifest;
- snapshots are retained at least 30 days;
- deletions in the primary bucket do not delete historical backup snapshots;
- object restore is tested independently from database restore.

The Phase 17 object drill creates two immutable content-addressed snapshots, destroys the source, restores the earlier snapshot and verifies every checksum.

## Git, IaC and configuration

Authoritative application/IaC configuration is source controlled.

- no host-local configuration is authoritative;
- recovery begins from exact Git SHAs and exact signed image digests;
- Phase 13 external-secret boundaries stay in force;
- Phase 16 provider-neutral host bootstrap remains the compute recovery path;
- a recovery record pins QuickFurno/Jarvis/AGNI source SHAs plus signed OCI digests.

## OCI registry retention

Never garbage-collect:

- an image referenced by the currently active release;
- the immediately available rollback release;
- an image referenced by a DR recovery record.

Retain at least 10 signed releases and at least 90 days of signed release history, whichever retains more recovery options. Recovery verifies Cosign signature and Phase 15 release/SBOM/provenance attestations before execution.

## Secret recovery

Plaintext secret backup in Git, CI artifacts or DR archives is forbidden.

Maintain only secret names, owner/provider, purpose and rotation procedure. During disaster recovery:

1. reissue or rotate provider credentials;
2. reset custom database role passwords;
3. update the external secret source;
4. restart dependent services;
5. revoke old credentials after validation.

## Recovery order

1. declare incident and stop unsafe writes;
2. choose recovery point and create immutable incident/recovery record;
3. restore PostgreSQL in a clean room and validate business invariants;
4. restore object/media snapshot and verify manifest hashes;
5. recover/reissue secrets;
6. pull and verify exact signed QuickFurno image;
7. restore QuickFurno Core first;
8. restore Jarvis after Core authority is healthy;
9. restore AGNI last in READ_ONLY_RECOMMEND mode;
10. verify observability, queues, idempotency, payments/credits/assignment invariants;
11. only then consider traffic reactivation.

## AGNI replay-state safety

AGNI host-agent replay state is not business truth. If a host is lost and that local replay state is unavailable, action authority stays disabled until old capabilities have expired (maximum 10 minutes) or capability/signing material has been rotated. A fresh host must never blindly trust lost replay state.

## Regional strategy

One authoritative write region remains locked. Do not introduce active-active transactional multi-region writes in Phase 17.

## Phase safety

- no production restore;
- no production database mutation;
- no production traffic cutover;
- no production secret rotation;
- no new AGNI authority;
- no paid PITR activation without separate approval.
