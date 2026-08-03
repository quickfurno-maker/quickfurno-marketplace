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
-- PRIOR CONTRACT (proven from committed history, never edited)
--   `20260708000170_unified_communication_core.sql` created
--   public.communication_messages with:
--     recipient_type text not null
--       check (recipient_type in ('client','vendor','admin','integration','system'))
--   The constraint was declared inline, so its name is server-generated.
--
-- FAIL-CLOSED CONSTRAINT DISCOVERY (QF-MVP-50.2C-R1)
--   The old constraint is identified STRUCTURALLY from the catalogue — by relation
--   OID plus the exact single-column `conkey` for `recipient_type` — not by matching
--   text inside pg_get_constraintdef, and never with LIMIT 1.
--
--   Exactly one such CHECK must exist. Zero means the expected constraint is absent
--   or shaped differently, and silently continuing could leave an incompatible CHECK
--   in place that still rejects 'lead'. More than one means an arbitrary pick could
--   drop the wrong one and leave another incompatible CHECK active. Both states
--   abort the transaction with a deterministic sanitized code, so nothing partially
--   persists and the drop can only happen after the exact-one proof.
--
-- AUTHORITY
--   Core remains sole database and business authority. n8n holds no Supabase
--   credential and never writes this table.
--
-- SCOPE
--   Forward-only. No historical migration is edited. No data is written: no
--   backfill, no phone normalisation, no seed. Automation persistence, the 50.1C
--   transport replay ledger and every provider mapping are untouched.
--
--   `public.whatsapp_logs.recipient_type` is a legacy log table that the unified
--   communication core does not write, so it is deliberately left unchanged.
-- ============================================================================

begin;

do $$
declare
  v_relid            oid;
  v_recipient_attnum smallint;
  v_attnum_count     integer;
  v_constraint_count integer;
  v_residual_count   integer;
  v_constraint       text;
begin
  -- Catalogue reads are schema-qualified throughout so the proof cannot be swayed by
  -- the caller's search_path.

  -- 1) The exact relation.
  v_relid := to_regclass('public.communication_messages');
  if v_relid is null then
    raise exception 'QF_MVP_50_2C_COMMUNICATION_MESSAGES_MISSING'
      using errcode = 'P0001';
  end if;

  -- 2) Take the lock the ALTER will need anyway, BEFORE proving anything. Otherwise the
  --    exact-one proof would be advisory: concurrent DDL between the proof and the swap
  --    could invalidate it.
  execute format('lock table %s in access exclusive mode', v_relid::regclass);

  -- 3) The recipient_type column, resolved structurally and required to exist once.
  select count(*), min(att.attnum)
    into v_attnum_count, v_recipient_attnum
    from pg_catalog.pg_attribute att
   where att.attrelid = v_relid
     and att.attname = 'recipient_type'
     and att.attnum > 0
     and not att.attisdropped;

  if v_attnum_count <> 1 or v_recipient_attnum is null then
    raise exception 'QF_MVP_50_2C_RECIPIENT_TYPE_COLUMN_MISSING'
      using errcode = 'P0001';
  end if;

  -- 4) CHECK constraints whose key columns are EXACTLY [recipient_type]. This is a
  --    catalogue relationship, not a text match, so a reworded or reformatted
  --    expression cannot hide the constraint and an unrelated multi-column CHECK
  --    that merely mentions the column cannot be mistaken for it.
  select count(*)
    into v_constraint_count
    from pg_catalog.pg_constraint con
   where con.conrelid = v_relid
     and con.contype = 'c'
     and con.conkey = array[v_recipient_attnum]::smallint[];

  if v_constraint_count = 0 then
    raise exception 'QF_MVP_50_2C_RECIPIENT_TYPE_CONSTRAINT_MISSING'
      using errcode = 'P0001';
  end if;

  if v_constraint_count > 1 then
    raise exception 'QF_MVP_50_2C_RECIPIENT_TYPE_CONSTRAINT_AMBIGUOUS'
      using errcode = 'P0001';
  end if;

  -- 5) Only now, with exactly one match proven, capture and drop it. INTO STRICT so the
  --    fetch itself raises rather than silently taking a first row — the name is never
  --    chosen arbitrarily.
  select con.conname
    into strict v_constraint
    from pg_catalog.pg_constraint con
   where con.conrelid = v_relid
     and con.contype = 'c'
     and con.conkey = array[v_recipient_attnum]::smallint[];

  execute format(
    'alter table public.communication_messages drop constraint %I',
    v_constraint
  );

  -- 6) Every previously accepted value is preserved; only 'lead' is added. The new
  --    CHECK is validated against existing rows on creation, so any row outside the
  --    six-value vocabulary aborts the transaction here.
  alter table public.communication_messages
    add constraint communication_messages_recipient_type_check
    check (recipient_type in ('client', 'vendor', 'admin', 'lead', 'integration', 'system'));

  -- 7) POST-CONDITION. Step 4 matched only single-column CHECKs, so a MULTI-column CHECK
  --    that also gates recipient_type would have survived untouched — and could still
  --    reject 'lead' while this migration reported success. Prove, structurally via
  --    conkey overlap, that the constraint just added is now the ONLY CHECK constraining
  --    this column. Anything else aborts the whole transaction.
  select count(*)
    into v_residual_count
    from pg_catalog.pg_constraint con
   where con.conrelid = v_relid
     and con.contype = 'c'
     and con.conkey && array[v_recipient_attnum]::smallint[];

  if v_residual_count <> 1 then
    raise exception 'QF_MVP_50_2C_RECIPIENT_TYPE_RESIDUAL_CONSTRAINT'
      using errcode = 'P0001';
  end if;
end
$$;

comment on column public.communication_messages.recipient_type is
  'Communication recipient reference kind. QF-MVP-50.2C adds ''lead'' (points at public.leads.id) '
  'so Core can resolve a lead-scoped business destination at dispatch. A lead is NOT a consent '
  'principal and NOT an authenticated client: its consent identity resolves to unknown, which keeps '
  'destination-hash suppression in force and leaves marketing default-denied.';

commit;
