-- QuickFurno Client Journey V2 — Phase 1 lead capture + qualification foundation.
-- Additive only. Existing assignment, credit, matching and communication
-- authorities remain untouched.

alter table public.leads
  add column if not exists journey_state text not null default 'captured',
  add column if not exists completeness_status text not null default 'incomplete',
  add column if not exists completeness_percent smallint not null default 0,
  add column if not exists completeness_missing_fields text[] not null default '{}',
  add column if not exists enrichment_missing_fields text[] not null default '{}',
  add column if not exists match_readiness_status text not null default 'not_ready',
  add column if not exists reachability_status text not null default 'unverified',
  add column if not exists fraud_status text not null default 'unchecked',
  add column if not exists qualification_field_states jsonb not null default '{}'::jsonb,
  add column if not exists qualification_checked_at timestamptz;

alter table public.leads
  drop constraint if exists leads_completeness_percent_check;
alter table public.leads
  add constraint leads_completeness_percent_check
  check (completeness_percent between 0 and 100);
alter table public.leads
  drop constraint if exists leads_journey_state_check;
alter table public.leads
  add constraint leads_journey_state_check
  check (journey_state in (
    'captured',
    'duplicate',
    'enrichment_required',
    'awaiting_client',
    'ready_for_qualification',
    'match_ready',
    'matching',
    'partially_matched',
    'matched',
    'waiting_for_supply',
    'nurture',
    'manual_review',
    'cancelled',
    'closed'
  ));

alter table public.leads
  drop constraint if exists leads_completeness_status_check;
alter table public.leads
  add constraint leads_completeness_status_check
  check (completeness_status in (
    'incomplete',
    'enrichment_required',
    'complete'
  ));

alter table public.leads
  drop constraint if exists leads_match_readiness_status_check;
alter table public.leads
  add constraint leads_match_readiness_status_check
  check (match_readiness_status in (
    'not_ready',
    'needs_enrichment',
    'ready',
    'ready_partial',
    'blocked'
  ));

alter table public.leads
  drop constraint if exists leads_reachability_status_check;
alter table public.leads
  add constraint leads_reachability_status_check
  check (reachability_status in (
    'unverified',
    'reachable',
    'unreachable',
    'unknown'
  ));

alter table public.leads
  drop constraint if exists leads_fraud_status_check;
alter table public.leads
  add constraint leads_fraud_status_check
  check (fraud_status in (
    'unchecked',
    'clear',
    'suspicious',
    'blocked'
  ));

create index if not exists idx_leads_journey_state
  on public.leads(journey_state);
create index if not exists idx_leads_completeness_status
  on public.leads(completeness_status);
create index if not exists idx_leads_match_readiness_status
  on public.leads(match_readiness_status);
create index if not exists idx_leads_reachability_status
  on public.leads(reachability_status);

-- Once a client enters the deterministic qualification flow, bind the exact
-- clarification request to the governed conversation. Plain-text replies can
-- then resolve that request without phone-number guessing.
alter table public.lead_clarification_requests
  add column if not exists destination_hash text null,
  add column if not exists conversation_id uuid null
    references public.communication_conversations(id) on delete set null,
  add column if not exists interaction_started_at timestamptz null,
  add column if not exists initial_communication_message_id uuid null
    references public.communication_messages(id) on delete set null,
  add column if not exists reminder_communication_message_id uuid null
    references public.communication_messages(id) on delete set null,
  add column if not exists reminder_sent_at timestamptz null;

alter table public.lead_clarification_requests
  drop constraint if exists lead_clarification_requests_destination_hash_check;
alter table public.lead_clarification_requests
  add constraint lead_clarification_requests_destination_hash_check
  check (destination_hash is null or destination_hash ~ '^[0-9a-f]{64}$');

create index if not exists idx_lead_clarification_requests_conversation
  on public.lead_clarification_requests(conversation_id)
  where conversation_id is not null;

create index if not exists idx_lead_clarification_requests_active_destination
  on public.lead_clarification_requests(destination_hash, created_at desc)
  where destination_hash is not null
    and status in ('preview_prepared', 'preview_sent');

-- A WhatsApp reply is derived from an already durable inbound message. Binding
-- the response to that row gives Phase 1 an exact retry/redelivery fence without
-- storing raw provider payloads or inventing another message identity.
alter table public.lead_clarification_responses
  add column if not exists inbound_message_id uuid null
    references public.communication_inbound_messages(id) on delete set null,
  add column if not exists response_source text not null default 'admin',
  add column if not exists applied_at timestamptz null;

create unique index if not exists uq_lead_clarification_response_inbound
  on public.lead_clarification_responses(inbound_message_id)
  where inbound_message_id is not null;

alter table public.lead_clarification_responses
  drop constraint if exists lead_clarification_response_source_check;
alter table public.lead_clarification_responses
  add constraint lead_clarification_response_source_check
  check (response_source in ('admin', 'whatsapp', 'riya'));

comment on column public.lead_clarification_requests.destination_hash is
  'SHA-256 of the canonical WhatsApp E.164 destination. Used only to bind the first inbound reply to one unambiguous active enrichment request without storing new plaintext PII.';
comment on column public.lead_clarification_responses.inbound_message_id is
  'Exact durable inbound WhatsApp message that supplied this answer; unique for replay safety.';
comment on column public.lead_clarification_responses.response_source is
  'Answer origin. Phase 1 uses admin or whatsapp; riya is reserved for Phase 2 Core-validated proposals.';

comment on column public.leads.journey_state is
  'Client Journey V2 lifecycle state; orthogonal to legacy lead status.';
comment on column public.leads.completeness_status is
  'Independent data completeness state. Missing information is not quality.';
comment on column public.leads.match_readiness_status is
  'Core authorization state for MatchCore eligibility; completeness alone never sets ready.';
comment on column public.leads.reachability_status is
  'Contact reachability evidence. A format-valid number starts unverified.';
comment on column public.leads.fraud_status is
  'Fraud/junk assessment, separate from commercial lead quality.';
comment on column public.leads.qualification_field_states is
  'Per-field qualification semantics: missing, unknown, undecided or confirmed.';
