-- ============================================================================
-- QuickFurno — 20260708000170_unified_communication_core.sql
--
-- PHASE 5B — UNIFIED COMMUNICATION CORE + MOCK WHATSAPP PROVIDER (additive-only).
--
-- Creates the persistence foundation for provider-neutral communication logic.
--
-- Creates 5 tables:
--   • public.communication_templates
--   • public.communication_messages
--   • public.communication_delivery_events
--   • public.communication_webhook_receipts
--   • public.communication_automation_catalog
--
-- SECURITY / INTEGRITY INVARIANTS ENCODED HERE
--   • No plaintext destination column exists. Only destination_hash (sha256 of
--     the canonical E.164 value) and destination_masked are persisted.
--   • No plaintext OTP, password, token or provider-secret column exists.
--   • communication_delivery_events is APPEND-ONLY: the message FK is
--     ON DELETE RESTRICT and service_role receives SELECT + INSERT only. There
--     is no grant that can rewrite or erase a delivery trace.
--   • Webhook receipts de-duplicate on (provider, provider_event_id) and on
--     (provider, payload_hash). Both indexes are PARTIAL on signature_valid, so
--     an unsigned/forged body can never occupy the de-duplication slot that a
--     legitimate redelivery of the same payload would need.
--   • Automation READINESS (how far it is built) is separate from operational
--     ENABLEMENT (whether an operator turned it on), and a check constraint
--     forbids enabling anything whose readiness is not 'active'. Enablement is
--     never sufficient on its own — every dispatch still passes through the
--     Phase 4 policy authorization path.
--
-- RLS model:
--   • Enable RLS and revoke all anon/authenticated permissions on every
--     communication table (deny-all for the PostgREST API roles; no policies).
--   • Grant service_role the least privilege each table actually needs.
--
-- Additive, idempotent, non-destructive. NOT applied to production by this change.
-- ============================================================================

-- 1) COMMUNICATION TEMPLATES
create table if not exists public.communication_templates (
  id                      uuid primary key default gen_random_uuid(),
  template_key            text not null unique,
  channel                 text not null check (channel = 'whatsapp'),
  category                text not null check (category in ('authentication', 'business')),
  description             text,
  language                text not null default 'en',
  version                 text not null,
  provider_template_name  text,
  provider_template_id    text,
  readiness_status        text not null default 'draft'
                            check (readiness_status in ('draft', 'mock_ready', 'provider_mapping_required', 'provider_ready', 'disabled')),
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_communication_templates_key_active
  on public.communication_templates(template_key, is_active);

-- 2) COMMUNICATION MESSAGES
-- `provider` has NO default: the dispatching adapter's providerKey is always
-- written explicitly, so no provider name is baked into the schema.
create table if not exists public.communication_messages (
  id                        uuid primary key default gen_random_uuid(),
  message_type              text not null,
  lane                      text not null check (lane in ('authentication', 'business')),
  channel                   text not null check (channel = 'whatsapp'),
  recipient_type            text not null check (recipient_type in ('client', 'vendor', 'admin', 'integration', 'system')),
  recipient_id              uuid,
  -- sha256 of the canonical E.164 destination. The plaintext number is resolved
  -- server-side at dispatch time and is never stored.
  destination_hash          text not null,
  destination_masked        text not null,
  template_key              text references public.communication_templates(template_key),
  entity_type               text,
  entity_id                 uuid,
  correlation_id            text,
  idempotency_key           text not null unique,
  policy_decision_id        uuid,
  status                    text not null default 'queued'
                              check (status in ('queued', 'dispatching', 'accepted', 'sent', 'delivered', 'read', 'failed', 'retry_scheduled', 'dead_letter', 'cancelled')),
  priority                  text not null default 'normal'
                              check (priority in ('critical', 'high', 'normal', 'low')),
  scheduled_at              timestamptz,
  attempt_count             integer not null default 0,
  max_attempts              integer not null default 5,
  next_retry_at             timestamptz,
  provider                  text not null,
  provider_message_id       text,
  failure_code              text,
  failure_reason_sanitized  text,
  variables                 jsonb not null default '{}'::jsonb,
  metadata                  jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  accepted_at               timestamptz,
  sent_at                   timestamptz,
  delivered_at              timestamptz,
  read_at                   timestamptz,
  failed_at                 timestamptz,
  updated_at                timestamptz not null default now()
);

