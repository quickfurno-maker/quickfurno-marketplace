-- VOX-03 SOURCE-ONLY. NOT applied to Staging/Production until reviewed,
-- backed up, role-tested and independently certified. Existing Core profiles
-- are the sole principal IDs. Default inactive. No browser-privileged writes.
begin;

create table public.vox_staff_teams_v1 (
  id uuid primary key default gen_random_uuid(),
  team_name text not null check(length(btrim(team_name)) between 2 and 100),
  city_id uuid not null references public.cities(id),
  is_active boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index vox_staff_teams_v1_city_name_key
 on public.vox_staff_teams_v1(city_id, lower(btrim(team_name)));

create table public.vox_staff_memberships_v1 (
  auth_user_id uuid primary key references public.profiles(id) on delete restrict,
  team_id uuid not null references public.vox_staff_teams_v1(id),
  staff_role text not null check (staff_role in
    ('operations_manager','acquisition_agent','vendor_success_agent','support_agent','auditor')),
  is_active boolean not null default false,
  expires_at timestamptz not null,
  granted_by uuid not null references public.profiles(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint vox_staff_membership_nonempty_window check(expires_at > granted_at),
  constraint vox_staff_membership_revoked_closed check(revoked_at is null or is_active = false)
);
create index vox_staff_memberships_team_idx on public.vox_staff_memberships_v1(team_id) where is_active;

create table public.vox_staff_object_scopes_v1 (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references public.vox_staff_memberships_v1(auth_user_id) on delete restrict,
  scope_kind text not null check (scope_kind in ('prospect','vendor','support_thread','conversation')),
  object_id uuid not null,
  granted_by uuid not null references public.profiles(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  reason text not null check (length(btrim(reason)) between 8 and 500),
  constraint vox_staff_scope_window check(expires_at > granted_at)
);
create unique index vox_staff_object_scopes_active_idx
  on public.vox_staff_object_scopes_v1(auth_user_id,scope_kind,object_id)
  where revoked_at is null;
create index vox_staff_object_scopes_reader_idx
  on public.vox_staff_object_scopes_v1(auth_user_id,expires_at)
  where revoked_at is null;

-- Durable append-only audit. Never create an operational action endpoint before
-- Core approval + reason/actor correlation are implemented.
create table public.vox_staff_grant_audit_v1 (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid not null references public.profiles(id),
  target_staff_id uuid not null references public.profiles(id),
  operation text not null check(operation in ('TEAM_CREATE','STAFF_GRANT','STAFF_REVOKE','SCOPE_GRANT','SCOPE_REVOKE')),
  scope_kind text,
  object_id uuid,
  approval_reference text not null check(length(btrim(approval_reference)) between 8 and 128),
  request_id uuid not null unique
);
create index vox_staff_grant_audit_target_idx
 on public.vox_staff_grant_audit_v1(target_staff_id,occurred_at desc);

-- No RLS policy for anon/authenticated. Even authenticated staff must access
-- Core's service-only scoped endpoints; no direct table SELECT/INSERT.
alter table public.vox_staff_teams_v1 enable row level security;
alter table public.vox_staff_teams_v1 force row level security;
alter table public.vox_staff_memberships_v1 enable row level security;
alter table public.vox_staff_memberships_v1 force row level security;
alter table public.vox_staff_object_scopes_v1 enable row level security;
alter table public.vox_staff_object_scopes_v1 force row level security;
alter table public.vox_staff_grant_audit_v1 enable row level security;
alter table public.vox_staff_grant_audit_v1 force row level security;

revoke all on public.vox_staff_teams_v1 from public, anon, authenticated;
revoke all on public.vox_staff_memberships_v1 from public, anon, authenticated;
revoke all on public.vox_staff_object_scopes_v1 from public, anon, authenticated;
revoke all on public.vox_staff_grant_audit_v1 from public, anon, authenticated;
grant select, insert, update on public.vox_staff_teams_v1 to service_role;
grant select, insert, update on public.vox_staff_memberships_v1 to service_role;
grant select, insert, update on public.vox_staff_object_scopes_v1 to service_role;
grant select, insert on public.vox_staff_grant_audit_v1 to service_role;
-- Audit is append-only by permissions; grant rows have no delete grant.
-- No API to provision users included in this migration.
commit;
