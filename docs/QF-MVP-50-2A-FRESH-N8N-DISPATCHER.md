# QF-MVP-50.2A — Fresh n8n Core Job Dispatcher Scaffold

**Status:** IMPLEMENTATION CANDIDATE  
**Base:** QF-MVP-50.1C final head `1f4833813a775d5d0cce85da6fbd5ebd904a36f3`  
**Workflow:** `QF-MVP-50-01-Core-Job-Dispatcher`  
**n8n state after import:** INACTIVE / UNPUBLISHED  
**Network:** BLOCKED  
**Credentials:** NONE  
**Meta / WhatsApp:** NONE  
**Production deployment:** NONE

## 1. Purpose

50.2A creates the first workflow for the fresh n8n account without importing any historical AOS workflow.

It is intentionally a **fail-closed scaffold**, not yet an executor.

```text
Schedule Trigger (inactive)
          │
          ├────────────┐
          │            │
          ▼            ▼
     Manual Trigger   (same path)
          │
          ▼
  50.2A Fail-Closed Gate
          │
          ▼
  STOP — Network Disabled
```

There is no HTTP node in this version.

Therefore importing or manually executing 50.2A cannot:

- call QuickFurno Core;
- claim an automation job;
- access Supabase;
- access Meta;
- send WhatsApp;
- change assignments;
- change credits/packages;
- change consent/suppression;
- contact Jarvis;
- create a provider side effect.

## 2. Why 50.2A is split from credential wiring

QF-MVP-50.1C requires two direction-specific HMAC secrets:

```text
n8n → Core
Core → n8n response verification
```

A secret must never be placed directly into:

- workflow JSON;
- Code node source;
- Crypto node `secret` parameter;
- Set/Edit Fields values;
- Sticky Notes;
- Git;
- chat.

The fresh account must first prove a clean import with no hidden legacy workflow or credential.

50.2B will choose and validate the secure n8n-side secret mechanism before adding any real Core HTTP Request.

## 3. Import artifact

```text
automation/n8n/QF-MVP-50-01-Core-Job-Dispatcher.workflow.json
```

The JSON contains:

- one Schedule Trigger;
- one Manual Trigger;
- one Code fail-closed gate;
- one terminal No Operation node;
- one security Sticky Note.

It contains no credential binding and no network-capable node.

## 4. Schedule trigger

The scaffold carries a one-minute Schedule Trigger because that is the intended dispatcher cadence.

The workflow is exported with:

```json
"active": false
```

Do not publish/activate it in 50.2A.

The Schedule Trigger exists only so we do not redesign the canvas later.

## 5. Safe manual test

After import, a manual execution may be used only to confirm the canvas imported correctly.

Expected final JSON:

```json
{
  "phase": "QF-MVP-50.2A",
  "dispatcher": "QF-MVP-50-01-Core-Job-Dispatcher",
  "transportVersion": 1,
  "runtimeMode": "off",
  "networkEnabled": false,
  "credentialsConfigured": false,
  "executable": false,
  "safeCode": "QF_50_2A_SECURE_TRANSPORT_NOT_WIRED"
}
```

No external request exists in the workflow.

## 6. Import procedure

After this source branch is remotely frozen:

1. Open the new blank n8n account.
2. Create/open a workflow area.
3. Import `QF-MVP-50-01-Core-Job-Dispatcher.workflow.json`.
4. Confirm the workflow name is exactly `QF-MVP-50-01-Core-Job-Dispatcher`.
5. Confirm it is **inactive / unpublished**.
6. Confirm there are exactly five nodes.
7. Confirm there is **no HTTP Request**, Webhook, Supabase, Postgres, Meta, or WhatsApp node.
8. Do not create credentials yet.
9. Do not activate/publish.
10. Optionally run the Manual Trigger only and confirm the fail-closed JSON above.

## 7. Historical workflow isolation

Do not import:

```text
QF-n8n-AOS-Master-Preview-Router.workflow.json
```

Do not recreate its shared-secret callback or preview event pipeline.

50.2A starts the new automation canvas from zero.

## 8. What 50.2B will add

Only after the clean 50.2A import is independently confirmed:

```text
secure n8n secret mechanism
        ↓
signed claim-request construction
        ↓
POST /api/internal/automation/n8n/claim
        ↓
verify signed Core response
        ↓
empty / replay → terminal STOP
        ↓
fresh executable claim only → routing gate
```

50.2B still will not send Meta/WhatsApp.

## 9. Future dispatcher routing

After the authenticated handshake is green, the dispatcher will route only the registered action family:

```text
client.*   → client child workflow
vendor.*   → vendor child workflow
campaign.* → campaign child workflow
```

Those child workflows are separate later phases.

The dispatcher never decides whether the business action is allowed. It receives only a Core-authorized durable job.

## 10. Jarvis boundary

Jarvis/Riya/Anisha do not call this n8n workflow.

Their path remains:

```text
agent request
   ↓
QuickFurno Core validation
   ↓
Core authorization
   ↓
durable job
   ↓
dispatcher
```

## 11. Phase exit criteria

50.2A closes only when:

- source validator is green;
- branch is remotely frozen;
- workflow imports into the fresh account;
- imported workflow remains inactive/unpublished;
- exact five-node containment is confirmed;
- no credential exists for this workflow;
- no network node exists;
- optional manual run returns the fail-closed marker only.

Then proceed to 50.2B secure handshake wiring.
