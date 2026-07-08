# QuickFurno AOS Phase 4B-1 - Durable Policy Inputs and Authorization Contracts

Phase 4B-1 adds durable inputs and strict contracts for future policy-based lead distribution authorization. It does not evaluate policy in the live executor, publish `lead.distribution.auto_authorized`, assign vendors, mutate credits, rerun matching, send WhatsApp, call n8n, execute provider outbox commands, create workers, update PM2, or change UI.

## Durable Policy Config Storage

Migration:

`supabase/migrations/20260706000150_automation_policy_config_foundation.sql`

Tables:

- `automation_policy_configs`: immutable config-version rows keyed by `id`, `policy_key`, `policy_version`, `config_json`, and `config_fingerprint`.
- `automation_policy_active_configs`: mutable active pointer keyed by `policy_key`, with `config_id` referencing the matching immutable row through a composite `(policy_key, config_id)` foreign key.

Immutability is enforced in the database by `trg_automation_policy_configs_immutable`, which rejects `UPDATE` and `DELETE` on `automation_policy_configs`.

RLS is enabled on both tables. The migration revokes browser roles and grants service-role access only. No anonymous or public write policy is created.

## Safe Default Seed

The active config is seeded for `lead_distribution_authorization` at `lead_distribution_authorization_v1`.

The config is the Phase 4A safe default:

- `mode`: `human_approval_only`
- `enabled`: `false`
- `minimumAutoAuthorizeScore`: `90`
- `allowedAutoAuthorizeScoreClasses`: `["A+"]`
- `requireNoHardBlock`: `true`
- `requiredRecommendedAction`: `auto_distribute`
- `minimumRecommendationCount`: `1`
- `maximumRecommendationCount`: `3`

The seed fingerprint is `1ecca567b6564e9188d4aab7cb7557614c87f2131c947b42929475b4e592901c`, computed from `computePolicyConfigFingerprint(SAFE_DEFAULT_LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_CONFIG)`.

The immutable safe-default config row is inserted if missing. The active pointer is created only when no pointer exists: its conflict path is `ON CONFLICT (policy_key) DO NOTHING`. Replaying the migration must never replace an operator-selected active config or silently reset the pointer back to the safe default.

## Runtime Config Adapter

Runtime modules live under `lib/aos/policy/runtime/`.

`loadAutomationPolicyConfigSnapshot`:

- loads the active pointer through a trusted read port;
- validates exact policy key and exact supported version;
- validates `config_json` through the Phase 4A config validator;
- recomputes the fingerprint and compares it to the stored fingerprint;
- returns a frozen `LoadedAutomationPolicyConfigSnapshot`;
- returns the safe default only when no active pointer exists;
- throws on database errors and active-row integrity failures.

The safe-default fallback has `configId: null` and `source: safe_default_no_active_config`. It is disabled and cannot produce auto authorization.

## Policy Audit Contract

`leadDistributionPolicyAudit.ts` defines a strict, PII-free policy-decision audit payload:

- `policy_key`
- `policy_version`
- `policy_fingerprint`
- `policy_decision`
- `policy_reason_code`
- `policy_config_id`
- `policy_config_source`
- `policy_facts_summary`
- `policy_passed_gates`
- `policy_failed_gates`

The validator uses a strict allowlist and rejects timestamp, worker, attempt, hostname, random, and PII-looking fields.

`policy_facts_summary` must exactly match the Phase 4A evaluated facts summary shape:

- `policyKey`
- `workflowType`
- `workflowInstanceId`
- `leadId`
- `currentLifecycleState`
- `routeClassification`
- `scoreClass`
- `totalScore`
- `hardBlockReasonPresent`
- `recommendedAction`
- `recommendationEventId`
- `recommendedVendorCount`

The facts summary validator requires all fields, rejects unknown fields, validates known lifecycle state, route classification, score class, recommended action, integer score bounds `0..100`, boolean hard-block presence, and recommendation count bounds `0..3`. It returns a normalized frozen summary.

## Auto-Authorized Event Contract

`leadDistributionAutoAuthorizationValidation.ts` defines the strict future `lead.distribution.auto_authorized` payload contract.

The contract requires:

- `authorization_source: policy_auto_authorization`
- `policy_decision: auto_authorize`
- `policy_reason_code: guarded_auto_authorization_eligible`
- `policy_version: lead_distribution_authorization_v1`
- `policy_config_source: active_config`
- non-empty `policy_config_id`
- empty failed gates
- 1..3 recommended vendors
- 1..3 authorized vendors
- `authorized_vendor_ids` exactly equal to `recommended_vendor_ids`, same count and order

No vendor subset selection, truncation, replacement, or reranking is allowed.

## Unified Authorization Snapshot

`leadDistributionAuthorizationSnapshotResolver.ts` defines a neutral resolver for:

- `lead.distribution.approved` -> `human_approval`
- `lead.distribution.auto_authorized` -> `policy_auto_authorization`

Human approvals map `approved_vendor_ids` to `authorizedVendorIds`, preserve `approvedBy`, and set `policyAudit` to `null`.

Policy auto authorization maps `authorized_vendor_ids` exactly, sets `humanApprovedBy` to `null`, and preserves the validated policy audit.

Phase 3B execution still uses `leadDistributionApprovedSnapshotResolver.ts`. The neutral resolver is not wired into assignment execution in Phase 4B-1.

## Validation

Run:

`npm run test:phase4b1`

The Phase 4B-1 harness performs 107 checks covering migration shape, non-overwriting active-pointer seeding, storage integrity, config loading, safe fallback, strict facts-summary validation, audit contract validation, auto-authorized payload rules, unified resolver behavior, and non-goal/security guards.
