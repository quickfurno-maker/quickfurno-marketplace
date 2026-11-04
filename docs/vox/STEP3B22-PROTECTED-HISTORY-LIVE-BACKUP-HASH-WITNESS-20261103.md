# 3B22 — Staging protected TEST-history: live vs restored-backup SHA-256 evidence

**Date:** 3 November 2026 • **Execution:** managed Staging SELECT-only; local disconnected PostgreSQL 17.6 SELECT-only • **Managed DELETE:** NO • **Release:** HOLD

## Concrete improvement

The 3B21 cleanup rehearsal proved that the *restored* Staging database could be purged atomically. This 3B22 check verifies an additional prerequisite: **does the privately stored Staging backup actually contain the same four protected history families as managed Staging?**

One read-only query computes SHA-256 of the **sorted, UTC-normalized PostgreSQL `to_jsonb(row)::text` representation** for test-targeted rows in each family; it returns only `family, row_count, digest`. The same exact algorithm was run on managed Staging and in the independently restored network-isolated PostgreSQL 17.6 local clone, created from the **3 November 2026 Staging archive** (SHA-256 `720165400E7B8807CAFEC19D81AF9B9C606FD234A1D3B95FD6B285D996FBD1A5`).

| Protected TEST-only history family | Count (both) | Live Staging = backup restore SHA-256? | Digest |
| --- | ---: | --- | --- |
| `lead_assignment_events` | 6 | **MATCH** | `bec559d91c610605b20af6ba2c43336e900601e0677d8d0da1b2cf31d863ad46` |
| `vendor_campaign_audience_members` | 68 | **MATCH** | `25225af6513aa47101fdd02d667167b25b2af23460e68d2929a55f4bd9eafdb6` |
| `vendor_internal_notes` | 8 | **MATCH** | `de65ca9a977741119e8ee3ce167a9fecd8608f9d16eacef9f2919677248e5cda` |
| `automation_action_requests` | 70 | **MATCH** | `615f7ca2782bcaf9150691a267fa5d776aca3f015d7d427e15dcfa5a14f8c882` |

**4/4 counts and full canonical-row SHA-256 digests MATCH.** This is stronger than a count match or a root UUID fingerprint: it demonstrates consistency of those protected rows between the currently connected live Staging data and restored backup **at the time of observation**. Both SQL sessions used UTC. No raw rows, email, phone numbers or test UUID lists were printed or committed.

The reusable, read-only query is at `ops/vox/sql-review/STEP3B22-STAGING-PROTECTED-HISTORY-DIGEST-READ_ONLY.sql`; it enters `BEGIN READ ONLY`, uses `SET LOCAL TIME ZONE 'UTC'`, returns grouped SHA-256 witnesses and issues `ROLLBACK`. GitHub source tests assert that it contains no DML/DDL and covers the four protected families. This command must **not** be converted into a migration or used as permission to delete immutable history.

## Integrity and limitations

- A digest proves **equality of the compared canonical row representations**, not the legal legitimacy of deleting immutable history. Without a separately signed and access-controlled custody process, this report is not immutable evidence retention or an independent auditor attestation.
- `to_jsonb(row)` includes protected details **inside the hash input only**, but the output contains only counts and one digest per family. Review whether even these aggregate digests should be publicly visible in repository evidence; raw data remains restricted on JARVIS.
- The source is a **four-schema logical dump restored with `--no-owner --no-acl`**. It does not prove Supabase managed platform PITR, original role grants, Auth service state, Storage object bytes or external provider records. Backup archives and platform snapshots themselves still contain the test data.
- Unrelated automation actions, jobs and provider records are deliberately excluded. A successful protected-row comparison cannot justify deleting those unrelated records.
- Staging scope still requires **26 test vendors, 7 leads, one unrelated canary and two unrelated Auth users**. SQL target selection is UUID-scoped from the supported Pune/Mumbai cohorts, not a blanket `DELETE` based on city alone.
- A reviewer must confirm statutory, financial, security, retention and immutable audit obligations; identify precisely which fields or separate non-PII digest custody must survive permanent test-data deletion.
- Existing one-transaction scratch deletion requires narrow trigger exceptions for protected history. **Never run the offline script against a managed project.** Live execution remains gated by an independently reviewed exception, managed restore/PITR safeguards, verified worker/provider freeze, and approved Staging change window.

**Next operative release action:** independent DBA/AppSec signoff of exact protected-event disposition and live operator recovery/freeze. No new owner approval of deletion intent is required. Keep managed Staging/Production data unchanged until the release gates pass.
