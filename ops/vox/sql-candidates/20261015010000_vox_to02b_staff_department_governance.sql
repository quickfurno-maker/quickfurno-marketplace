-- VOX TO-02B — additive department grant storage. NON-DEPLOYABLE CANDIDATE ONLY.
-- Intentionally outside supabase/migrations: certified migration manifest rejects unreviewed history.
-- HOLD: do not execute on managed Staging/Production before historical
-- reconciliation, isolated PG17 replay, independent DBA/security approval.
-- The existing single staff_role and reviewed Core activation remain intact.
begin;

create table public.vox_staff_department_requests_v1 (
 id uuid primary key default gen_random_uuid(),
 request_nonce uuid not null unique,
 requested_by uuid not null references public.profiles(id) on delete restrict,
 target_staff_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 department text not null check (department in
  ('client_success','vendor_success','acquisition','service_support')),
 expires_at timestamptz not null,
 reason text not null check(length(btrim(reason)) between 12 and 500),
 state text not null default 'PENDING' check(state in ('PENDING','APPROVED','REJECTED')),
 revision integer not null default 0 check(revision between 0 and 1),
 decided_by uuid references public.profiles(id) on delete restrict,
 decided_at timestamptz,
 decision_reference text check(length(btrim(decision_reference)) between 8 and 128),
 created_at timestamptz not null default now(),
 constraint vox_department_request_window check(expires_at>created_at),
 constraint vox_department_request_decision_state check(
  (state='PENDING' and revision=0 and decided_by is null and decided_at is null
     and decision_reference is null)
  or
  (state in ('APPROVED','REJECTED') and revision=1 and decided_by is not null
     and decided_at is not null and decision_reference is not null)
 ),
 constraint vox_department_request_not_self check(requested_by<>target_staff_id)
);
create index vox_staff_department_pending_v1
 on public.vox_staff_department_requests_v1(state,created_at);
create index vox_staff_department_target_v1
 on public.vox_staff_department_requests_v1(target_staff_id,created_at desc);

create table public.vox_staff_department_decisions_v1 (
 request_id uuid primary key references public.vox_staff_department_requests_v1(id) on delete restrict,
 reviewer_id uuid not null references public.profiles(id) on delete restrict,
 decision text not null check(decision in ('APPROVED','REJECTED')),
 decision_reference text not null check(length(btrim(decision_reference)) between 8 and 128),
 reviewed_at timestamptz not null default now()
);
create table public.vox_staff_department_capabilities_v1 (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique references public.vox_staff_department_requests_v1(id) on delete restrict,
 auth_user_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 department text not null check(department in
  ('client_success','vendor_success','acquisition','service_support')),
 granted_by uuid not null references public.profiles(id) on delete restrict,
 granted_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 revision integer not null default 2 check(revision between 2 and 3),
 constraint vox_department_grant_window check(expires_at>granted_at),
 constraint vox_department_grant_revoked_revision check(
  (revoked_at is null and revision=2) or
  (revoked_at is not null and revision=3 and revoked_at>=granted_at)
 )
);
-- One unrevoked grant for a person/team/department. Expired grants still
-- require explicit Core revocation before issuance of a replacement.
create unique index vox_staff_department_one_live_v1
 on public.vox_staff_department_capabilities_v1(auth_user_id,team_id,department)
 where revoked_at is null;
create index vox_staff_department_reader_v1
 on public.vox_staff_department_capabilities_v1(auth_user_id,expires_at)
 where revoked_at is null;

create table public.vox_staff_department_activations_v1 (
 request_id uuid primary key references public.vox_staff_department_requests_v1(id) on delete restrict,
 capability_id uuid not null unique references public.vox_staff_department_capabilities_v1(id) on delete restrict,
 activated_by uuid not null references public.profiles(id) on delete restrict,
 activated_at timestamptz not null default now(),
 activation_reference text not null check(length(btrim(activation_reference)) between 8 and 128)
);
create table public.vox_staff_department_events_v1 (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.vox_staff_department_requests_v1(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 target_staff_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
 event_kind text not null check(event_kind in
  ('REQUESTED','REVIEW_APPROVED','REVIEW_REJECTED','ACTIVATED','REVOKED')),
 event_reference text not null check(length(btrim(event_reference)) between 8 and 128),
 occurred_at timestamptz not null default now(),
 event_nonce uuid not null unique
);
create index vox_department_events_staff_idx
 on public.vox_staff_department_events_v1(target_staff_id,occurred_at desc);

-- SQL cannot confer a new authority to an existing staff membership.
-- All records are still subject to current Core AAL2, city/team, object grant,
-- expiry/revocation, and Core-owned independent request/review/activation.
-- A future separately reviewed Core RPC must bind exact request+decision+grant.
-- Never infer effective staff rights from this table alone.
alter table public.vox_staff_department_requests_v1 enable row level security;
alter table public.vox_staff_department_requests_v1 force row level security;
alter table public.vox_staff_department_decisions_v1 enable row level security;
alter table public.vox_staff_department_decisions_v1 force row level security;
alter table public.vox_staff_department_capabilities_v1 enable row level security;
alter table public.vox_staff_department_capabilities_v1 force row level security;
alter table public.vox_staff_department_activations_v1 enable row level security;
alter table public.vox_staff_department_activations_v1 force row level security;
alter table public.vox_staff_department_events_v1 enable row level security;
alter table public.vox_staff_department_events_v1 force row level security;

revoke all on public.vox_staff_department_requests_v1 from public,anon,authenticated;
revoke all on public.vox_staff_department_decisions_v1 from public,anon,authenticated;
revoke all on public.vox_staff_department_capabilities_v1 from public,anon,authenticated;
revoke all on public.vox_staff_department_activations_v1 from public,anon,authenticated;
revoke all on public.vox_staff_department_events_v1 from public,anon,authenticated;

grant select,insert,update on public.vox_staff_department_requests_v1 to service_role;
grant select,insert on public.vox_staff_department_decisions_v1 to service_role;
grant select,insert,update on public.vox_staff_department_capabilities_v1 to service_role;
grant select,insert on public.vox_staff_department_activations_v1 to service_role;
grant select,insert on public.vox_staff_department_events_v1 to service_role;
-- Intentionally NO DELETE and NO direct anon/authenticated table privileges.
commit;
