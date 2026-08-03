# QF-MVP-50.1C — Secure Core ↔ Fresh n8n Transport

**Status:** IMPLEMENTATION CANDIDATE  
**Depends on:** QF-MVP-50.1B (`984b6b8416a4ced169b98f2bc6cf9f0df2df1815`)  
**n8n environment:** fresh / blank account  
**n8n workflow activation:** NONE  
**Meta activation:** NONE  
**Production deployment:** NONE  
**Migration application in this implementation task:** NONE

## 1. Locked decision

The historical AOS preview n8n architecture is not the production automation path.

`QF-n8n-AOS-Master-Preview-Router.workflow.json` remains an inactive historical reference and is not imported, modified, or activated.

The fresh n8n account starts with a clean production architecture:

```text
Core-authorized durable job
          │
          ▼
signed n8n → Core claim request
          │
          ▼
Core one-shot transport replay guard
          │
          ▼
Core claims durable automation job
          │
          ▼
signed Core response
          │
          ▼
fresh n8n dispatcher
```

No workflow JSON is created in 50.1C. The first real workflow is QF-MVP-50.2 after this transport boundary passes staging.

## 2. Why n8n pulls a Core-authorized claim

n8n never selects database rows, assigns vendors, chooses recipients, chooses templates, decides consent, or creates business authority.

It asks:

```text
"Give this authenticated worker one already-authorized due job."
```

Core decides which durable job can be claimed.

This gives the fresh n8n environment no Supabase service-role key and no direct database path.

## 3. Cryptographic request contract

Inbound n8n requests use HMAC-SHA256.

Headers:

```text
x-qf-transport-version: 1
x-qf-request-id: <uuid>
x-qf-timestamp: <10-digit unix seconds>
x-qf-body-sha256: <64 lowercase hex>
x-qf-signature: v1=<64 lowercase hex>
```

Canonical n8n → Core string:

```text
QF-AUTOMATION-TRANSPORT-V1
N8N_TO_CORE
POST
/api/internal/automation/n8n/claim
<request-id>
<unix-seconds>
<body-sha256>
```

The timestamp must be within ±300 seconds.

The signature covers:

- HTTP method;
- exact path;
- request UUID;
- timestamp;
- exact raw-body SHA-256.

A signature for another path, body, timestamp, or request ID cannot be reused.

## 4. Direction-specific secrets

Two independent secrets are required when transport is enabled:

```text
QF_N8N_TO_CORE_HMAC_SECRET
QF_CORE_TO_N8N_HMAC_SECRET
```

They must not be equal.

The first authenticates n8n requests to Core.

The second signs Core responses so the n8n workflow can verify that the claim response came from Core and was not modified.

Secrets are runtime process environment only.

They are never:

- committed to Git;
- stored in workflow JSON;
- stored in Supabase;
- placed in `safeContext`;
- pasted into logs;
- sent to Jarvis;
- sent to Meta.

## 5. Runtime is fail-closed

Transport defaults to:

```text
QF_N8N_TRANSPORT_MODE=off
```

When enabled later, all of these must be valid before any claim RPC can run:

```text
QF_N8N_TRANSPORT_MODE=staging|production
QF_AUTOMATION_RUNTIME_ENV=<same value>
QF_N8N_TO_CORE_HMAC_SECRET=<>=32 chars>
QF_CORE_TO_N8N_HMAC_SECRET=<different >=32 chars>
QF_N8N_WORKER_ID=<safe fixed worker id>
```

A mode/environment mismatch fails before DB mutation.

No credentials are added in this implementation phase.

## 6. Claim body

The only accepted JSON fields are:

```json
{
  "transportVersion": 1,
  "requestId": "<same uuid as signed header>",
  "workerId": "<exact configured worker id>"
}
```

Extra fields are rejected.

The body is capped at 2 KiB.

No entity data, recipient, phone, template, provider identifier, secret, assignment, credit information, or consent override is accepted in the claim request.

## 7. Durable one-shot replay guard

Migration:

```text
20260801152049_qf_mvp_automation_transport_replay_guard.sql
```

adds:

```text
automation_transport_requests
```

Each signed claim request UUID may finalize exactly once:

```text
processing → claimed
processing → empty
```

A finalized row is immutable and cannot be deleted/truncated through normal paths.

`service_role` receives SELECT only.

The only application mutation surface is:

```text
qf_claim_automation_job_transport_v1(uuid,text,text)
```

a fixed-search-path `SECURITY DEFINER` RPC executable only by `service_role`.

n8n never executes this RPC directly. The Next.js Core route does.

## 8. Critical replay rule

A request replay is deliberately **not** normal idempotent redelivery.

Example:

