# QF-MVP-50.2B — Secure Signed n8n ↔ Core Claim Handshake

**Status:** SOURCE CANDIDATE
**Base:** QF-MVP-50.2A `a568d526461b3ac85c5245fcf5ccb97171f541bc`
**Target:** staging handshake only
**Workflow activation:** NONE
**Meta / WhatsApp:** NONE
**Supabase credential in n8n:** NONE
**Jarvis direct path:** NONE

## Locked objective

50.2B proves one thing only:

```text
n8n
  ↓ exact body SHA-256
  ↓ HMAC-SHA256 request signature
QuickFurno Core /api/internal/automation/n8n/claim
  ↓ Core-signed response
n8n
  ↓ body hash + request ID + timestamp + HMAC verification
verified claim envelope
  ↓
STOP — routing disabled
```

No child workflow is executed in 50.2B.

## Why the current blank/cloud workspace is not automatically used for secrets

The production-grade HMAC secret must not be placed directly in workflow JSON, Code source, Set/Edit Fields, Sticky Notes, or a Crypto node literal.

This source candidate therefore uses **self-hosted n8n runtime environment references**:

```text
$env.QF_N8N_TO_CORE_HMAC_SECRET
$env.QF_CORE_TO_N8N_HMAC_SECRET
```

The workflow contains the variable names only, never their values.

If the current n8n account is n8n Cloud, do not import this candidate until the secret-source decision is resolved. External Secrets is a separate Enterprise capability; we do not assume it exists.

## Required runtime values later

On the self-hosted n8n runtime, configure out-of-band:

```text
QF_CORE_STAGING_BASE_URL
QF_N8N_WORKER_ID
QF_N8N_TO_CORE_HMAC_SECRET
QF_CORE_TO_N8N_HMAC_SECRET
QF_N8N_TRANSPORT_ENABLED
```

Rules:

- both HMAC secrets are at least 32 characters;
- the two HMAC secrets are different;
- worker ID matches `^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`;
- base URL is HTTPS;
- transport remains disabled unless `QF_N8N_TRANSPORT_ENABLED=true`;
- never paste any secret value into Git, chat, workflow JSON, screenshots, or node parameters.

## Exact 50.1C request contract

Body:

```json
{
  "transportVersion": 1,
  "requestId": "<uuid>",
  "workerId": "<configured worker>"
}
```

Canonical request:

```text
QF-AUTOMATION-TRANSPORT-V1
N8N_TO_CORE
POST
/api/internal/automation/n8n/claim
<request-id>
<unix-seconds>
<body-sha256>
```

Headers:

```text
x-qf-transport-version: 1
x-qf-request-id: <uuid>
x-qf-timestamp: <unix-seconds>
x-qf-body-sha256: <lowercase sha256 hex>
x-qf-signature: v1=<lowercase hmac-sha256 hex>
```

## Exact Core response verification

Canonical response:

```text
QF-AUTOMATION-TRANSPORT-V1
CORE_TO_N8N_RESPONSE
/api/internal/automation/n8n/claim
<response-request-id>
<response-unix-seconds>
<actual-response-body-sha256>
```

The workflow verifies:

- response transport version = 1;
- response request ID equals original request ID;
- timestamp is 10 decimal digits and within ±300 seconds;
- Core body-hash header equals the SHA-256 of the exact response body;
- signature format is `v1=<64 lowercase hex>`;
- HMAC using the separate Core→n8n secret matches.

Any failed check terminates at `STOP — Reject Unverified Response`.

## Replay rule

A valid replay response is never executable.

50.1C deliberately suppresses replay execution. 50.2B preserves that rule and refuses any shape where:

```text
replayed = true AND executable != false
```

Likewise:

```text
state = empty AND executable != false
```

is rejected.

## Fresh claim rule

Even if Core returns:

```text
state = claimed
replayed = false
executable = true
```

50.2B still sets:

```text
routingEnabled = false
```

and stops.

Actual action routing begins only after the next routing phase.

## Source artifact

```text
automation/n8n/QF-MVP-50-01-Core-Job-Dispatcher.50.2B-selfhost-env.workflow.json
```

This is a **candidate**, not yet the imported production workflow.

It is exported with:

```json
"active": false
```

and is fail-closed by runtime gate.

## Deployment boundary

50.2B source implementation does not:

- deploy QuickFurno;
- deploy n8n;
- modify the existing imported 50.2A cloud workflow;
- apply a database migration;
- create any n8n credential;
- activate/publish any workflow;
- call Meta;
- send WhatsApp;
- contact Jarvis.

## Next gate after source freeze

After this branch is green and remotely frozen:

1. confirm whether the target n8n runtime is self-hosted or Enterprise Cloud with external secrets;
2. if self-hosted, configure the five runtime values out-of-band;
3. deploy the already-reviewed 50.1C Core route to **staging only**;
4. import the 50.2B candidate into that staging n8n runtime, still inactive;
5. run a manual signed handshake against staging;
6. verify empty/replay/fresh-claim behavior without routing;
7. keep production and Meta OFF.
