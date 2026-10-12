-- AN-A2b: separately consented, revocable ANISHA derived-preference memory.
-- REVIEW-ONLY: DO NOT APPLY BEFORE MANAGED STAGING MIGRATION APPROVAL.
-- No actual personal memory, PII, message text or financial facts stored here.
begin;

create table if not exists public.vendor_anisha_memory_consents (
  vendor_id uuid primary key references public.vendors(id) on delete cascade,
  purpose text not null default 'anisha_derived_preferences_v1'
    check (purpose = 'anisha_derived_preferences_v1'),
  policy_version integer not null default 1 check (policy_version = 1),
  decision text not null default 'DENIED' check (decision in ('GRANTED','DENIED')),
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  erase_required boolean not null default false,
  check (decision = 'DENIED' or (revoked_at is null and not erase_required))
);

create table if not exists public.vendor_anisha_memory_purge_outbox (
  purge_id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  reason text not null check (reason in ('consent_revoked','vendor_erasure')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0)
);
create unique index if not exists vendor_anisha_memory_purge_pending_vendor_idx
 on public.vendor_anisha_memory_purge_outbox (vendor_id)
 where completed_at is null;

alter table public.vendor_anisha_memory_consents enable row level security;
alter table public.vendor_anisha_memory_purge_outbox enable row level security;
revoke all on public.vendor_anisha_memory_consents from public, anon, authenticated;
revoke all on public.vendor_anisha_memory_purge_outbox from public, anon, authenticated;
grant select, insert, update on public.vendor_anisha_memory_consents to service_role;
grant select, insert, update on public.vendor_anisha_memory_purge_outbox to service_role;

-- Core-only atomic state transition. Grant never crosses a pending erase.
-- Revocation is immediate for reads and creates an eventual physical deletion task.
create or replace function public.qf_set_vendor_anisha_memory_consent_v1(
  p_vendor_id uuid, p_grant boolean
) returns table(decision text, revision bigint, erase_required boolean)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare current_row public.vendor_anisha_memory_consents%rowtype;
begin
  perform 1 from public.vendors where id=p_vendor_id for update;
  if not found then raise exception 'vendor_memory_consent_invalid_vendor'; end if;
  select * into current_row from public.vendor_anisha_memory_consents
    where vendor_id=p_vendor_id for update;
  if p_grant and coalesce(current_row.erase_required, false) then
    raise exception 'vendor_memory_erasure_pending';
  end if;
  insert into public.vendor_anisha_memory_consents as c
    (vendor_id, decision, revision, revoked_at, erase_required)
  values (p_vendor_id, case when p_grant then 'GRANTED' else 'DENIED' end,
    1, case when p_grant then null else now() end, not p_grant)
  on conflict (vendor_id) do update set
    decision=excluded.decision,
    revision=c.revision+1,
    updated_at=now(),
    revoked_at=excluded.revoked_at,
    erase_required=case when p_grant then c.erase_required else true end;
  if not p_grant then
    insert into public.vendor_anisha_memory_purge_outbox(vendor_id, reason)
      values (p_vendor_id,'consent_revoked')
      on conflict do nothing;
  end if;
  return query select c.decision, c.revision, c.erase_required
    from public.vendor_anisha_memory_consents c where c.vendor_id=p_vendor_id;
end; $$;

revoke all on function public.qf_set_vendor_anisha_memory_consent_v1(uuid,boolean)
 from public, anon, authenticated;
grant execute on function public.qf_set_vendor_anisha_memory_consent_v1(uuid,boolean) to service_role;
commit;
