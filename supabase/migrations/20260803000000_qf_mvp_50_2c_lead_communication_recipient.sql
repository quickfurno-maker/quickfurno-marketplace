-- ============================================================================
-- QF-MVP-50.2C — LEAD COMMUNICATION RECIPIENT REFERENCE
--
-- PURPOSE
--   Widen the durable communication recipient vocabulary so a business message may
--   reference `public.leads.id`. Roadmap-50.2 client actions are lead-scoped, and
--   Core resolves the destination from the lead row at dispatch.
--
-- WHAT `lead` MEANS
--   A communication recipient REFERENCE, nothing more. It is deliberately NOT a
--   consent principal: `CONSENT_PRINCIPAL_TYPES` in the outbound consent authority
--   stays ('client','vendor','admin'), so a lead-referenced send derives an UNKNOWN
--   consent identity. That is the safe branch — destination-hash suppression still
--   applies in full and marketing still default-denies for an unknown identity.
--
-- WHAT `lead` DOES NOT MEAN
--   Not an authenticated client principal. Not proof that a phone belongs to an
--   account holder. Not a client_account. No ownership is created or implied:
--   `public.leads` still carries no client_account_id / user_id / created_by, and
--   this migration does not add one.
--
-- AUTHORITY
--   Core remains sole database and business authority. n8n holds no Supabase
--   credential and never writes this table.
--
-- SCOPE
--   Forward-only. No historical migration is edited. No data is written: no
--   backfill, no phone normalisation, no seed row. Automation persistence, the
--   50.1C transport replay ledger and every provider mapping are untouched.
--
--   `public.whatsapp_logs.recipient_type` is a legacy log table that the unified
--   communication core does not write, so it is deliberately left unchanged.
-- ============================================================================

begin;

do $$
declare
  v_constraint text;
begin
  if to_regclass('public.communication_messages') is null then
    raise exception 'QF_MVP_50_2C_COMMUNICATION_MESSAGES_MISSING';
  end if;

  -- The original constraint was declared inline, so its name is server-generated.
  -- Resolve it from the catalogue rather than assuming a literal name.
  select con.conname
    into v_constraint
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public'
     and rel.relname = 'communication_messages'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%recipient_type%'
   limit 1;

  if v_constraint is not null then
    execute format(
      'alter table public.communication_messages drop constraint %I',
      v_constraint
    );
  end if;

  -- Every previously accepted value is preserved; only 'lead' is added.
  alter table public.communication_messages
    add constraint communication_messages_recipient_type_check
    check (recipient_type in ('client', 'vendor', 'admin', 'lead', 'integration', 'system'));
end
$$;

comment on column public.communication_messages.recipient_type is
  'Communication recipient reference kind. QF-MVP-50.2C adds ''lead'' (points at public.leads.id) '
  'so Core can resolve a lead-scoped business destination at dispatch. A lead is NOT a consent '
  'principal and NOT an authenticated client: its consent identity resolves to unknown, which keeps '
  'destination-hash suppression in force and leaves marketing default-denied.';

commit;
