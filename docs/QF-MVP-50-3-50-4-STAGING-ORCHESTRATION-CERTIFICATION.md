# QF-MVP-50.3 / 50.4 staging orchestration certification

**Evidence date:** 2026-08-10

**Authorized database:** QuickFurno Staging (`uckafzuochmbvtiodmcl`)

**Starting branch/head:** `mvp/qf-mvp-50-3-50-4-staging-certification` / `0a52314f4f6f94ef449418be7c0bec87d6198c9e`

**Certified Core commit:** `9bdb2be97c2dd7f85ea1428359cb01b2ec65c2f2`

**Forensic dependency:** `8e7af649fbd28703c7fc085bca32ebd819da8ac2` and `0a52314f4f6f94ef449418be7c0bec87d6198c9e`

## Decision

QF-MVP-50.3 and QF-MVP-50.4 have now been exercised through the real committed
workflow graphs in isolated self-hosted n8n, a production-built local Core, and
the authorized staging database. Core remained the sole business authority and
the provider boundary remained disabled.

- `QF_MVP_50_3_STATUS: COMPLETE / TESTED / FROZEN`
- `QF_MVP_50_4_STATUS: COMPLETE / TESTED / FROZEN`
- `QF_MVP_50_TOP_LEVEL_COMPLETE: NO`
- `LIVE_PROVIDER_READY: NO`
- `QF_MVP_50_5_STARTED: NO`

“Complete” here is the frozen 50.3/50.4 source-and-staging orchestration scope.
It does not claim Meta readiness, provider delivery, retry recovery, deployment,
or completion of the QF-MVP-50 parent.

## Git and forensic gate

The tracked worktree was clean before certification. The feature branch was
exactly two commits ahead of and zero behind `origin/main`; it matched its
remote feature head at `0a52314...`. The accepted forensic gate passed 42/42
assertions and rejected all 15 mutants before any certification fixture write.
The two forensic commits remain ancestors and no history was rewritten.

The accepted forensic conclusion remains unchanged:

`APPLY_EXECUTOR_PROVENANCE: UNKNOWN`

## Staging and migration freeze

Immediately before writes, project identity was re-proved as
`uckafzuochmbvtiodmcl`, `ap-southeast-1`, `ACTIVE_HEALTHY`. Migration
history contained exactly 29 rows. Versions 085, 090, 100 and 110 remained
ordinals 26, 27, 28 and 29, each occurring exactly once. The local migration
set remained exactly 96 and the governed pending set remained empty.

After certification, migration history was read again and remained exactly 29
rows with 110 last. No migration, repair or schema-history command was run.

- `STAGING_HISTORY_ROWS: 29`
- `MIGRATION_COMMANDS_EXECUTED: 0`
- `MIGRATIONS_APPLIED_BY_THIS_PHASE: 0`
- `MIGRATIONS: 96`
- `PRODUCTION_DB_WRITES: 0`

## Runtime and isolation

| Component | Certified runtime |
|---|---|
| Node | `v24.18.0` |
| npm | `11.16.0` |
| Next.js production build | `14.2.15` |
| self-hosted n8n | `2.32.6` |
| Core | local `next start`, production build, commit `9bdb2be...` |
| Core target | staging `uckafzuochmbvtiodmcl` only |
| n8n database | isolated temporary SQLite user folder |
| n8n worker | `qf-cert-50-3-50-4-isolated` |
| network | n8n -> loopback TLS -> local Core only |

Temporary directional HMAC and n8n encryption secrets were generated at
runtime, stored outside the repository with Windows user-bound protection, and
never printed. The n8n process received the local Core URL and transport
identity only. It received no Supabase credential and no provider credential.
Core received staging credentials explicitly in process environment; committed
environment files were not changed. Provider-mode and Meta variables were
removed from the Core process environment.

The production build passed. Its runtime bundles referenced only the authorized
staging project. Six pre-existing lint warnings remained unchanged.

## Exact workflow inventory and graph equivalence

The committed source files were not edited. Every source and imported workflow
was inactive. n8n's regular importer required a storage identity for the older
client graph; that identity was added only to an ephemeral import envelope. An
export from the isolated n8n database was normalized without storage metadata
and compared to source. Nodes, parameters, settings, connections and inactive
state were exact.