create index if not exists idx_communication_messages_lookup
  on public.communication_messages(status, lane, recipient_type, recipient_id);
create index if not exists idx_communication_messages_retry
  on public.communication_messages(next_retry_at)
  where status = 'retry_scheduled';
create index if not exists idx_communication_messages_scheduled
  on public.communication_messages(scheduled_at)
  where status = 'queued';
-- Webhook correlation: provider message ids are only meaningful per provider.
create index if not exists idx_communication_messages_provider_message
  on public.communication_messages(provider, provider_message_id)
  where provider_message_id is not null;

-- 3) COMMUNICATION DELIVERY EVENTS — immutable, append-only trace.
-- ON DELETE RESTRICT (not CASCADE): a delivery trace must outlive any attempt to
-- remove the message it describes.
create table if not exists public.communication_delivery_events (
  id                        uuid primary key default gen_random_uuid(),
  communication_message_id  uuid not null references public.communication_messages(id) on delete restrict,
  provider                  text not null,
  provider_event_id         text,
  normalized_event_type     text not null check (normalized_event_type in ('accepted', 'sent', 'delivered', 'read', 'failed')),
  provider_message_id       text not null,
  occurred_at               timestamptz not null default now(),
  sanitized_metadata        jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now()
);

-- One trace row per (provider event, message, lifecycle state). Scoped this way
-- so a provider may batch several messages under one event id without conflict,
-- while a redelivered event can never double-create a trace row.
create unique index if not exists uq_comm_delivery_event_provider_event
  on public.communication_delivery_events(provider, provider_event_id, provider_message_id, normalized_event_type)
  where provider_event_id is not null;
create index if not exists idx_comm_delivery_event_message_id
  on public.communication_delivery_events(communication_message_id);

-- 4) WEBHOOK RECEIPTS
-- duplicate_count / last_duplicate_at give admin monitoring a record of every
-- redelivery WITHOUT inserting a row that violates the uniqueness constraints.
create table if not exists public.communication_webhook_receipts (
  id                        uuid primary key default gen_random_uuid(),
  provider                  text not null,
  provider_event_id         text,
  payload_hash              text not null,
  signature_valid           boolean not null,
  normalized_event_type     text check (normalized_event_type in ('accepted', 'sent', 'delivered', 'read', 'failed')),
  processing_status         text not null default 'received'
                              check (processing_status in ('received', 'verified', 'processed', 'duplicate', 'rejected', 'failed')),
  duplicate_count           integer not null default 0,
  last_duplicate_at         timestamptz,
  received_at               timestamptz not null default now(),
  processed_at              timestamptz,
  failure_reason_sanitized  text,
  created_at                timestamptz not null default now()
);

-- Verified events de-duplicate on the provider's own event id.
create unique index if not exists uq_comm_webhook_receipt_provider_event
  on public.communication_webhook_receipts(provider, provider_event_id)
  where signature_valid and provider_event_id is not null;

-- Payload-hash de-duplication is partitioned by signature validity: a forged
-- body sharing a legitimate payload's hash lands in the other index, so it can
-- never make the legitimate webhook look like a duplicate.
create unique index if not exists uq_comm_webhook_receipt_payload_verified
  on public.communication_webhook_receipts(provider, payload_hash)
  where signature_valid;
create unique index if not exists uq_comm_webhook_receipt_payload_rejected
  on public.communication_webhook_receipts(provider, payload_hash)
  where not signature_valid;

create index if not exists idx_comm_webhook_receipt_received
  on public.communication_webhook_receipts(received_at desc);

