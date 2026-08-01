# QF-MVP-40.12-PREREQ-R1 — Staging Internal Template Catalogue Seed

**Status:** additive prerequisite repair. No live seed is performed by this code change.

## Why this prerequisite exists

The live QF-MVP-40.12 read-only preflight correctly stopped with:

`INTERNAL_TEMPLATE_MISSING — consent_help_response: missing`

Independent read-only staging inspection then proved that **all eight** QF-MVP-40 target keys are absent from `public.communication_templates`. The table itself is healthy and contains older disabled test rows. The failure is therefore a real missing catalogue prerequisite, not a schema or credential failure.

The existing QF-MVP-40.12 mapping operator must **not** be weakened or taught to fabricate internal templates. This repair keeps the prerequisite separate and bounded.

## Exact target set

1. `consent_help_response`
2. `consent_stop_acknowledgement`
3. `consent_start_acknowledgement`
4. `lead_received`
5. `client_lead_status_update`
6. `client_matching_update`
7. `lead_assignment_alert`
8. `vendor_onboarding_reminder`

No ninth key is permitted.

## Authority and row shape

The operator derives every row from the existing approved repository authorities:

- `docs/provider-manifests/whatsapp-template-submission-manifest.json`
- `docs/provider-manifests/meta-template-inactive-mapping-readiness.json`

It refuses if the readiness file no longer fingerprints the exact manifest bytes or if target classification, provider-name candidate, approval state, remote semantic proof, consent/registry posture, language, desired inactive mapping state, runtime-disabled state or send-denied state drifts.

The internal catalogue row shape is deliberately provider-neutral:

- `channel = whatsapp`
- `language = en`
- `version = 1.0`
- three evidence-bound acknowledgement rows use internal lane/category `authentication`
- five ordinary business rows use internal lane/category `business`
- `description` comes from the manifest's reviewed `qf_mvp_40.purpose`
- `provider_template_name = NULL`
- `provider_template_id = NULL`
- `readiness_status = provider_mapping_required`
- `is_active = true`

### Why internal version `1.0`

Phase 5B's canonical internal communication-template baseline uses version `1.0`, including `lead_received`. Provider revision suffixes such as the approved HELP `v3` belong to the Meta mapping identity, not to the internal catalogue version. The provider-specific mapping table remains the authority for the approved Meta provider name/version relationship.

### Why provider fields remain NULL

`services/providerTemplateMappingService.ts` explicitly has **no fallback** to `communication_templates.provider_template_name` for Meta. A real Meta send must resolve through `communication_provider_template_mappings`. Keeping both legacy provider fields NULL prevents the prerequisite from becoming a second provider-mapping authority.

### Why `provider_mapping_required` + `is_active = true`

`communication_templates.is_active` controls whether the internal template is a usable catalogue entry. `provider_mapping_required` keeps the provider readiness incomplete. Actual Meta dispatch still requires all independent runtime fences: a send-capable provider account, sendable runtime policy/canary state, and an exact approved **ACTIVE** provider mapping. QF-MVP-40.12 itself is still designed to seed only **INACTIVE** mappings and a disabled provider account, so this prerequisite cannot make Meta sending possible.

## Modes

### Offline dry run

No credential read, no Supabase client, no database connection, no write.

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/mvp/loader/register.mjs scripts/mvp/communication/seed-internal-staging-templates.mjs
```

### Read-only preflight

Requires only the two phase-scoped staging Supabase process variables:

- `QF_STAGING_SUPABASE_URL`
- `QF_STAGING_SUPABASE_SERVICE_ROLE_KEY`

The operator proves the exact staging project, validates a real service-role credential shape, requires the exact feature branch and a clean tree, proves the table/columns are readable, derives the eight rows from repository authority, and classifies each target as either `CREATE_INTERNAL_TEMPLATE` or `ALREADY_PRESENT_EXACT`.

It writes only a sanitized, single-use 15-minute attestation under the external QuickFurno operator-evidence directory.

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/mvp/loader/register.mjs scripts/mvp/communication/seed-internal-staging-templates.mjs --preflight-readonly
```

### Execute

`--execute` is refused without the still-valid preflight attestation. It reruns the full read-only preflight, verifies branch/HEAD/authority/plan have not changed, consumes the nonce **before** the database write, performs at most one bulk INSERT call for missing rows, and reads back all eight rows exactly.

It never updates, upserts or deletes an existing internal template. Any drift is a blocker. Any uncertain write/readback result is terminal and must not be blind-retried.

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/mvp/loader/register.mjs scripts/mvp/communication/seed-internal-staging-templates.mjs --execute
```

## Explicit non-actions

This prerequisite does **not**:

- call Meta;
- create or modify a Meta template;
- call `/messages`;
- create or modify `communication_provider_template_mappings`;
- populate any provider template ID;
- create or modify a provider account;
- change runtime policy;
- enable a webhook or canary;
- send a message;
- add the evidence-bound acknowledgement keys to the ordinary consent registry;
- run DDL or a migration;
- touch production or Jarvis;
- deploy QuickFurno.

## Offline validation

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/mvp/loader/register.mjs scripts/mvp/communication/validate-internal-staging-template-seed.mjs
node --check scripts/mvp/communication/seed-internal-staging-templates.mjs
node --check scripts/mvp/communication/validate-internal-staging-template-seed.mjs
git diff --check
```

The existing QF-MVP-40.12 suites must remain green after this additive repair.

## Required live ordering

1. Apply and validate this additive prerequisite code only.
2. Run prerequisite dry run.
3. Run prerequisite `--preflight-readonly`.
4. Review sanitized output.
5. Run exactly one prerequisite `--execute` under explicit staging-only authorization.
6. Independently read back the eight internal rows.
7. Clear staging credentials from the process.
8. Generate a **new** short-lived QF-MVP-40.12 staging index proof.
9. Reload QF-MVP-40.12's six process variables plus index-proof path.
10. Rerun QF-MVP-40.12 dry run and `--preflight-readonly`.
11. Only after the original 40.12 fences all pass may its single `--execute` be considered.

No webhook, canary or deployment work is included in this prerequisite.