| Family | Committed workflow | byte SHA-256 | semantic SHA-256 | active | nodes | connection sources | directed edges |
|---|---|---|---|---:|---:|---:|---:|
| `client_whatsapp` | `automation/n8n/QF-MVP-50-02-Client-Whatsapp-Executor.50.2E-selfhost-env.workflow.json` | `79716cd979aedaaa06aced84d843cad3ca15b47580bbbed8f85175b8c916dad4` | `f22e06d6f92fb14403800425a671971d7852b3f6f17c1b8fc20d8e9ff4f8a983` | false | 52 | 44 | 50 |
| `vendor_whatsapp` | `automation/n8n/QF-MVP-50-03-Vendor-Whatsapp-Executor.workflow.json` | `27d4831d157a6da31118d864a350766f90bf124b54f364a008e3b88cf6072926` | `67b6798ea6947102a22d550084bb084c178fd33247230b4512054dfa09cf3ccf` | false | 52 | 44 | 50 |
| `campaign_execution` | `automation/n8n/QF-MVP-50-04-Campaign-Execution-Executor.workflow.json` | `0e820de0ffb7bf399fed4a8025b166b1663568a0e1e441e112e599d323a21a18` | `c261690b30c6b45bf35786652b3cd85b4bfdf354157789d4cae09c47b781ce07` | false | 52 | 44 | 50 |

Each graph used signed claim, its exact family execute path, signed Core
response verification, the Core-authored orchestration state as its only
outcome switch, and completion only when Core set `completionReady`. No graph
contained a provider node, business database node, recipient selector, audience
builder, template selector, consent rule, frequency rule or retry classifier.

## Claimable-work safety

The installed selector was mirrored read-only before executor startup:
`pending` only, `attempt_count < max_attempts`, due only, ordered by
`available_at, created_at`, family-filtered, with `retry_scheduled` excluded.

Eight pre-existing jobs were due:

- two client jobs referenced absent lead heads and were classified
  `SAFE_ORPHAN_PRE_COMMUNICATION_NON_SEND`;
- six vendor jobs were classified `AMBIGUOUS`: four response reminders and
  two onboarding reminders. Two response assignments were absent, two were
  present, and both onboarding vendor heads were present.

No ambiguous vendor job was claimed. Certification jobs were created through
the installed producer RPCs with explicit historical due timestamps on
2026-08-01 through 2026-08-03, earlier than every ambiguous vendor row. No old
job was deleted, rescheduled, rewritten or claimed-and-discarded.

One wrapper anomaly is retained explicitly. The first client invocation
completed in the child process while PowerShell promoted Node's loopback-TLS
warning to a terminating wrapper error. A manual retry therefore selected the
next known safe orphan client row. That row finalized as
`QF_EXEC_LEAD_NOT_FOUND`, created no communication message, and was never an
ambiguous communication-capable head. The wrapper was corrected before every
remaining run. Consequently the pre-existing distribution changed from
`failed 9 / pending 9` to `failed 10 / pending 8`; the pre-existing
`processing 2 / retry_scheduled 10` rows remained exactly unchanged.

## Family isolation and signed transport

| Proof | Live result |
|---|---|
| legacy three-key claim | claimed the intended `client_whatsapp` fixture; workflow family returned by Core was exactly client |
| vendor family claim | claimed only the next historical `vendor_whatsapp` fixture |
| campaign family claim | claimed only the single `campaign_execution` fixture |
| unknown / empty / wildcard / all / comma list | HTTP 400, `AUTOMATION_CLAIM_WORKFLOW_FAMILY_INVALID` |
| family array / object | HTTP 400, `AUTOMATION_CLAIM_WORKFLOW_FAMILY_INVALID` |
| caller action allowlist | HTTP 400, `AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID` |
| same request/body replay | empty replay returned `replayed: true`; no attempt created |
| same request / changed family | conflict surfaced as signed closed internal refusal; no inherited claim |
| family mismatch at execute | HTTP 409, `AUTOMATION_EXECUTION_WORKFLOW_FAMILY_MISMATCH`; attempt remained open for its real executor |
| foreign job/attempt | HTTP 409, `AUTOMATION_EXECUTION_JOB_NOT_FOUND`; no finalization |
| no work | campaign claim returned `state: empty`, then replayed empty |
| execute replay | client execute returned `attempt_finalized`; identical replay returned `replayed: true` |

The mismatched client attempt was then executed on the correct client route and
finalized by Core. The combined run claimed one fresh job in each family. The
client and campaign jobs became truthful pre-provider retryable failures; the
vendor lead-offer job became the expected variable-contract definitive
non-send. Each attempt belonged to the isolated worker. The pre-existing
`retry_scheduled` rows remained inert and did not starve any fresh pending
fixture.

