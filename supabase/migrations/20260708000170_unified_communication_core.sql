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
-- RLS model:
--   • Enable RLS and revoke all public/authenticated permissions on all communication tables.
--   • Grant read/write access to service_role only.
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
create table if not exists public.communication_messages (
  id                        uuid primary key default gen_random_uuid(),
  message_type              text not null,
  lane                      text not null check (lane in ('authentication', 'business')),
  channel                   text not null check (channel = 'whatsapp'),
  recipient_type            text not null check (recipient_type in ('client', 'vendor', 'admin', 'integration', 'system')),
  recipient_id              uuid,
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
  provider                  text not null default 'mock',
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

-- 3) COMMUNICATION DELIVERY EVENTS
create table if not exists public.communication_delivery_events (
  id                        uuid primary key default gen_random_uuid(),
  communication_message_id  uuid not null references public.communication_messages(id) on delete cascade,
  provider                  text not null,
  provider_event_id         text,
  normalized_event_type     text not null check (normalized_event_type in ('accepted', 'sent', 'delivered', 'read', 'failed')),
  provider_message_id       text not null,
  occurred_at               timestamptz not null default now(),
  sanitized_metadata        jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now()
);

create unique index if not exists idx_comm_delivery_event_provider_event
  on public.communication_delivery_events(provider, provider_event_id);
create index if not exists idx_comm_delivery_event_message_id
  on public.communication_delivery_events(communication_message_id);

-- 4) WEBHOOK RECEIPTS
create table if not exists public.communication_webhook_receipts (
  id                        uuid primary key default gen_random_uuid(),
  provider                  text not null,
  provider_event_id         text,
  payload_hash              text not null,
  signature_valid           boolean not null,
  normalized_event_type     text check (normalized_event_type in ('accepted', 'sent', 'delivered', 'read', 'failed')),
  processing_status         text not null default 'received'
                              check (processing_status in ('received', 'verified', 'processed', 'duplicate', 'rejected', 'failed')),
  received_at               timestamptz not null default now(),
  processed_at              timestamptz,
  failure_reason_sanitized  text,
  created_at                timestamptz not null default now()
);

create unique index if not exists idx_comm_webhook_receipt_provider_event
  on public.communication_webhook_receipts(provider, provider_event_id);
create unique index if not exists idx_comm_webhook_receipt_payload_hash
  on public.communication_webhook_receipts(payload_hash);

-- 5) AUTOMATION CATALOG
create table if not exists public.communication_automation_catalog (
  automation_key            text primary key,
  category                  text not null check (category in ('otp', 'notification', 'alert', 'marketing', 'system')),
  description               text,
  lane                      text not null check (lane in ('authentication', 'business')),
  channel                   text not null check (channel = 'whatsapp'),
  operational_status        text not null default 'enabled' check (operational_status in ('enabled', 'disabled')),
  provider_required         text not null default 'mock',
  template_key              text references public.communication_templates(template_key),
  is_operationally_enabled  boolean not null default true,
  last_triggered_at         timestamptz,
  last_success_at           timestamptz,
  last_failure_at           timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- RLS & GRANTS
alter table public.communication_templates enable row level security;
revoke all on public.communication_templates from anon;
revoke all on public.communication_templates from authenticated;
grant select, insert, update, delete on public.communication_templates to service_role;

alter table public.communication_messages enable row level security;
revoke all on public.communication_messages from anon;
revoke all on public.communication_messages from authenticated;
grant select, insert, update, delete on public.communication_messages to service_role;

alter table public.communication_delivery_events enable row level security;
revoke all on public.communication_delivery_events from anon;
revoke all on public.communication_delivery_events from authenticated;
grant select, insert, update, delete on public.communication_delivery_events to service_role;

alter table public.communication_webhook_receipts enable row level security;
revoke all on public.communication_webhook_receipts from anon;
revoke all on public.communication_webhook_receipts from authenticated;
grant select, insert, update, delete on public.communication_webhook_receipts to service_role;

alter table public.communication_automation_catalog enable row level security;
revoke all on public.communication_automation_catalog from anon;
revoke all on public.communication_automation_catalog from authenticated;
grant select, insert, update, delete on public.communication_automation_catalog to service_role;

-- SEED DATA
-- Seed templates
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

-- Seed automation catalog
insert into public.communication_automation_catalog (automation_key, category, description, lane, channel, template_key)
values
  ('client_login_otp', 'otp', 'Client login OTP routing', 'authentication', 'whatsapp', 'client_login_otp'),
  ('vendor_whatsapp_verify', 'otp', 'Vendor WhatsApp verify OTP routing', 'authentication', 'whatsapp', 'vendor_whatsapp_verify'),
  ('vendor_password_reset', 'otp', 'Vendor password reset OTP routing', 'authentication', 'whatsapp', 'vendor_password_reset'),
  ('lead_received', 'notification', 'Homeowner lead received acknowledgement', 'business', 'whatsapp', 'lead_received'),
  ('vendor_new_lead', 'notification', 'Vendor new lead match alert', 'business', 'whatsapp', 'vendor_new_lead'),
  ('clarification_request', 'notification', 'Homeowner details clarification request', 'business', 'whatsapp', 'clarification_request'),
  ('clarification_reminder', 'notification', 'Homeowner details clarification reminder', 'business', 'whatsapp', 'clarification_reminder'),
  ('lead_assignment_alert', 'notification', 'Vendor final lead assignment confirmation', 'business', 'whatsapp', 'lead_assignment_alert'),
  ('low_credit_warning', 'alert', 'Vendor credit wallet low-balance warning', 'business', 'whatsapp', 'low_credit_warning'),
  ('recharge_reminder', 'alert', 'Vendor credit recharge periodic reminder', 'business', 'whatsapp', 'recharge_reminder'),
  ('client_nurture_followup', 'system', 'Homeowner details nurture follow-up routing', 'business', 'whatsapp', 'client_nurture_followup'),
  ('dormant_requirement_reactivation', 'system', 'Homeowner dormant requirement query reactivation', 'business', 'whatsapp', 'dormant_requirement_reactivation'),
  ('admin_policy_block_alert', 'alert', 'Operational alert on policy-enforced lead blocks', 'business', 'whatsapp', 'admin_policy_block_alert'),
  ('admin_assignment_failure_alert', 'alert', 'Operational alert on match assignment failures', 'business', 'whatsapp', 'admin_assignment_failure_alert'),
  ('admin_provider_outage_alert', 'alert', 'Operational alert on WhatsApp channel outages', 'business', 'whatsapp', 'admin_provider_outage_alert'),
  ('admin_automation_failure_alert', 'alert', 'Operational alert on automated routing failures', 'business', 'whatsapp', 'admin_automation_failure_alert')
on conflict (automation_key) do nothing;
