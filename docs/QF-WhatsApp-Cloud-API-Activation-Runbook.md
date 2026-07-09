# QuickFurno — WhatsApp Cloud API Activation Runbook (Phase 5F-B)

> **STATUS: NOT COMPLETE.** This is a controlled, operator-driven checklist. Nothing
> below is done automatically by code. No step is marked complete unless an operator
> has actually verified it in the live environment. Phase 5F-B ships the adapter and
> gates **disabled**; activation happens here, manually, later.
>
> **Never put a secret value in this document, a commit, a log, or a database column.**

## Authority reminder

A provider being technically configured **does not** authorize a communication. Every
message still passes QuickFurno authorization (Phase 4 Policy Engine) before provider
delivery. Supabase Auth remains the client OTP/session authority; `verification_challenges`
the vendor challenge authority; CommunicationService the ledger/dispatch boundary;
Meta Cloud API is a transport provider only; n8n is execution fabric only.

## Prerequisites (verify each — do not assume)

- [ ] **NOT VERIFIED** — Meta business portfolio exists and is owned by QuickFurno.
- [ ] **NOT VERIFIED** — Meta app created; WhatsApp product added.
- [ ] **NOT VERIFIED** — WABA (WhatsApp Business Account) created.
- [ ] **NOT VERIFIED** — Production business phone number added to the WABA.
- [ ] **NOT VERIFIED** — Phone Number ID recorded as a **non-secret** reference.
- [ ] **NOT VERIFIED** — WABA ID recorded as a **non-secret** reference.
- [ ] **NOT VERIFIED** — Business verification completed (`business_verification_status = verified`).
- [ ] **NOT VERIFIED** — Display-name review approved.
- [ ] **NOT VERIFIED** — Phone number registered / connected (`phone_number_status = connected`).
- [ ] **NOT VERIFIED** — Two-step verification readiness confirmed.

## Server-only credential configuration (runtime env, never committed/stored)

- [ ] **NOT VERIFIED** — `WHATSAPP_PROVIDER_MODE=meta_cloud`.
- [ ] **NOT VERIFIED** — `WHATSAPP_ACCESS_TOKEN` (System User token) set server-only.
- [ ] **NOT VERIFIED** — `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID` set (non-secret).
- [ ] **NOT VERIFIED** — `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` set server-only.
- [ ] **NOT VERIFIED** — `WHATSAPP_GRAPH_API_VERSION` explicitly pinned (e.g. `v19.0`).
- [ ] **NOT VERIFIED** — `WHATSAPP_HTTP_TIMEOUT_MS` set (finite, positive, bounded).
- [ ] **NOT VERIFIED** — `.env` / `.env.local` were **not** modified by code review; secrets live only in the deployment secret store.

## App ↔ WABA subscription (operator action — never automated)

- [ ] **NOT VERIFIED** — Meta app subscribed to the WABA via the Meta-side subscription
  step. QuickFurno performs **no** automatic WABA subscription: there is no code path,
  route, startup task, or health check that calls the subscription endpoint. Do this
  in the Meta App Dashboard / Graph API by an operator.

## Migration + runtime policy

- [ ] **NOT VERIFIED** — `20260709000200_whatsapp_cloud_api_runtime_control.sql` applied
  manually via the Supabase SQL editor (NOT `db push`/`migration up`/`repair`/`reset`).
- [ ] **NOT VERIFIED** — Runtime policy row seeded **disabled** (as shipped).
- [ ] **NOT VERIFIED** — Provider account row created (operator) with non-secret references
  matching config, and readiness fields advanced only as each is truly verified.

## Webhook

- [ ] **NOT VERIFIED** — Public HTTPS endpoint `/api/webhooks/whatsapp/meta` reachable.
- [ ] **NOT VERIFIED** — GET verification succeeds (`hub.mode=subscribe` + matching
  `hub.verify_token`). This is independent of outbound sending and can be verified first.
- [ ] **NOT VERIFIED** — Enable `webhook_processing_enabled = true` on the runtime policy
  (independent of `outbound_enabled`) so delivery webhooks are processed.
- [ ] **NOT VERIFIED** — POST signature validation passing (`X-Hub-Signature-256` over the raw body).

## Health check

- [ ] **NOT VERIFIED** — Enable `health_check_enabled = true`; run the explicit provider
  health check; confirm only safe fields persisted (`health_status`, `last_health_check_at`).

## Template mapping + binding

- [ ] **NOT VERIFIED** — Submit each template to Meta (out of band) and, once **approved**,
  create the `communication_provider_template_mappings` row(s): `approval_status=approved`,
  `is_active=true`, real `provider_template_name`, matching language, and a `variables_schema`
  binding contract (for OTP: body position 1 ← `otp`). No mapping is fabricated.

## Canary → active rollout

- [ ] **NOT VERIFIED** — Add a canary destination **hash** allowlist entry (operator-approved).
- [ ] **NOT VERIFIED** — Set runtime policy `activation_status = canary`, `outbound_enabled = true`.
- [ ] **NOT VERIFIED** — Test send to an allowlisted destination; observe delivery / read /
  failure webhooks advancing the message lifecycle.
- [ ] **NOT VERIFIED** — Only after canary success: `activation_status = active` (canary
  allowlist no longer required), under change control.

## Operations

- [ ] **NOT VERIFIED** — **Emergency pause**: set `activation_status = paused` (or
  `outbound_enabled = false`) to stop outbound immediately.
- [ ] **NOT VERIFIED** — **Rollback to mock**: set `WHATSAPP_PROVIDER_MODE=mock`; the mock
  adapter requires no Meta config and makes no network calls.
- [ ] **NOT VERIFIED** — **Final active-mode approval** recorded by an authorized operator.

## Out of scope for Phase 5F-B (do not do here)

Template submission, inbound message processing, consent/STOP handling, conversation
routing, marketing campaigns, RCS, SMS fallback, Jarvis agents, an admin Communication
Center UI. These belong to later phases (5F-C/5F-D and beyond).
