# VOX-08R — Core internal notification outbox metrics and source signing

**Source-only. No protected Staging/Production SQL, no automatic worker, no provider send.** Stacked on [Core VOX-08N draft #311](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/311).

## Existing architecture reused
- `ops/vox/sql-candidates/20261016050000_vox08r_internal_outbox_metrics_candidate.sql` is an **uninstalled, non-managed** PostgreSQL SECURITY DEFINER aggregate candidate on the existing 08N Core work-event outbox. It returns only bounded aggregate statuses (PENDING/LEASED/DONE/DEAD_LETTER, max attempt, capped pending age), exactly the 08Q AGNI owner metrics field names. It uses service_role-only execution and denies anonymous/authenticated. No case/user/phone/job ID or provider claim.
- `contracts/vox/outboxMetricsAttestation.mjs` validates exact fresh Core metric schema and uses HMAC-SHA256 for `qf.vox.internal-outbox.metrics.envelope.v1` (iss quickfurno-core, aud qf-agni-owner-gateway, exp <=90s, one-use jti). Synthetic test key only; no actual live signing key or endpoint or cron.
- `ops/vox/offline/invoke-08r-stage-clone-replay.ps1` reproduces isolated 9-source SQL install and four SQL proof files on genuine staging backup; verified archive SHA already in prior scripts. One real fake work event triggers an outbox job; the metric RPC reports PENDING, then a synthetic dead-letter state in a transaction is reflected in aggregate; transaction rolled back. Disposable Docker container has network none/zero ports and is cleaned in finally.

## Observed results
- Offline genuine Staging four-schema PG17 restore: 9/9 SQL candidates PASS; 4/4 SQL denial and positive tests PASS, 16 disposable VOX tables, 86 historical migration rows unchanged. Metrics function denies anon/auth and grants service_role; reports only exact aggregate JSON, no identifiers.
- New Core signer 7/7 synthetic unit tests PASS; full Core VOX regression PASS (read branch log).
- **Actual cross-repository integration**: Core `signCoreOutboxMetricEnvelope()` produced a synthetic HMAC token, compiled AGNI `verifyCoreOutboxMetricForCurrentOwner()` accepted it under a synthetic authorized Owner and single-use mock replay; second attempt rejected. Evidence on JARVIS `D:\QuickFurno-Workspace\Artifacts\VOX-08R-08S-20261016-CrossRepo-Proof-Final.log`.

## Release HOLD
Database candidate not installed; independent DBA/security approval, trusted service-role origin, canonical migration history reconciliation and backup/rollback required. No HMAC key provisioned in VPS, no live signed Core->AGNI HTTP transport, no legitimate Owner Auth tested. Do not use synthetic callback or HMAC keys as a release credential.