## Vendor producer and executor certification

All five producible actions were generated by canonical business events and by
the installed producer RPC for historical due execution. Every request was
Core-sourced, authorized, job-backed and deduplicated atomically. Safe context
remained empty; no recipient, phone, template, provider, consent or retry
authority was copied into the action request.

| Action | canonical source and schedule proof | fresh real-n8n result | stale-business reproof |
|---|---|---|---|
| `vendor.lead_offer` | assignment insert; immediate; entity is the assignment; one-way notice only | `QF_EXEC_VARIABLES_UNRESOLVED`, definitive non-send | deleted test assignment -> `QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE`, definitive non-send |
| `vendor.response_reminder` | same assignment creates exactly `:resp2h` at +2h and `:resp24h` at +24h | both identities -> `QF_EXEC_VARIABLES_UNRESOLVED`, definitive non-send | progressed `vendor_status` -> `QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE` |
| `vendor.onboarding_reminder` | CRM profile created at stage `new`; exactly +24h | `QF_EXEC_VARIABLES_UNRESOLVED`, definitive non-send | stage changed from `new` -> `QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE` |
| `vendor.package_expiry_warning` | active package; exactly -7d and -1d; key binds `YYYYMMDDHH24MISS` expiry | `QF_EXEC_VARIABLES_UNRESOLVED`, definitive non-send | expiry changed -> old exact stamp became `QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE` |
| `vendor.low_credit_warning` | configured threshold 3; only OLD > 3 and NEW <= 3 | `QF_EXEC_VARIABLES_UNRESOLVED`, definitive non-send | recharge above threshold -> `QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE` |

The low-credit producer was also exercised across `3 -> 2 -> 1 -> 0`; its
request count stayed at four. Recharge to four and a new `4 -> 3` crossing
increased the count to five, proving re-arm without a numeric fallback.

The initial deleted-assignment probe exposed an unruled stale lookup code. Core
refused it without provider effect but left the test attempt processing. Commit
`9bdb2be...` now maps an absent or unowned assignment head to the existing
definitive business-ineligible ruling. After a new production build and restart,
the repeated real-n8n probe finalized exactly as
`QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE`. The earlier open test attempt was not
recovered or rewritten; doing so belongs to QF-MVP-50.5.

`vendor.document_reminder` remains
`REGISTERED_BUT_NOT_PRODUCIBLE`. A direct installed-producer negative returned
`QF_PRODUCER_VENDOR_DOCUMENT_DOMAIN_ABSENT`.

Reason: `NO_CANONICAL_VENDOR_DOCUMENT_DOMAIN`.

There is no vendor accept, reject or decline behavior. `accepting_leads`
remains only an availability toggle.

## Variable-contract truth

| Action | template key | current canonical binding readiness | expected Core result |
|---|---|---|---|
| `vendor.lead_offer` | `vendor_new_lead` | no business variable builder | `QF_EXEC_VARIABLES_UNRESOLVED` |
| `vendor.response_reminder` | `vendor_response_reminder` | no business variable builder | `QF_EXEC_VARIABLES_UNRESOLVED` |
| `vendor.onboarding_reminder` | `vendor_onboarding_reminder` | builder requires `outstandingItem`; the vendor executor has no canonical source for it and does not invent one | `QF_EXEC_VARIABLES_UNRESOLVED` |
| `vendor.package_expiry_warning` | `vendor_package_expiry_warning` | no business variable builder | `QF_EXEC_VARIABLES_UNRESOLVED` |
| `vendor.low_credit_warning` | `low_credit_warning` | no business variable builder | `QF_EXEC_VARIABLES_UNRESOLVED` |

Variable binding remains owned by QF-MVP-40.12. This certification does not
fabricate provider readiness.

## Campaign lifecycle, handoff and execution

A safe vendor head with an impossible all-zero test destination and the unique
credit value 777777 was matched by a one-recipient segment. The canonical
services created and activated the segment, created the transactional campaign,
prepared an immutable snapshot of exactly one recipient, and approved revision
3.

With no active matching frequency policy, the first handoff failed closed as
`FREQUENCY_POLICY_NOT_CONFIGURED`. The canonical administrator policy service
then created one narrow test-only WhatsApp/transactional policy:
maximum 1000 per 24 hours, minimum interval zero. No default was used.

The installed handoff remained bounded 1..500 with default 100. A batch limit
of one produced:

- considered 1;
- created 1;
- existing 0;
- every skip bucket 0.

