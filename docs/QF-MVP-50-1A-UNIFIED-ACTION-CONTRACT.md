# QF-MVP-50.1A — Unified Action Contract + Jarvis Provision

**Status:** IMPLEMENTATION CANDIDATE  
**Scope:** contract + registry + offline validation only  
**Production effects:** NONE  
**Database migration:** NONE in 50.1A  
**n8n activation:** NONE  
**Meta activation:** NONE  
**Jarvis runtime integration:** NONE

## 1. Locked architecture

```text
Core-native event ─┐
Admin request ─────┤
System request ────┤
Jarvis request ────┤
Riya request ──────┤
Anisha request ────┘
        │
        ▼
QuickFurno Core request boundary
        │
        ├── reject → audit only → STOP
        │
        ▼
Core business authorization
        │
        ▼
CoreAuthorizedAction
        │
        ▼
AutomationJobEnvelope
        │
        ▼
n8n executor
        │
        ▼
Core action/communication endpoint
        │
        ▼
Meta / provider
        │
        ▼
verified result/callback
        │
        ▼
QuickFurno Core canonical result + audit
```

**Core is authority. Jarvis/Riya/Anisha request. n8n executes. Meta delivers. Results return to Core.**

`source` is provenance only. It is never permission.

## 2. Jarvis provision

QF-MVP-50.1A recognizes `jarvis`, `riya`, and `anisha` as request sources. They can submit only action types explicitly marked requestable in `actionRegistry.ts`. Requestability is not authorization.

Initial AI requestability is intentionally narrow:

- Jarvis/Riya/Anisha: client communication request types.
- Jarvis only: selected vendor reminder request types.
- No AI source: campaign execution, vendor lead offer, package/credit warnings.

QF-MVP-60 may extend the registry later without changing the job envelope or n8n architecture.

Jarvis/Riya/Anisha must never:

- hold the Supabase service-role key;
- write Core tables directly;
- assign vendors;
- modify packages or credits;
- change consent or suppression;
- choose campaign recipients;
- choose arbitrary destinations;
- choose arbitrary templates/provider accounts;
- call Meta directly;
- treat a recommendation as an authorization.

## 3. QF-MVP-50 action vocabulary

Client:

- `client.lead_confirmation`
- `client.requirement_collection`
- `client.missing_information_reminder`
- `client.matching_update`
- `client.lead_status_update`
- `client.transactional_followup`

Vendor:

- `vendor.lead_offer`
- `vendor.response_reminder`
- `vendor.onboarding_reminder`
- `vendor.document_reminder`
- `vendor.package_expiry_warning`
- `vendor.low_credit_warning`

Campaign:

- `campaign.execute_batch`
- `campaign.execute_recipient`

Workflow families:

- `client_whatsapp`
- `vendor_whatsapp`
- `campaign_execution`

## 4. Existing n8n preview file

The historical `QF-n8n-AOS-Master-Preview-Router.workflow.json` stays:

**`KEEP_INACTIVE_REFERENCE`**

Do not convert it into production.

QF-MVP-50 will create fresh production workflow files:

1. `QF-MVP-50-Core-Job-Dispatcher.workflow.json`
2. `QF-MVP-50-Client-WhatsApp.workflow.json`
3. `QF-MVP-50-Vendor-WhatsApp.workflow.json`
4. `QF-MVP-50-Campaign-Execution.workflow.json`
5. `QF-MVP-50-Failure-Reconciliation.workflow.json`

The dispatcher stays small. Business rules stay in Core, not in n8n Switch/IF nodes.

## 5. Request vs authorization vs execution

`CoreActionRequest` carries action/entity identity, provenance, audit actor, Core-minted idempotency/correlation IDs and sanitized context. It does not grant execution permission.

`CoreAuthorizedAction` adds explicit Core authorization evidence.

Only a `CoreAuthorizedAction` can become an `AutomationJobEnvelope`.

The n8n-facing envelope contains no destination, phone, arbitrary template, provider account, credit delta, assignment list, desired status, or bypass flag.

n8n will later call a Core endpoint with the job identity. Core resolves the destination/template/provider and re-checks all dispatch-time gates.

## 6. Forbidden executor fields

The contract recursively rejects common authority-bypass inputs including:

- `force_send`
- `ignore_consent`
- `bypass_suppression`
- recipient / phone / WhatsApp destination
- arbitrary template
- provider-account override
- token / secret / authorization
- credit delta / restoration
- assign-vendor IDs
- desired status
- `retry_anyway`
- `skip_validation`

## 7. Idempotency and correlation

Core action idempotency key:

```text
qf_action_v1:<action_type>:<entity_type>:<entity_id>:<evidence_id>
```

Correlation ID:

```text
qf_corr_v1:<entity_type>:<entity_id>
```

`evidence_id` must be a stable Core identity such as the originating domain event, approved campaign intent, assignment, reminder schedule, or other immutable evidence row. It must never be random per retry.

## 8. Outcome classification

Closed vocabulary:

- `success`
- `retryable_failure`
- `definitive_failure`
- `uncertain`

Automatic retry is permitted **only** for `retryable_failure`.

`uncertain` is terminal for the execution attempt and must never be blindly resent. Later verified provider evidence may reconcile Core state independently.

## 9. Phase split

### 50.1A — this phase
- pure action contract
- action registry
- Jarvis/Riya/Anisha provenance + requestability provision
- idempotency/correlation grammar
- result classification
- forbidden-context guard
- offline validator

### 50.1B — next
- forward-only durable schema designed against the current reconciled DB
- action requests
- automation jobs
- execution attempts/results
- claim/lease
- retry/dead-letter
- audit persistence
- staging application only after separate review

### 50.1C / 50.2
- authenticated Core↔n8n transport
- fresh production n8n workflows
- no activation until staging gates are satisfied

## 10. Explicit non-actions

This phase performs no DB migration/application, no database write, no provider access, no webhook activation, no n8n workflow activation, no Meta send, no environment change, no VPS deployment, and no Jarvis runtime call.
