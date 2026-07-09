# QuickFurno — WhatsApp Cloud API Production Readiness (Phase 5F-A)

This is a **readiness checklist and server-only configuration contract**, not an
activation. Phase 5F-A connects **no** Meta Cloud API, commits **no** token or
secret, submits **no** template, and enables **no** automation. The live checkpoint
is unchanged: every WhatsApp automation is `mock_ready` / disabled / `provider =
mock`, and every template row has `provider_template_name = NULL` and
`provider_template_id = NULL`. Phase 5F-B performs the real Meta adapter + mapping
work under a controlled rollout.

## Meta assets (identify — do not connect)

| Asset | What it is | Where its non-secret reference lives |
| --- | --- | --- |
| Meta business portfolio | The owning business | `communication_provider_accounts.business_account_reference` (id only) |
| Meta app | The app the WhatsApp product is added to | (non-secret app id, ops notes only) |
| WhatsApp product | Cloud API product on the app | — |
| WABA (WhatsApp Business Account) | Holds phone numbers + templates | `communication_provider_accounts.business_account_reference` |
| Production business phone number | The sending number | referenced by id, never stored in plaintext |
| Phone number ID | Cloud API send target id | `communication_provider_accounts.phone_number_reference` |
| WABA ID | Template + number owner id | `business_account_reference` |
| Business portfolio ID | Portfolio id | `account_reference` |
| Business verification state | Meta business verification | `business_verification_status` |
| Display-name review state | Approved display name | tracked in ops metadata / `phone_number_status` |

All of the above are **non-secret operational identifiers**. None is a credential.

## Token and permissions (document — do not create/store)

- **System user token strategy** — use a Meta **System User** access token (not a
  personal user token), scoped to the WABA, issued from the business portfolio.
- Required scopes:
  - `whatsapp_business_management` — manage templates, phone numbers, WABA config.
  - `whatsapp_business_messaging` — send messages / receive delivery status.
  - `business_management` — **only where genuinely required** (asset management);
    prefer the two above.
- **Rotation / revocation procedure** — tokens are rotated on a schedule and on any
  suspected exposure; the previous token stays valid for a short overlap, then is
  revoked. Rotation never requires a schema or code change (the token is a runtime
  server-only secret, never in the repo or the database).

## Server-only config contract (documented — DELIBERATELY NOT SET)

These are **runtime, server-only** environment variables. Phase 5F-A does not set
them, and they must never be committed or written to any table:

```
WHATSAPP_ACCESS_TOKEN          # System User token (secret)
WHATSAPP_PHONE_NUMBER_ID       # non-secret send-target id
WHATSAPP_WABA_ID               # non-secret WABA id
WHATSAPP_APP_SECRET            # app secret for webhook signature (secret)
WHATSAPP_WEBHOOK_VERIFY_TOKEN  # GET-verification token (secret)
WHATSAPP_GRAPH_API_VERSION     # e.g. a pinned Graph API version string
```

Only `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, and
`WHATSAPP_WEBHOOK_VERIFY_TOKEN` are secrets; the others are non-secret ids. The
database `communication_provider_accounts` stores **only** the non-secret
references — there is no token/secret column anywhere.

## Webhook readiness

- **Public HTTPS endpoint** with a stable URL.
- **GET verification contract** — echo `hub.challenge` only when
  `hub.verify_token` matches `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
- **POST raw-body signature validation** — verify `X-Hub-Signature-256` (HMAC-SHA256
  under `WHATSAPP_APP_SECRET`) against the **raw** body, in constant time, before
  any JSON parse. (QuickFurno already applies this pattern for the Supabase Send SMS
  hook via `standardwebhooks`; the WhatsApp adapter mirrors it.)
- **Status event normalization** — map provider statuses to the canonical
  `accepted|sent|delivered|read|failed`; drop anything unmappable (never coerce).
- **Duplicate receipt protection** — de-duplicate on `(provider, provider_event_id)`
  and on `payload_hash` (Phase 5B `communication_webhook_receipts` already does this).
- **Delivery / read / failure events** — recorded on `communication_delivery_events`
  (append-only) and folded into the message lifecycle.
- **Inbound message readiness** — inbound handling is a later phase (5F-D); the
  endpoint is designed to accept it without a schema change.
- **Template status synchronization readiness** — template approval/quality events
  update `communication_provider_template_mappings` (approval_status / quality_status
  / rejection_reason_sanitized), never a raw provider payload.
- **Phone / account status event readiness** — number/account status events update
  `communication_provider_accounts.phone_number_status` / `webhook_status` /
  `business_verification_status`.
- **Safe replay process** — replays are idempotent via the receipt de-duplication;
  a replay never re-sends and never double-advances a lifecycle state.
- **Monitoring and health checks** — `communication_provider_accounts.health_status`
  + `last_health_check_at`; the provider adapter's `healthCheck()` returns only
  sanitized details.

## Template readiness lifecycle

Tracked in `communication_provider_template_mappings` (not the legacy single-slot
columns, which remain for backward compatibility until a later controlled
migration):

1. **Internal template inventory** — the 16 QuickFurno `communication_templates`
   rows (see the submission manifest).
2. **Provider mapping** — `provider_template_name` / `provider_template_id` per
   `(template_key, channel, provider_key, language, version)`.
3. **Language** — per-language mapping row.
4. **Variable schema** — `variables_schema` JSON per mapping.
5. **Category** — `provider_category` (`authentication|utility|marketing|service`).
6. **Submission → approval → rejection** — `approval_status`
   (`draft → ready_for_submission → submitted → approved | rejected`),
   `submission_reference`, `submitted_at` / `approved_at` / `rejected_at`,
   `rejection_reason_sanitized`.
7. **Quality state** — `quality_status` (`green|yellow|red|paused`).
8. **Pause / disable** — `approval_status` `paused` / `disabled`.
9. **Version supersession** — a new `version` row supersedes the prior
   (`superseded`), so at most one `is_active` mapping exists per
   `(template, channel, provider, language)`.

**Current state (do not claim otherwise):** all 16 templates have
`provider_template_name = NULL` and `provider_template_id = NULL`. No template is
submitted or approved. No mapping row is created by Phase 5F-A.

## Explicitly NOT done in Phase 5F-A

No Meta connection, no token/secret, no webhook secret, no template submission or
approval, no provider mapping row, no automation enablement, no readiness advance,
no automatic WhatsApp→SMS fallback.
