-- ============================================================================
-- QuickFurno — 20260711000100_whatsapp_inbound_message_foundation.sql
-- Phase 5F-D1-A — WhatsApp Inbound Data Foundation (ADDITIVE, FOUNDATION-ONLY)
--
-- Creates public.communication_inbound_messages: a durable, privacy-preserving
-- record of VERIFIED inbound provider messages. It is SEPARATE from the outbound-
-- only public.communication_messages, whose invariants (a required unique
-- idempotency_key, a template_key FK, a send-status lifecycle, a masked/hashed
-- DESTINATION) cannot represent an inbound user message cleanly. Overloading that
-- table would force nullable core invariants and corrupt a clean outbound authority.
--
-- FOUNDATION ONLY. Nothing writes this table yet: Phase 5F-D1-B wires it only AFTER
-- this migration is reviewed and applied and the live schema is verified read-only.
-- This migration:
--   • changes NO existing table (purely additive: one CREATE TABLE + indexes + RLS);
--   • stores NO plaintext sender phone (sender_hash only; no phone_e164 / wa_id /
--     MSISDN column exists by design);
--   • touches NO consent (communication_preferences / communication_suppressions);
--   • emits into NO event tables (domain_events / outbox_events);
--   • adds NO trigger — nothing here sends, replies, mutates consent, or calls n8n;
--   • activates NO provider and enables NO webhook processing.
-- ============================================================================

create table if not exists public.communication_inbound_messages (
  id                        uuid primary key default gen_random_uuid(),
  provider                  text not null,
  -- The provider's OWN per-message id (e.g. a Meta `wamid`). This is the durable
  -- per-message idempotency fence — it is NEVER derived from a phone, text body, or
  -- timestamp. The unique index below guarantees one row per (provider, message id)
  -- even across redelivered or overlapping webhook envelopes.
  provider_message_id       text not null,
  -- Best-effort link to the verified webhook receipt. ON DELETE SET NULL: a receipt
  -- is monitoring/idempotency metadata; inbound business history must OUTLIVE it and
  -- must never be cascade-deleted by removing a receipt.
  webhook_receipt_id        uuid references public.communication_webhook_receipts(id) on delete set null,
  -- sha256 of the canonical E.164 sender (lowercase hex). The plaintext sender phone
  -- is NEVER stored. There is deliberately no phone_e164 / wa_id / MSISDN column.
  sender_hash               text not null check (sender_hash ~ '^[0-9a-f]{64}$'),
  -- Optional masked form for admin display only (e.g. +91******3210). Never full.
  sender_masked             text,
  -- FAIL-SAFE identity. Ambiguous/unknown senders NEVER fabricate a principal, and a
  -- principal id is polymorphic (client_accounts.id / vendors.id) like
  -- communication_messages.recipient_id — no cross-table FK.
  resolved_principal_type   text
                              check (resolved_principal_type is null or resolved_principal_type in ('client', 'vendor', 'admin')),
  resolved_principal_id     uuid,
  identity_confidence       text not null default 'unknown'
                              check (identity_confidence in ('exact', 'ambiguous', 'unknown')),
  message_type              text not null
                              check (message_type in (
                                'text', 'button_reply', 'list_reply', 'image', 'document',
                                'audio', 'video', 'location', 'contact', 'reaction', 'unsupported')),
  -- MINIMIZED normalized content ONLY. NEVER the raw provider payload, an access
  -- token, an authorization header, a credentialled URL, or an arbitrary provider
  -- error object. Location/contact payloads are stored CONSERVATIVELY (a presence
  -- marker only) — no coordinates and no contact cards in this phase.
  content_minimized         jsonb not null default '{}'::jsonb,
  provider_occurred_at      timestamptz,
  received_at               timestamptz not null default now(),
  processing_status         text not null default 'captured'
                              check (processing_status in (
                                'captured', 'normalized', 'identity_resolved',
                                'identity_ambiguous', 'identity_unknown', 'failed')),
  failure_reason_sanitized  text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- COMPLETE identity invariant, enforced at the schema level so a service bug can NEVER
  -- persist a contradictory identity state (not merely "no principal unless exact", but the
  -- full state machine):
  --   • EXACT      ⟺ resolved_principal_type IS NOT NULL AND resolved_principal_id IS NOT NULL;
  --   • AMBIGUOUS  ⟹ both NULL;
  --   • UNKNOWN    ⟹ both NULL.
  -- Forbidden by construction: exact+null-type, exact+null-id, exact+both-null,
  -- ambiguous/unknown+any-principal-field, and any PARTIALLY-populated principal pair (one
  -- field set with the other NULL) — such a row matches neither branch.
  constraint chk_comm_inbound_identity_confidence_principal
    check (
      (identity_confidence = 'exact'
         and resolved_principal_type is not null
         and resolved_principal_id is not null)
      or (identity_confidence in ('ambiguous', 'unknown')
         and resolved_principal_type is null
         and resolved_principal_id is null)
    )
);

-- DURABLE PER-MESSAGE IDEMPOTENCY. The same provider message id can never create two
-- inbound rows — webhook-payload de-duplication alone is insufficient because a single
-- webhook may carry many messages and a provider may redeliver overlapping batches.
create unique index if not exists uq_comm_inbound_provider_message
  on public.communication_inbound_messages (provider, provider_message_id);

create index if not exists idx_comm_inbound_sender_hash
  on public.communication_inbound_messages (sender_hash, provider);
create index if not exists idx_comm_inbound_principal
  on public.communication_inbound_messages (resolved_principal_type, resolved_principal_id)
  where resolved_principal_id is not null;
create index if not exists idx_comm_inbound_received
  on public.communication_inbound_messages (received_at desc);
create index if not exists idx_comm_inbound_processing
  on public.communication_inbound_messages (processing_status);

-- RLS & GRANTS — least privilege, SERVICE-ROLE ONLY, no browser policies. Matches the
-- Phase 5F-A communication-core convention: RLS on; revoke all from anon, authenticated
-- and service_role; then grant only SELECT/INSERT/UPDATE to service_role. NO DELETE and
-- NO TRUNCATE: inbound history is append + lifecycle-update only.
alter table public.communication_inbound_messages enable row level security;
revoke all on public.communication_inbound_messages from anon;
revoke all on public.communication_inbound_messages from authenticated;
revoke all on public.communication_inbound_messages from service_role;
grant select, insert, update on public.communication_inbound_messages to service_role;
