# VOX Phase A — 86-Record Migration Recovery and Cross-Repo QA (SOURCE ONLY)

**Release status: HOLD.** This package is independent of migration application and GitHub environment privileges.

## Recovery/parity

The exact 86 historical QuickFurno staging migration version/name records were retrieved via the first-party Supabase connector on 15 October 2026 and pinned at `ops/vox/phase-a-live-staging-migrations-baseline-20261015.json`. This is **read-only catalog evidence**, not a managed backup or a database dump. It excludes user tables and customer/vendor data.

`scripts/release/vox-phase-a-restore-parity.mjs --self-test` validates history match and intentionally rejects 12/86, missing/duplicate migrations, changed names, wrong independent restore target, mismatched archive digests, and unverified RLS/side-effects statements. It does not touch a real database.

Only authorized operators with an actual archive and isolated restored PostgreSQL 17 evidence can invoke:

```sh
node scripts/release/vox-phase-a-restore-parity.mjs --verify \
  --source /restricted/staging-source-migrations.json \
  --restore-history /restricted/independent-restore-migrations.json \
  --evidence /restricted/operator-archive-and-restore-attestation.json \
  --archive /restricted/actual-staging-backup.dump
```

JSON history shape: `{"records":[{"version":"...","name":"..."}]}`, all 86 ordered records. Evidence shape: `{"backup":{"sourceProjectRef":"uckafzuochmbvtiodmcl","archiveSha256":"...","capturedAt":"ISO-time","managedBackupPathReviewed":true},"restore":{"targetRef":"isolated-restore-identity","archiveSha256":"...","completedAt":"ISO-time","historyCount":86,"outboundEffectsDisabled":true,"rlsAndGrantsChecked":true,"schemaFingerprintsCompared":true,"authAndStorageAssessed":true,"restoreFinished":true}}`. The CLI recomputes SHA256 of actual operator-selected archive bytes; it intentionally does **not** obtain secrets, fetch remote backups, execute SQL, or sign the operator packet.

This is supplementary to VOX-24 separate owner/DBA Ed25519 attestations, not a substitute for those signatures or for actual independent restore. It can inspect a file but **cannot prove the file was genuinely captured from the managed database**.

## Cross-repository integration QA

`scripts/release/vox-phase-a-crossrepo-contract.mjs` fetches frozen source heads via read-only Git from:
- Core Phase A #257: `d8c3e1e1b8698873f652a459164214cb665ba235`
- Jarvis #336: `1bbc916ccc095bd656b3bbcf373736a728037177`
- AGNI #83: `84c4a0f09d010045c40073824da112855a3ebb18`

It refuses remote source drift, checks neutral Core staff identity, actual Core AAROHI role/subject scope, Jarvis signed read-only event verifier with forged/expired/tampered rejection, and AGNI owner-only/replay guard source. The AGNI TypeScript guard is inspected as source, not runtime executed here. CI does not deploy, mint credentials, read real messages or enter a production endpoint.

## Remaining boundaries

The database recovery [#246](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/246), security [#254](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/254), real staff invitation/MFA [#256](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/256) and protected staging settings [#258](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/258) remain open. No VOX seven SQL migrations or separate AGNI 0008 were applied. Cross-source CI green is NOT real AAL2, cross-city IDOR, signed OCI, authorized staging or recovery certification.