The identical handoff replay produced created 0 / existing 1. Exactly one
`communication_intent`, one `campaign.execute_recipient` action request and
one job existed. The request safe context was empty. No direct intent insert and
no alternate batch path were used.

The exact campaign graph claimed and executed that recipient. Core rebuilt the
execution plan and invoked the existing CommunicationService. Runtime/provider
disablement yielded the truthful pre-provider
`QF_EXEC_INFRASTRUCTURE_TRANSIENT` retryable result. The intent remained
`pending`, no message row existed, and `reconcileCampaignIntent` returned
`MESSAGE_NOT_FOUND`. The result projection derived one unlinked pending
intent and zero canonical message statuses. n8n recalculated no audience and
chose no recipient, template, consent, suppression, frequency or provider.

After execution, canonical services archived the campaign and segment and
retired the temporary policy. Their immutable audience, intent, event and policy
history remain.

`campaign.execute_batch` remains
`REGISTERED_BUT_NOT_PRODUCED: BATCH_ADVANCE_REMAINS_CORE_OWNED_HANDOFF`.

## Security negatives

Live loopback-TLS requests proved:

- malformed signature -> 401 unsigned;
- signature bound to the wrong path -> 401 unsigned;
- wrong worker -> 403 signed authenticated refusal;
- timestamp older than the 300-second window -> 401 unsigned;
- body larger than 2048 bytes -> 413 unsigned;
- sixth execute key, including a recipient override -> 400 signed refusal;
- foreign job/attempt -> 409 signed refusal;
- client attempt on vendor execute -> 409 family mismatch;
- unauthenticated request -> unsigned refusal, not a signing oracle;
- every authenticated response hash/signature validated with the response
  secret and failed validation with a different secret.

The final log scan covered 36 isolated JSON/log files and found
`SecretValueLogged: false`.

## Staging post-state and residue

| Aggregate | before | after | delta |
|---|---:|---:|---:|
| action requests | 30 | 73 | +43 |
| decisioned requests | 30 | 73 | +43 |
| jobs | 30 | 73 | +43 |
| execution attempts | 21 | 37 | +16 |
| transport requests | 57 | 90 | +33 |
| vendor requests | 12 | 44 | +32 |
| campaign-recipient requests | 0 | 1 | +1 |
| communication intents | 7 | 8 | +1 |
| communication messages | 0 | 0 | 0 |
| campaigns | 65 | 66 | +1 |
| audience members | 67 | 68 | +1 |
| frequency-policy history | 8 | 9 | +1 |

Final job distribution was failed 21, pending 36, processing 3 and
retry-scheduled 13. For the original 30 jobs, processing remained 2 and
retry-scheduled remained 10. One known safe orphan moved pending -> failed as
described above. No original retry or processing row was recovered, released,
rescheduled or rewritten.

Mutable fixture residue was retired: two vendors are inactive, suspended and
unavailable for new assignments; four leads are `Lost`; the campaign and
segment are archived; the policy is inactive. Append-only evidence was not
deleted. The test campaign leaves one audience row, one pending intent and one
retry-scheduled job. The pre-fix stale-assignment probe leaves one processing
test attempt intentionally untouched. Canonical producer triggers leave
explicit test-only pending rows; their business heads are disabled/retired, so
they cannot become provider sends.

## Provider and deployment safety

- `WHATSAPP_MESSAGES_SENT: 0`
- `META_MESSAGES_CALLS: 0`
- `TEMPLATE_SUBMISSIONS: 0`
- `MAPPING_ACTIVATION: NO`
- `PROVIDER_ACTIVATION: NO`
- `RUNTIME_SEND_ENABLEMENT: NO`
- `CANARY_ACTIVATION: NO`
- `META_BILLING_WRITES: 0`
- `PRODUCTION_N8N_ACTIVATION: NO`
- `PRODUCTION_DEPLOYMENT_PERFORMED: NO`
- `VENDOR_ACCEPT_REJECT_PRESENT: NO`
- `VENDOR_DOCUMENT_REMINDER_PRODUCIBLE: NO`
- `CAMPAIGN_EXECUTE_BATCH_PRODUCIBLE: NO`
- `RETRY_SCHEDULED_RECOVERY_IMPLEMENTED: NO`

## Frozen conclusion

The real staging run proves current source, installed authority, signed
family-isolated transport, exact inactive workflow graphs, canonical vendor
production, canonical campaign handoff and Core-owned fail-closed outcomes.
Live provider readiness remains explicitly false. QF-MVP-50.5 remains not
started, and the QF-MVP-50 top level remains incomplete.