-- 5) AUTOMATION CATALOG
-- readiness_status  = how far the automation has been BUILT.
-- is_operationally_enabled = whether an operator has TURNED IT ON.
-- They are independent, and enabling requires readiness = 'active'.
-- Operational enablement NEVER bypasses Phase 4 authorization: it only makes an
-- automation eligible to request a policy decision.
create table if not exists public.communication_automation_catalog (
  automation_key            text primary key,
  category                  text not null check (category in ('otp', 'notification', 'alert', 'marketing', 'system')),
  description               text,
  lane                      text not null check (lane in ('authentication', 'business')),
  channel                   text not null check (channel = 'whatsapp'),
  readiness_status          text not null default 'wiring_pending'
                              check (readiness_status in ('foundation_ready', 'wiring_pending', 'mock_ready', 'provider_mapping_required', 'provider_ready', 'active')),
  provider_required         text not null,
  template_key              text references public.communication_templates(template_key),
  is_operationally_enabled  boolean not null default false,
  last_triggered_at         timestamptz,
  last_success_at           timestamptz,
  last_failure_at           timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- An automation can only be switched on once it is genuinely wired.
  constraint chk_comm_automation_enablement_requires_active
    check (is_operationally_enabled = false or readiness_status = 'active')
);

-- RLS & GRANTS (least privilege per table)
alter table public.communication_templates enable row level security;
revoke all on public.communication_templates from anon;
revoke all on public.communication_templates from authenticated;
grant select, insert, update on public.communication_templates to service_role;

-- No delete grant: a message row references template_key, and message history
-- must never be orphaned by removing a template.
alter table public.communication_messages enable row level security;
revoke all on public.communication_messages from anon;
revoke all on public.communication_messages from authenticated;
grant select, insert, update on public.communication_messages to service_role;

-- APPEND-ONLY. No update, no delete — for any role.
alter table public.communication_delivery_events enable row level security;
revoke all on public.communication_delivery_events from anon;
revoke all on public.communication_delivery_events from authenticated;
grant select, insert on public.communication_delivery_events to service_role;

-- Update is required to advance processing_status and bump duplicate_count.
-- Delete is not.
alter table public.communication_webhook_receipts enable row level security;
revoke all on public.communication_webhook_receipts from anon;
revoke all on public.communication_webhook_receipts from authenticated;
grant select, insert, update on public.communication_webhook_receipts to service_role;

alter table public.communication_automation_catalog enable row level security;
revoke all on public.communication_automation_catalog from anon;
revoke all on public.communication_automation_catalog from authenticated;
grant select, insert, update on public.communication_automation_catalog to service_role;

-- SEED DATA
-- Templates are 'mock_ready': they render against the mock provider. That is a
-- build state, not an operational one — no workflow sends them yet.
insert into public.communication_templates (template_key, channel, category, description, version, readiness_status)
values
  ('client_login_otp', 'whatsapp', 'authentication', 'OTP for client login verification', '1.0', 'mock_ready'),
  ('vendor_whatsapp_verify', 'whatsapp', 'authentication', 'OTP for vendor WhatsApp verification', '1.0', 'mock_ready'),
  ('vendor_password_reset', 'whatsapp', 'authentication', 'OTP for vendor password reset', '1.0', 'mock_ready'),
  ('lead_received', 'whatsapp', 'business', 'Lead received acknowledgement sent to homeowner', '1.0', 'mock_ready'),
  ('vendor_new_lead', 'whatsapp', 'business', 'New lead notification sent to matched vendors', '1.0', 'mock_ready'),
  ('clarification_request', 'whatsapp', 'business', 'Clarification request sent to homeowner', '1.0', 'mock_ready'),
  ('clarification_reminder', 'whatsapp', 'business', 'Clarification reminder sent to homeowner', '1.0', 'mock_ready'),
  ('lead_assignment_alert', 'whatsapp', 'business', 'Assignment alert sent to vendor', '1.0', 'mock_ready'),
  ('low_credit_warning', 'whatsapp', 'business', 'Low credit alert sent to vendor', '1.0', 'mock_ready'),
  ('recharge_reminder', 'whatsapp', 'business', 'Credit recharge reminder sent to vendor', '1.0', 'mock_ready'),
  ('client_nurture_followup', 'whatsapp', 'business', 'Nurture follow-up sent to homeowner', '1.0', 'mock_ready'),
  ('dormant_requirement_reactivation', 'whatsapp', 'business', 'Dormant requirement reactivation template', '1.0', 'mock_ready'),
  ('admin_policy_block_alert', 'whatsapp', 'business', 'Admin alert when a policy blocks a lead', '1.0', 'mock_ready'),
  ('admin_assignment_failure_alert', 'whatsapp', 'business', 'Admin alert when lead assignment fails', '1.0', 'mock_ready'),
  ('admin_provider_outage_alert', 'whatsapp', 'business', 'Admin alert when communication provider is down', '1.0', 'mock_ready'),
  ('admin_automation_failure_alert', 'whatsapp', 'business', 'Admin alert when policy automation fails', '1.0', 'mock_ready')
