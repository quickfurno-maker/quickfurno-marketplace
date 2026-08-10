# QF-MVP-50.3 / 50.4 staging forensic reconciliation

**Evidence date:** 2026-08-10

**Authorized project:** QuickFurno Staging (`uckafzuochmbvtiodmcl`)

**Region / status:** `ap-southeast-1` / `ACTIVE_HEALTHY`

**Evidence mode:** read-only catalog, history, aggregate-data and repository inspection

## Decision

The earlier staging certification stopped correctly because live migration history contradicted the governed pending set: migrations 090, 100 and 110 were already recorded. This phase did not apply, reapply, repair or remove anything. It reconciles source governance only after proving that each recorded migration's statement stream and persistent catalog effects match the accepted repository source.

| Version | Classification |
|---|---|
| `20260808500000` bridge | `APPLIED_RECORDED_CATALOG_MATCHES_CURRENT_SOURCE` |
| `20260809000000` vendor producer | `APPLIED_RECORDED_CATALOG_MATCHES_CURRENT_SOURCE` |
| `20260810000000` campaign recipient vehicle | `APPLIED_RECORDED_CATALOG_MATCHES_CURRENT_SOURCE` |
| `20260811000000` family-aware claim | `APPLIED_RECORDED_CATALOG_MATCHES_CURRENT_SOURCE` |

`APPLY_EXECUTOR_PROVENANCE: UNKNOWN`

No available record proves who applied 090/100/110. The acknowledgement that they already exist authorizes importing the measured state; it is not execution provenance.

## Repository prestate

- Branch: `mvp/qf-mvp-50-3-50-4-staging-certification`
- `HEAD`: `28e12cc0e2b0624e9e09d9e7ea9540727c14ebbf`
- `origin/main`: `28e12cc0e2b0624e9e09d9e7ea9540727c14ebbf`
- Relative state: `0/0`
- Tracked worktree: clean before this reconciliation
- Local migration count: exactly `96`

## Migration-history freeze

The complete `supabase_migrations.schema_migrations` relation contained exactly 29 rows. The final four rows were in this exact order, each occurring once, with no later version:

| Ordinal / history count | Version | Name | Occurrence | Ledger statements |
|---:|---|---|---:|---:|
| 26 | `20260808500000` | `qf_mvp_50_3_automation_policy_config_foundation_bridge` | 1 | 2 |
| 27 | `20260809000000` | `qf_mvp_50_3_vendor_automation_producer` | 1 | 23 |
| 28 | `20260810000000` | `qf_mvp_50_4_campaign_recipient_automation` | 1 | 9 |
| 29 | `20260811000000` | `qf_mvp_50_3_50_4_family_aware_claim_routing` | 1 | 18 |

The history relation exposes `version`, `statements`, `name`, `created_by`, `idempotency_key` and `rollback`; it has no application timestamp or source checksum column. `created_by` and `idempotency_key` are null for the final four. Transaction commit timestamps are not enabled. Consequently, no exact application timestamp can be recovered from migration history.

The 085 and 090 seed rows share their respective migration transaction IDs and provide only approximate transaction-time evidence:

- 085 seed: `2026-08-08 12:27:12.075954 UTC`, transaction `2544`
- 090 low-credit seed: `2026-08-08 13:20:42.060461 UTC`, transaction `2552`
- 100 migration row transaction: `2555`; timestamp unavailable
- 110 migration row transaction: `2557`; timestamp unavailable

These transaction IDs prove separate ordered transactions. They do not prove a CLI, executor, operator, or a single push.

## Accepted source identity and lineage

SHA-256 uses the manifest's canonical UTF-8/LF policy.

| Version | Source SHA-256 | Git blob | Accepted lineage |
|---|---|---|---|
| 085 | `05e114910c8ba06e9d697b81ca645dfc13a03ed29751090901666975dc6fcbca` | `52f77c0c728b88ea5e3eea188ab1f4914328fc94` | introduced by `a02cf96129e93274bf0f532a047b3b9c89c05067` |
| 090 | `3588f6d06256af7d6ae95263bb474fb33a15428d0a402bd81c6dd1eb0e6076cb` | `66ab3023287d391bffc8a75ce506a2d17f523bdb` | introduced by `ea0f61b5998717c0e10f2201423bd1705ec96154`; exact guard correction by `ef26c78b26e623168f9fb9de737881904d461f37` |
| 100 | `8440e5e818676232969c5046941daa7e8fc905728ea73d295ca0e997c5ac7906` | `5c72bcb3feed7665bcd1af3a559684a0eb055ff0` | introduced and unchanged since `ea0f61b5998717c0e10f2201423bd1705ec96154` |
| 110 | `fc7efae9c2349854b9856d3b3b3956933bcfe79ed15c1eeb7caf65bc61f8f89d` | `26ad90984b810153c506bd7afe1720ccf52db12e` | introduced and unchanged since `f10c62c9c3f99a9ba1165ded53e2e535648402fb` |

