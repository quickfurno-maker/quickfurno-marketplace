-- ============================================================================
-- QuickFurno — 20260706000141_vendor_credit_wallet_rpc.sql
-- Phase 4 (credit-wallet): ONE canonical credit-mutation primitive + idempotency.
--
-- ADDITIVE. GENERATED FOR REVIEW — DO NOT AUTO-APPLY.
--
-- WHY: today admin grants / package top-ups mutate vendors.remaining_credits from
-- several places (services/vendorAdminService.ts) with no idempotency reference.
-- This adds reference columns to the ledger and a single positive-delta primitive
-- (grants / package purchases / invalid-lead refunds) that is idempotent on
-- (reference_type, reference_id). The lead-assignment DEBIT stays inside the
-- assignment RPC (atomic with the assignment) — see 20260706000142.
-- ============================================================================

-- 1) Idempotency/reference columns on the audit ledger. All NULL historically, so
--    the partial unique index below starts empty and cannot fail on existing data.
alter table if exists public.vendor_credit_logs
  add column if not exists reference_type text,
  add column if not exists reference_id   text;

-- NOTE (review): audit for existing (reference_type, reference_id) duplicates is
-- unnecessary here because both columns are newly added and entirely NULL; the
-- partial index only constrains rows where reference_id is not null.
create unique index if not exists uq_vendor_credit_logs_reference
  on public.vendor_credit_logs(reference_type, reference_id)
  where reference_id is not null;

-- 2) Canonical positive-delta credit primitive. Idempotent on the reference.
create or replace function public.qf_apply_vendor_credit_delta(
  p_vendor_id uuid,
  p_delta int,
  p_change_type text,
  p_reason text,
  p_reference_type text default null,
  p_reference_id text default null,
  p_updated_by text default 'system'
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
  -- Idempotency: a prior ledger row with the same reference means this grant /
  -- purchase / refund was already applied — return unchanged (no double credit).
  if p_reference_id is not null and p_reference_type is not null then
    if exists (
      select 1 from public.vendor_credit_logs
      where reference_type = p_reference_type and reference_id = p_reference_id
    ) then
      select coalesce(remaining_credits, 0) into v_after from public.vendors where id = p_vendor_id;
      return jsonb_build_object('status', 'already_applied', 'vendor_id', p_vendor_id, 'credits_after', v_after, 'delta', 0);
    end if;
  end if;

  select coalesce(remaining_credits, 0) into v_before
  from public.vendors
  where id = p_vendor_id
  for update;
  if not found then
    raise exception 'VENDOR_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_after := greatest(0, v_before + p_delta);

  update public.vendors
  set remaining_credits = v_after,
      total_credits = greatest(coalesce(total_credits, 0), v_after)
  where id = p_vendor_id;

  insert into public.vendor_credit_logs (
    vendor_id, change_type, credits_before, credits_delta, credits_after,
    reason, updated_by, reference_type, reference_id
  ) values (
    p_vendor_id, p_change_type, v_before, v_after - v_before, v_after,
    p_reason, p_updated_by, p_reference_type, p_reference_id
  );

  return jsonb_build_object(
    'status', 'applied', 'vendor_id', p_vendor_id,
    'credits_before', v_before, 'credits_after', v_after, 'delta', v_after - v_before
  );
end;
$$;

revoke all on function public.qf_apply_vendor_credit_delta(uuid, int, text, text, text, text, text) from public;
revoke all on function public.qf_apply_vendor_credit_delta(uuid, int, text, text, text, text, text) from anon;
revoke all on function public.qf_apply_vendor_credit_delta(uuid, int, text, text, text, text, text) from authenticated;
grant execute on function public.qf_apply_vendor_credit_delta(uuid, int, text, text, text, text, text) to service_role;

-- Reverse (review only):
--   drop function if exists public.qf_apply_vendor_credit_delta(uuid,int,text,text,text,text,text);
--   drop index if exists public.uq_vendor_credit_logs_reference;
--   alter table public.vendor_credit_logs drop column if exists reference_type, drop column if exists reference_id;