on conflict (template_key) do nothing;

-- Automation catalog: definitions exist and are VISIBLE, but Phase 5B wires none
-- of them. Every row seeds at readiness 'wiring_pending' and inherits
-- is_operationally_enabled = false, so nothing is presented as live.
-- provider_required = 'mock' records that only the mock adapter can serve them
-- today; a real adapter changes this to its own providerKey.
insert into public.communication_automation_catalog (automation_key, category, description, lane, channel, template_key, readiness_status, provider_required)
values
  ('client_login_otp', 'otp', 'Client login OTP routing', 'authentication', 'whatsapp', 'client_login_otp', 'wiring_pending', 'mock'),
  ('vendor_whatsapp_verify', 'otp', 'Vendor WhatsApp verify OTP routing', 'authentication', 'whatsapp', 'vendor_whatsapp_verify', 'wiring_pending', 'mock'),
  ('vendor_password_reset', 'otp', 'Vendor password reset OTP routing', 'authentication', 'whatsapp', 'vendor_password_reset', 'wiring_pending', 'mock'),
  ('lead_received', 'notification', 'Homeowner lead received acknowledgement', 'business', 'whatsapp', 'lead_received', 'wiring_pending', 'mock'),
  ('vendor_new_lead', 'notification', 'Vendor new lead match alert', 'business', 'whatsapp', 'vendor_new_lead', 'wiring_pending', 'mock'),
  ('clarification_request', 'notification', 'Homeowner details clarification request', 'business', 'whatsapp', 'clarification_request', 'wiring_pending', 'mock'),
  ('clarification_reminder', 'notification', 'Homeowner details clarification reminder', 'business', 'whatsapp', 'clarification_reminder', 'wiring_pending', 'mock'),
  ('lead_assignment_alert', 'notification', 'Vendor final lead assignment confirmation', 'business', 'whatsapp', 'lead_assignment_alert', 'wiring_pending', 'mock'),
  ('low_credit_warning', 'alert', 'Vendor credit wallet low-balance warning', 'business', 'whatsapp', 'low_credit_warning', 'wiring_pending', 'mock'),
  ('recharge_reminder', 'alert', 'Vendor credit recharge periodic reminder', 'business', 'whatsapp', 'recharge_reminder', 'wiring_pending', 'mock'),
  ('client_nurture_followup', 'system', 'Homeowner details nurture follow-up routing', 'business', 'whatsapp', 'client_nurture_followup', 'wiring_pending', 'mock'),
  ('dormant_requirement_reactivation', 'system', 'Homeowner dormant requirement query reactivation', 'business', 'whatsapp', 'dormant_requirement_reactivation', 'wiring_pending', 'mock'),
  ('admin_policy_block_alert', 'alert', 'Operational alert on policy-enforced lead blocks', 'business', 'whatsapp', 'admin_policy_block_alert', 'wiring_pending', 'mock'),
  ('admin_assignment_failure_alert', 'alert', 'Operational alert on match assignment failures', 'business', 'whatsapp', 'admin_assignment_failure_alert', 'wiring_pending', 'mock'),
  ('admin_provider_outage_alert', 'alert', 'Operational alert on WhatsApp channel outages', 'business', 'whatsapp', 'admin_provider_outage_alert', 'wiring_pending', 'mock'),
  ('admin_automation_failure_alert', 'alert', 'Operational alert on automated routing failures', 'business', 'whatsapp', 'admin_automation_failure_alert', 'wiring_pending', 'mock')
on conflict (automation_key) do nothing;

-- Deliberately NOT created (per security review):
--   • no anon/authenticated policy or grant on any Phase 5B table
--   • no update/delete grant on communication_delivery_events (append-only)
--   • no delete grant on communication_messages / webhook receipts / catalog
--   • no plaintext destination, OTP, token or provider-secret column anywhere
--   • no automation seeded as 'active' or operationally enabled
