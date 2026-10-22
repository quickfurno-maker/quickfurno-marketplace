-- PAY-3A Finance Staff granular read grants: source-only candidate, NOT installed.
-- Requires real Core staff MFA, active finance department and vendor object scope.
-- No additional login system; immutable grants + append-only revocations.
begin;
create table public.finance_staff_read_grants (
 id uuid primary key default gen_random_uuid(),
 staff_user_id uuid not null,
 team_id uuid not null,
 city_id uuid not null,
 vendor_id uuid not null references public.vendors(id) on delete restrict,
 requested_by uuid not null,
 approved_by uuid not null,
 approval_reference uuid not null unique,
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 check(requested_by<>approved_by and requested_by<>staff_user_id and approved_by<>staff_user_id),
 check(expires_at>created_at)
);
create index ix_finance_staff_read_scope on public.finance_staff_read_grants(staff_user_id,vendor_id,expires_at);
create table public.finance_staff_read_revocations (
 id uuid primary key default gen_random_uuid(),
 grant_id uuid not null unique references public.finance_staff_read_grants(id) on delete restrict,
 revoked_by uuid not null,
 reason_code text not null check(reason_code ~ '^[A-Z_]{3,64}$'),
 revoked_at timestamptz not null default now()
);
do $$
declare t text;
begin
 foreach t in array array['finance_staff_read_grants','finance_staff_read_revocations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated',t);
  execute format('grant select on table public.%I to service_role',t);
  execute format('create trigger trg_finance_v2_no_history_change
   before update or delete on public.%I for each row execute function public.qf_finance_v2_reject_history_mutation()',t);
 end loop;
end $$;
-- Grant issuance remains HUMAN bootstrap process, not auto-created by VOX.
commit;
