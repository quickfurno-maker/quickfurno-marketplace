-- ============================================================================
-- QuickFurno — Phase 22 Identity & Auth Provider Independence
--
-- Additive compatibility layer only. Existing marketplace records, auth.users
-- foreign keys, RLS policies, and authorization rules are intentionally preserved.
-- A stable internal principal can be linked to one or more authentication
-- providers and to existing Core business records without rewriting those records.
--
-- This migration is designed to be safe to re-run and to coexist with Supabase
-- Auth during the migration window. It does NOT migrate passwords, sessions, MFA
-- factors, or provider secrets.
-- ============================================================================

begin;

create table if not exists public.identity_principals (
  id                  uuid primary key default gen_random_uuid(),
  principal_kind      text not null default 'human'
                        check (principal_kind in ('human', 'integration', 'system')),
  status              text not null default 'active'
                        check (status in ('active', 'disabled', 'retired')),
  identity_revision   bigint not null default 1 check (identity_revision > 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.identity_provider_identities (
  id                    uuid primary key default gen_random_uuid(),
  principal_id          uuid not null references public.identity_principals(id) on delete restrict,
  provider_key          text not null
                          check (provider_key ~ '^[a-z0-9][a-z0-9._:-]{1,79}$'),
  provider_kind         text not null
                          check (provider_kind in ('supabase', 'oidc', 'saml', 'test')),
  provider_subject      text not null
                          check (length(provider_subject) between 1 and 512),
  issuer                text,
  status                text not null default 'active'
                          check (status in ('active', 'disabled', 'unlinked')),
  linked_at             timestamptz not null default now(),
  last_authenticated_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (provider_key, provider_subject)
);

create index if not exists idx_identity_provider_principal
  on public.identity_provider_identities(principal_id, status);

create table if not exists public.identity_business_bindings (
  id            uuid primary key default gen_random_uuid(),
  principal_id  uuid not null references public.identity_principals(id) on delete restrict,
  binding_type  text not null
                  check (binding_type in ('profile', 'client_account', 'vendor_dashboard_user')),
  business_id   uuid not null,
  status        text not null default 'active'
                  check (status in ('active', 'revoked')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (principal_id, binding_type, business_id)
);

create index if not exists idx_identity_business_lookup
  on public.identity_business_bindings(binding_type, business_id, status);
create index if not exists idx_identity_business_principal
  on public.identity_business_bindings(principal_id, binding_type, status);

create unique index if not exists uq_identity_business_active_binding
  on public.identity_business_bindings(binding_type, business_id)
  where status = 'active';

-- Core-owned authorization detail for privileged admin principals. This is
-- deliberately separate from provider claims/app_metadata.
create table if not exists public.identity_admin_roles (
  principal_id  uuid primary key references public.identity_principals(id) on delete restrict,
  admin_role    text not null
                  check (admin_role in (
                    'Superadmin',
                    'Sales Admin',
                    'Support Admin',
                    'Finance Admin',
                    'Content Admin',
                    'Operations Admin'
                  )),
  status        text not null default 'active'
                  check (status in ('active', 'revoked')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Server-only directory. Provider claims are authentication evidence only;
-- authorization continues to come from existing Core business tables/policies.
alter table public.identity_principals enable row level security;
alter table public.identity_provider_identities enable row level security;
alter table public.identity_business_bindings enable row level security;
alter table public.identity_admin_roles enable row level security;

revoke all on public.identity_principals from public, anon, authenticated;
revoke all on public.identity_provider_identities from public, anon, authenticated;
revoke all on public.identity_business_bindings from public, anon, authenticated;
revoke all on public.identity_admin_roles from public, anon, authenticated;

grant select, insert, update on public.identity_principals to service_role;
grant select, insert, update on public.identity_provider_identities to service_role;
grant select, insert, update on public.identity_business_bindings to service_role;
grant select, insert, update on public.identity_admin_roles to service_role;

-- Backfill every current Supabase Auth user to a fresh stable principal without
-- updating any existing business row.
with missing as materialized (
  select
    u.id as auth_user_id,
    gen_random_uuid() as principal_id
  from auth.users u
  left join public.identity_provider_identities pii
    on pii.provider_key = 'supabase-primary'
   and pii.provider_subject = u.id::text
  where pii.id is null
),
inserted_principals as (
  insert into public.identity_principals (id, principal_kind, status)
  select principal_id, 'human', 'active'
  from missing
  returning id
)
insert into public.identity_provider_identities (
  principal_id,
  provider_key,
  provider_kind,
  provider_subject,
  status
)
select
  m.principal_id,
  'supabase-primary',
  'supabase',
  m.auth_user_id::text,
  'active'
from missing m
join inserted_principals ip on ip.id = m.principal_id
on conflict (provider_key, provider_subject) do nothing;

-- Provider-neutral bindings point to existing Core records. They carry no role,
-- package, credit, verification, or other authorization state.
insert into public.identity_business_bindings (principal_id, binding_type, business_id, status)
select pii.principal_id, 'profile', p.id, 'active'
from public.identity_provider_identities pii
join public.profiles p on p.id::text = pii.provider_subject
where pii.provider_key = 'supabase-primary'
on conflict (principal_id, binding_type, business_id) do nothing;

insert into public.identity_business_bindings (principal_id, binding_type, business_id, status)
select pii.principal_id, 'client_account', ca.id, 'active'
from public.identity_provider_identities pii
join public.client_accounts ca on ca.user_id::text = pii.provider_subject
where pii.provider_key = 'supabase-primary'
on conflict (principal_id, binding_type, business_id) do nothing;

insert into public.identity_business_bindings (principal_id, binding_type, business_id, status)
select pii.principal_id, 'vendor_dashboard_user', vdu.id, 'active'
from public.identity_provider_identities pii
join public.vendor_dashboard_users vdu on vdu.user_id::text = pii.provider_subject
where pii.provider_key = 'supabase-primary'
on conflict (principal_id, binding_type, business_id) do nothing;

-- One-time migration of the existing trusted server-set admin scope into Core.
-- raw_user_meta_data is intentionally never consulted.
insert into public.identity_admin_roles (principal_id, admin_role, status)
select
  pii.principal_id,
  u.raw_app_meta_data ->> 'admin_role',
  'active'
from public.identity_provider_identities pii
join auth.users u on u.id::text = pii.provider_subject
join public.profiles p on p.id = u.id and p.role = 'admin'
where pii.provider_key = 'supabase-primary'
  and (u.raw_app_meta_data ->> 'admin_role') in (
    'Superadmin',
    'Sales Admin',
    'Support Admin',
    'Finance Admin',
    'Content Admin',
    'Operations Admin'
  )
on conflict (principal_id) do nothing;

-- Keep future legacy business rows synchronized with stable principal bindings.
-- Existing authorization fields remain authoritative and are never copied here.
create or replace function public.qf_sync_identity_business_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_binding_type text;
  v_business_id uuid;
  v_new_user_id uuid;
  v_old_user_id uuid;
  v_principal_id uuid;
begin
  if tg_table_name = 'profiles' then
    v_binding_type := 'profile';
    v_business_id := coalesce(new.id, old.id);
    v_new_user_id := case when tg_op = 'DELETE' then null else new.id end;
    v_old_user_id := case when tg_op in ('UPDATE','DELETE') then old.id else null end;
  elsif tg_table_name = 'client_accounts' then
    v_binding_type := 'client_account';
    v_business_id := coalesce(new.id, old.id);
    v_new_user_id := case when tg_op = 'DELETE' then null else new.user_id end;
    v_old_user_id := case when tg_op in ('UPDATE','DELETE') then old.user_id else null end;
  elsif tg_table_name = 'vendor_dashboard_users' then
    v_binding_type := 'vendor_dashboard_user';
    v_business_id := coalesce(new.id, old.id);
    v_new_user_id := case when tg_op = 'DELETE' then null else new.user_id end;
    v_old_user_id := case when tg_op in ('UPDATE','DELETE') then old.user_id else null end;
  else
    raise exception 'unsupported identity binding table %', tg_table_name;
  end if;

  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and v_old_user_id is distinct from v_new_user_id) then
    update public.identity_business_bindings
       set status = 'revoked', updated_at = now()
     where binding_type = v_binding_type
       and business_id = v_business_id
       and status = 'active';
  end if;

  if v_new_user_id is not null then
    select pii.principal_id
      into v_principal_id
      from public.identity_provider_identities pii
     where pii.provider_key = 'supabase-primary'
       and pii.provider_subject = v_new_user_id::text
       and pii.status = 'active';

    if v_principal_id is not null then
      insert into public.identity_business_bindings (
        principal_id, binding_type, business_id, status
      )
      values (v_principal_id, v_binding_type, v_business_id, 'active')
      on conflict (principal_id, binding_type, business_id)
      do update set status = 'active', updated_at = now();
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function public.qf_sync_identity_business_binding() from public, anon, authenticated;
grant execute on function public.qf_sync_identity_business_binding() to service_role;

drop trigger if exists qf_identity_profile_binding on public.profiles;
create trigger qf_identity_profile_binding
after insert or update or delete on public.profiles
for each row execute function public.qf_sync_identity_business_binding();

drop trigger if exists qf_identity_client_binding on public.client_accounts;
create trigger qf_identity_client_binding
after insert or update or delete on public.client_accounts
for each row execute function public.qf_sync_identity_business_binding();

drop trigger if exists qf_identity_vendor_binding on public.vendor_dashboard_users;
create trigger qf_identity_vendor_binding
after insert or update or delete on public.vendor_dashboard_users
for each row execute function public.qf_sync_identity_business_binding();

-- Extend the existing onboarding trigger function so every new Supabase user gets
-- a stable internal principal. Profile classification semantics are preserved.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_principal text := new.raw_app_meta_data ->> 'qf_principal';
  v_role text;
  v_internal_principal_id uuid;
begin
  if v_principal = 'vendor' then
    v_role := 'vendor';
  else
    v_role := null;
  end if;

  select pii.principal_id
    into v_internal_principal_id
    from public.identity_provider_identities pii
   where pii.provider_key = 'supabase-primary'
     and pii.provider_subject = new.id::text;

  if v_internal_principal_id is null then
    insert into public.identity_principals (principal_kind, status)
    values ('human', 'active')
    returning id into v_internal_principal_id;

    insert into public.identity_provider_identities (
      principal_id,
      provider_key,
      provider_kind,
      provider_subject,
      status
    )
    values (
      v_internal_principal_id,
      'supabase-primary',
      'supabase',
      new.id::text,
      'active'
    );
  end if;

  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone',
    v_role
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

-- Existing public helper is trigger-only / server-maintained. Never expose it as
-- an authenticated API primitive.
revoke all on function public.handle_new_user() from public, anon, authenticated;

commit;