```text
n8n request A
     │
     ▼
Core claims job J / attempt 1
     │
     ▼
Core sends response
     │
     X network outcome becomes ambiguous
```

If n8n sends request A again:

```text
same request UUID
same body hash
same worker
        │
        ▼
replay detected
        │
        ▼
executable = false
```

Even though the replay ledger remembers which job was claimed, the API does not return the executable job envelope again.

This is intentional.

If the original response might have reached n8n, sending the executable envelope again could duplicate an external action.

The existing job remains `processing`.

QF-MVP-50.5 later reconciles stale processing attempts through explicit uncertainty logic.

## 9. A changed replay is rejected

The same request UUID with a changed:

- worker ID; or
- raw-body hash

returns:

```text
AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT
```

A request UUID therefore cannot be repurposed.

## 10. Fresh claim response

A first-time claim with no due work returns:

```json
{
  "ok": true,
  "transportVersion": 1,
  "requestId": "...",
  "state": "empty",
  "replayed": false,
  "executable": false
}
```

A first-time successful claim returns:

```text
state = claimed
replayed = false
executable = true
claim = durable attempt identity
job = 50.1A AutomationJobEnvelope
```

The envelope still contains no arbitrary phone, recipient, provider account, template, credit delta, assignment list, desired status, or bypass flag.

## 11. Replayed claimed response

A repeated signed request returns:

```json
{
  "ok": true,
  "transportVersion": 1,
  "requestId": "...",
  "state": "claimed",
  "replayed": true,
  "executable": false,
  "message": "CLAIM_REPLAY_EXECUTION_SUPPRESSED"
}
```

n8n must stop that execution branch.

## 12. Core response signature

Authenticated claim responses are signed with the second directional secret.

Response headers:

```text
x-qf-response-version
x-qf-response-request-id
x-qf-response-timestamp
x-qf-response-body-sha256
x-qf-response-signature
```

Canonical response string:

```text
QF-AUTOMATION-TRANSPORT-V1
CORE_TO_N8N_RESPONSE
/api/internal/automation/n8n/claim
<request-id>
<unix-seconds>
<body-sha256>
```

The future QF-MVP-50.2 n8n dispatcher will verify this signature before routing a job to a child workflow.

## 13. New Core endpoint

```text
POST /api/internal/automation/n8n/claim
```

The route:

1. verifies runtime mode/config before DB access;
2. reads the exact raw body;
3. verifies body size;
4. verifies HMAC, body hash, path, request ID, and clock window;
5. validates the exact three-field JSON body;
6. requires the configured worker identity;
7. calls the one-shot Core claim RPC;
8. returns an executable envelope only on a fresh successful claim;
9. signs authenticated responses;
10. returns only sanitized error codes.

It never logs or returns a secret.

## 14. Fresh n8n account plan

Do not manually create arbitrary workflow nodes yet.

QF-MVP-50.2 will create the first fresh workflow:

```text
QF-MVP-50-01-Core-Job-Dispatcher
```

It will be imported/created as **inactive**.

Its job is intentionally small:

```text
trigger
  ↓
build signed claim request
  ↓
POST QuickFurno Core claim endpoint
  ↓
verify Core response signature
  ↓
IF empty/replay → STOP
  ↓
route by registered action workflow family
```

Business rules remain in Core.

## 15. What n8n will never hold

The fresh n8n account must not receive:

- Supabase service-role key;
- direct Supabase mutation credential;
- Meta access token;
- QuickFurno business-rule tables;
- consent/suppression authority;
- package/credit authority;
- vendor assignment authority;
- Jarvis DB credentials.

Later n8n may hold narrowly scoped QuickFurno transport credentials in its own encrypted Credentials store.

## 16. Jarvis provision remains unchanged

Jarvis/Riya/Anisha still stop at:

```text
request → Core validation → Core authorization
```

They do not know or call the n8n claim endpoint.

The durable job does not gain authority because its original source was `jarvis`, `riya`, or `anisha`.

## 17. Phase boundary

50.1C contains:

- HMAC request/response contract;
- runtime fail-closed configuration;
- persistent one-shot transport replay ledger;
- one-shot claim RPC;
- internal signed claim route;
- offline validator;
- documentation.

50.1C does **not**:

- activate transport runtime;
- create secrets;
- create an n8n credential;
- import an n8n workflow;
- call n8n;
- call Meta;
- send WhatsApp;
- implement business action execution;
- implement stale-processing reconciliation;
- deploy production;
- apply its migration during the offline implementation step.

## 18. Next

After 50.1C source review:

```text
50.1C staging migration review/apply
        ↓
rollback-only signed/replay probes
        ↓
QF-MVP-50.2
fresh inactive n8n dispatcher
        ↓
authenticated staging handshake
```