The pre-correction 090 SHA was `a4b94ac6df39caa71ef9adcb8f40eb19850d425f3724c82fc4a7bc979ed8fb11`. Its staging attempt rolled back and had occurrence zero. The correction adds comments and the one exact false-positive exemption:

`table_name = 'vendors' and column_name = 'accepting_leads'`

It changes no producer, action, schedule, owner policy, grant or other executable business rule. The recorded 090 statements contain that exact accepted exemption.

## Statement-stream proof

The remote ledger has no file checksum, so version presence was not treated as source proof. A reviewable SQL splitter reconstructed the Supabase ledger representation from each current file: split only on semicolons outside quoted strings, dollar-quoted bodies and comments; trim leading statement whitespace; retain executable text and quoted literals; then hash the ordered statement array joined with a newline.

| Version | Local and remote ordered-statement SHA-256 | Result |
|---|---|---|
| 085 | `fe792b5a2046efba35f972706a37e1342c21c974066127bb2670ba9a8cb2cb3d` | exact |
| 090 | `6808ff0f9f74c1f904974885662b0d75dfa9e82756f38fb0b7bec62a5481c520` | exact |
| 100 | `92eceaf49e7a976909b8155d0376884d6f9be7a895f68b21e544f0b860bc9f50` | exact |
| 110 | `4bc79fb75c34058d91955a79d4fc67eeafe590923b6a31dc9d6c521fc793e8ea` | exact |

This proves that the accepted current SQL statement streams, including executable function bodies and self-verification blocks, are what the ledger recorded.

## Installed function-body proof

For every function installed by 085/090/100/110, `pg_proc.prosrc` was compared mechanically with the corresponding current source body while separately checking identity arguments, result type, volatility, `SECURITY DEFINER`, `search_path` and ACL. All 13 bodies matched exactly:

| Function | Installed/current body SHA-256 | Characters |
|---|---|---:|
| bridge immutability trigger | `8e675a...` | 108 |
| `qf_vendor_low_credit_threshold_v1` | `16bca198...` | 281 |
| `qf_enqueue_vendor_automation_v1` | `ecff42ef...` | 3809 |
| vendor assignment trigger | `de3ca596...` | 720 |
| vendor onboarding trigger | `e68a5261...` | 414 |
| vendor package trigger | `bfdc02de...` | 963 |
| vendor low-credit trigger | `f94c3868...` | 673 |
| `qf_enqueue_campaign_recipient_automation_v1` | `4207626a...` | 2665 |
| campaign-intent trigger | `0ef1619e...` | 187 |
| `qf_automation_action_workflow_family_v1` | `da6b90e9...` | 1036 |
| legacy claim | `1c5b2fc0...` | 1994 |
| family claim | `2d46fcd7...` | 2138 |
| family transport | `9a37271a...` | 3381 |

The abbreviated hashes above are supporting labels; the exact statement-stream hashes are the durable full-file-to-ledger proof. No body mismatch was found.

## 090 catalog parity

- All six producer/trigger functions exist with their exact signatures, `SECURITY DEFINER` attributes and governed search paths.
- Threshold, enqueue and producer functions are executable only by `service_role` where source revokes broader execution.
- Four triggers match source exactly: assignment `AFTER INSERT`, onboarding `AFTER INSERT`, package expiry `AFTER UPDATE OF package_expires_at` with its exact predicate, and low credit `AFTER UPDATE OF remaining_credits` with its exact predicate.
- The active config is exactly key `vendor_low_credit_warning_threshold`, version `vendor_low_credit_warning_threshold_v1`, fingerprint `ae4192b16847ccbd545c492a0213422ade4e5c0b3b51556743cc00bd4172372c`, threshold `3`.
- The threshold reader has no numeric fallback. Crossing logic is exactly `OLD > threshold AND NEW <= threshold`.
- Lead offer is immediate; response reminders are `+2h` and `+24h`; onboarding is `+24h`; package warnings are `-7d` and `-1d` against the exact expiry identity.
- `vendor.document_reminder` remains refused with `NO_CANONICAL_VENDOR_DOCUMENT_DOMAIN`; no `vendor_documents` relation exists.
- Both producer dedupe indexes remain exact: `uq_automation_action_requests_idempotency` and `uq_automation_jobs_action_request`.
- `vendors.accepting_leads` remains a non-null boolean defaulting true and is used only as vendor availability. No per-lead accept/reject domain was found. The unrelated pre-existing `vendor_profile_change_requests.rejection_reason` is an admin profile-change review field and is the documented pre-existing grammar gap, not a lead-decision authority.

