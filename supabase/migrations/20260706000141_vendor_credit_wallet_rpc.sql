-- ============================================================================
-- QuickFurno — 20260706000141_vendor_credit_wallet_rpc.sql
-- Phase 4 (credit-wallet): canonical credit primitive + ledger reference +
-- change_type CONSTRAINT ALIGNMENT. Prerequisite for 20260706000142.
--
-- ADDITIVE. GENERATED FOR REVIEW — DO NOT AUTO-APPLY.
--
-- FIXES from the live preflight:
--   • Aligns vendor_credit_logs_change_type_check to the Phase 4 canonical types
--     (+ preserves ALL legacy types) so the assignment ledger insert cannot violate
--     the CHECK. The old constraint only allowed manual_*/package_credit/
--     preview_test/correction.
--   • Hardens qf_apply_vendor_credit_delta: lock the vendor row FIRST, then the
--     idempotency check (so same-vendor duplicates serialize and resolve to
--     already_applied — no uncontrolled unique-index error); NO silent clamp on an
--     invalid negative mutation (raises INSUFFICIENT_CREDITS unless p_allow_negative);
--     total_credits = CUMULATIVE credits ever granted (increments on POSITIVE delta
--     only; never an eligibility field).
-- ============================================================================

-- 1) Ledger idempotency/reference columns. All NULL historically → the partial
--    unique index starts empty and cannot fail on existing production rows.
--    Uniqueness is GLOBAL on (reference_type, reference_id): every canonical
--    reference id (assignment id, order id, grant/refund id) is a globally-unique
--    entity id, so vendor_id is intentionally NOT part of the key.
alter table if exists public.vendor_credit_logs
  add column if not exists reference_type text,
  add column if not exists reference_id   text;

create unique index if not exists uq_vendor_credit_logs_reference
  on public.vendor_credit_logs(reference_type, reference_id)
  where reference_id is not null;

-- 2) change_type CHECK alignment. Discover-and-drop by definition (do NOT assume
--    the auto-generated constraint name), then add the canonical union.
do $$
declare r record;
begin
  if to_regclass('public.vendor_credit_logs') is null then
    return;
  end if;
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.vendor_credit_logs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%change_type%'
  loop
    execute format('alter table public.vendor_credit_logs drop constraint %I', r.conname);
  end loop;

  alter table public.vendor_credit_logs
    add constraint vendor_credit_logs_change_type_check
    check (change_type in (
      -- Phase 4 canonical transaction types
      'package_purchase', 'admin_credit_grant', 'lead_assignment_debit', 'invalid_lead_refund', 'manual_adjustment',
      -- legacy types preserved for backward compatibility / history
      'manual_add', 'manual_set', 'manual_remove', 'package_credit', 'preview_test', 'correction'
    ));
end $$;

-- 3) Canonical credit primitive. Positive deltas: grants / purchases / refunds.
--    The lead-assignment DEBIT stays atomic inside the assignment RPC (00142).
--    Manual negative adjustments must pass p_allow_negative := true explicitly.
create or replace function public.qf_apply_vendor_credit_delta(
  p_vendor_id uuid,
  p_delta int,
  p_change_type text,
  p_reason text,
  p_reference_type text default null,
  p_reference_id text default null,
  p_updated_by text default 'system',
  p_allow_negative boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_before int;
  v_after int;
begin
  -- Lock the vendor row FIRST so concurrent same-vendor calls serialize here.
  select coalesce(remaining_credits, 0) into v_before
  from public.vendors
  where id = p_vendor_id
  for update;
  if not found then
    raise exception 'VENDOR_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Idempotency AFTER the lock: a duplicate reference resolves to already_applied
  -- (exactly one mutation for concurrent duplicate invocations).
  if p_reference_id is not null and p_reference_type is not null then
    if exists (
      select 1 from public.vendor_credit_logs
      where reference_type = p_reference_type and reference_id = p_reference_id
    ) then
      return jsonb_build_object('status', 'already_applied', 'vendor_id', p_vendor_id, 'credits_before', v_before, 'credits_after', v_before, 'delta', 0);
    end if;
  end if;

  v_after := v_before + p_delta;

  -- NEVER silently clamp: an insufficient negative mutation fails unless the caller
  -- explicitly opts into a policy-approved adjustment.
  if v_after < 0 and not p_allow_negative then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;

  update public.vendors
  set remaining_credits = v_after,
      -- total_credits = CUMULATIVE credits ever granted (positive deltas only).
      total_credits = coalesce(total_credits, 0) + greatest(p_delta, 0)
  where id = p_vendor_id;

  insert into public.vendor_credit_logs (
    vendor_id, change_type, credits_before, credits_delta, credits_after,
    reason, updated_by, reference_type, reference_id
  ) values (
    p_vendor_id, p_change_type, v_before, v_after - v_before, v_after,
    p_reason, p_updated_by, p_reference_type, p_reference_id
  );

  return jsonb_build_object('status', 'applied', 'vendor_id', p_vendor_id, 'credits_before', v_before, 'credits_after', v_after, 'delta', v_after - v_before);
end;
$$;

revoke all on function public.qf_apply_vendor_credit_delta(uuid, int, text, text, text, text, text, boolean) from public;
revoke all on function public.qf_apply_vendor_credit_delta(uuid, int, text, text, text, text, text, boolean) from anon;
revoke all on function public.qf_apply_vendor_credit_delta(uuid, int, text, text, text, text, text, boolean) from authenticated;
grant execute on function public.qf_apply_vendor_credit_delta(uuid, int, text, text, text, text, text, boolean) to service_role;

-- Reverse (review only):
--   drop function if exists public.qf_apply_vendor_credit_delta(uuid,int,text,text,text,text,text,boolean);
--   drop index if exists public.uq_vendor_credit_logs_reference;
--   alter table public.vendor_credit_logs drop column if exists reference_type, drop column if exists reference_id;
--   (the change_type constraint change is a superset; reverting is optional and not destructive.)