## 100 catalog parity

- `qf_enqueue_campaign_recipient_automation_v1(uuid)` and the trigger function match accepted source exactly.
- The sole trigger is `AFTER INSERT` and fires only when `aggregate_type = 'vendor_campaign'`.
- Dedupe is intent-owned: one request/job vehicle per authorized communication intent, with empty safe context.
- No audience recalculation, alternate delivery/dispatch/intent table, second batching authority or `campaign.execute_batch` producer exists.
- The handoff authority remains bounded `1..500`, default `100`. Its installed/source executable body is semantically identical after comment and whitespace normalization (`7f530854974f548e6fc07abbe60d7cdc469067ea6acf12d22af8561d92e35cbb`).
- Campaign statuses remain exactly `draft`, `ready_for_review`, `approved`, `cancelled`, `archived`; there is no running/paused/completed vocabulary or pause/resume column.
- No provider authority or accept/reject concept was introduced.

## 110 catalog parity

- The SQL action-family map matches all 14 current TypeScript registry entries; mismatch count is zero. Unknown, null and empty actions return null.
- The legacy `qf_claim_automation_job_v1(text)` keeps its compatible signature and return shape and is fenced to `client_whatsapp`.
- `qf_claim_automation_job_for_family_v1(text,text)` and the family transport function exist with exact signatures, bodies, `SECURITY DEFINER`, search paths and service-role-only ACLs.
- Family validation accepts exactly one of the closed canonical families. Arrays, lists, wildcard and all-family forms are absent.
- Selection remains pending-only, due-only, ordered, attempt-bounded and `FOR UPDATE SKIP LOCKED`; `retry_scheduled` is excluded.
- The partial unique claim index remains exact, preserving one `claim_v1` per job.
- No release, unclaim, claim deletion, processing-to-pending reversal, due sweep, stale-lease recovery, retry recovery or dead-letter worker exists.

## Relevant privileges, constraints and indexes

- Policy-config relations retain RLS, exact schemas/defaults, composite foreign key, immutable update/delete trigger and seven expected indexes.
- Existing Supabase default privileges mean `service_role` has table-level `ALL`; the migration's narrower grants do not revoke those defaults. This is reproducible platform/source behavior, not unexplained drift. The immutable trigger still blocks policy-row update/delete.
- Producer/threshold/enqueue/claim functions have the governed service-role-only execute ACL. Trigger functions retain PostgreSQL's source-consistent default execute ACL and are only useful in trigger context.
- Automation job immutability/status guards, no-delete/no-truncate protection, attempt bounds, dedupe constraints and claim uniqueness remain present and validated.

## Aggregate data-side observation

Only aggregate, non-PII counts were collected:

| Relation/domain | Count / safe distribution |
|---|---|
| vendors / CRM profiles / lead assignments | 21 / 3 / 1 |
| campaigns / audience members | 65 (all archived) / 67 |
| communication intents / messages | 7 (all historical vendor-campaign, failed) / 0 |
| action requests / jobs / attempts | 30 / 30 / 21 |
| jobs by status | failed 9, pending 9, processing 2, retry-scheduled 10 |
| transport requests | 57: claim claimed 21, claim empty 17, execute recorded 19 |
| vendor-producer requests | 12 across all five producible vendor actions |
| campaign-recipient / batch requests | 0 / 0 |

The 12 vendor requests prove that 090's triggers have been used since application. Existing campaign intents predate the 100 trigger and produced no recipient requests, so 100 has no observed post-apply workload. Zero communication messages provide no evidence of a provider send.

## Provenance conclusion

Repository history, evidence/docs, safe local artefacts, current PostgreSQL logs and migration metadata do not identify an executor. There is no retained command, PR record or source-controlled execution report for 090/100/110. The ordered ledger and separate transaction IDs prove accepted source/order, not operator or tooling.

`APPLY_EXECUTOR_PROVENANCE: UNKNOWN`

## Boundaries and next action

- `STAGING_DB_WRITES_BY_THIS_PHASE: 0`
- `MIGRATIONS_APPLIED_BY_THIS_PHASE: 0`
- `PRODUCTION_DB_WRITES: 0`
- `N8N_CERTIFICATION_PERFORMED: NO`
- `WHATSAPP_MESSAGES_SENT: 0`
- `PROVIDER_ACTIVATION_PERFORMED: NO`
- `QF_MVP_50_5_STARTED: NO`
- `PRODUCTION_DEPLOYMENT: NO`

This evidence does **not** make 50.3 or 50.4 staging-certified. The exact next allowed action after review is:

`REAL 50.3/50.4 ORCHESTRATION CERTIFICATION WITHOUT MIGRATION APPLY`
