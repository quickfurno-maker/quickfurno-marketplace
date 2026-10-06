#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import {
  IdentityProviderKind,
  IdentityAssuranceLevel,
} from "../../lib/identity/providerIdentity.ts";
import { resolveMappedPrincipal } from "../../lib/identity/identityDirectory.ts";

const { Pool } = pg;
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://qf_phase22:qf_phase22_ci_only@127.0.0.1:5432/qf_phase22_test",
  max: 8,
});
const migration = await readFile(
  resolve(
    "supabase/migrations/20261006113720_phase22_identity_portability.sql",
  ),
  "utf8",
);

const ids = {
  adminUser: "00000000-0000-0000-0000-000000000001",
  vendorUser: "00000000-0000-0000-0000-000000000002",
  clientUser: "00000000-0000-0000-0000-000000000003",
  vendor: "10000000-0000-0000-0000-000000000001",
  vendorMembership: "20000000-0000-0000-0000-000000000001",
  clientAccount: "30000000-0000-0000-0000-000000000001",
};

async function bootstrapFreshDatabase() {
  const existing = await pool.query(
    "select count(*)::int n from information_schema.tables where table_schema in ('public','auth') and table_name in ('profiles','users','identity_principals')",
  );
  assert.equal(
    existing.rows[0].n,
    0,
    "Phase22 certification requires a fresh disposable database",
  );

  await pool.query(`
    create schema if not exists auth;
    create extension if not exists pgcrypto;

    do $$
    begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    end $$;

    grant usage on schema public, auth to anon, authenticated, service_role;

    create table auth.users (
      id uuid primary key,
      raw_app_meta_data jsonb not null default '{}'::jsonb,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      last_sign_in_at timestamptz
    );

    create function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create table public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      full_name text,
      phone text,
      role text check (role in ('admin','vendor')),
      is_active boolean default true
    );
    create table public.vendors (
      id uuid primary key,
      user_id uuid,
      status text,
      business_name text not null default 'Test Vendor'
    );
    create table public.client_accounts (
      id uuid primary key,
      user_id uuid not null references auth.users(id) on delete cascade,
      phone_e164 text,
      whatsapp_verified_at timestamptz,
      status text not null default 'active'
    );
    create table public.vendor_dashboard_users (
      id uuid primary key,
      vendor_id uuid not null references public.vendors(id),
      user_id uuid references auth.users(id) on delete set null,
      role text,
      status text
    );

    create or replace function public.is_admin() returns boolean
    language sql stable security definer set search_path=public
    as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin') $$;

    alter table public.profiles enable row level security;
    alter table public.vendors enable row level security;
    alter table public.client_accounts enable row level security;
    alter table public.vendor_dashboard_users enable row level security;

    create policy "profiles self read" on public.profiles
      for select to authenticated using (id = auth.uid() or public.is_admin());
    create policy "vendors owner read" on public.vendors
      for select to authenticated using (user_id = auth.uid() or public.is_admin());
    create policy "client_accounts owner read" on public.client_accounts
      for select to authenticated using (user_id = auth.uid() or public.is_admin());
    create policy "vendor_dashboard_users self read" on public.vendor_dashboard_users
      for select to authenticated using (auth.uid() is not null and auth.uid() = user_id);

    create or replace function public.handle_new_user() returns trigger
    language plpgsql security definer set search_path=pg_catalog,public,pg_temp
    as $$
    declare
      v_principal text := new.raw_app_meta_data ->> 'qf_principal';
      v_role text;
    begin
      if v_principal='vendor' then v_role:='vendor'; else v_role:=null; end if;
      insert into public.profiles(id,full_name,phone,role)
      values(new.id,new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'phone',v_role)
      on conflict(id) do nothing;
      return new;
    end $$;
    create trigger on_auth_user_created after insert on auth.users
      for each row execute function public.handle_new_user();
  `);

  await pool.query(
    `insert into auth.users(id,raw_app_meta_data,raw_user_meta_data)
     values
       ($1,'{"admin_role":"Superadmin"}'::jsonb,'{"full_name":"Admin"}'::jsonb),
       ($2,'{"qf_principal":"vendor"}'::jsonb,'{"full_name":"Vendor"}'::jsonb),
       ($3,'{}'::jsonb,'{"full_name":"Client"}'::jsonb)`,
    [ids.adminUser, ids.vendorUser, ids.clientUser],
  );
  await pool.query("update public.profiles set role='admin' where id=$1", [
    ids.adminUser,
  ]);
  await pool.query(
    "insert into public.vendors(id,user_id,status) values($1,$2,'approved')",
    [ids.vendor, ids.vendorUser],
  );
  await pool.query(
    "insert into public.vendor_dashboard_users(id,vendor_id,user_id,role,status) values($1,$2,$3,'owner','active')",
    [ids.vendorMembership, ids.vendor, ids.vendorUser],
  );
  await pool.query(
    "insert into public.client_accounts(id,user_id,phone_e164,status,whatsapp_verified_at) values($1,$2,'+910000000000','active',now())",
    [ids.clientAccount, ids.clientUser],
  );
}

async function businessSnapshot() {
  const { rows } = await pool.query(`
    select jsonb_build_object(
      'profiles',(select jsonb_agg(to_jsonb(x) order by id) from public.profiles x),
      'vendors',(select jsonb_agg(to_jsonb(x) order by id) from public.vendors x),
      'client_accounts',(select jsonb_agg(to_jsonb(x) order by id) from public.client_accounts x),
      'vendor_dashboard_users',(select jsonb_agg(to_jsonb(x) order by id) from public.vendor_dashboard_users x)
    ) snapshot
  `);
  return rows[0].snapshot;
}

async function policySnapshot() {
  const { rows } = await pool.query(`
    select policyname,tablename,cmd,roles::text,coalesce(qual,'') qual,coalesce(with_check,'') with_check
    from pg_policies
    where schemaname='public'
      and policyname in (
        'profiles self read','vendors owner read',
        'client_accounts owner read','vendor_dashboard_users self read'
      )
    order by tablename,policyname
  `);
  return rows;
}

function sqlRepository() {
  return {
    async findProviderIdentity(providerKey, providerSubject) {
      const { rows } = await pool.query(
        "select principal_id,provider_key,provider_subject,status from public.identity_provider_identities where provider_key=$1 and provider_subject=$2",
        [providerKey, providerSubject],
      );
      if (rows.length !== 1) return null;
      return {
        principalId: rows[0].principal_id,
        providerKey: rows[0].provider_key,
        providerSubject: rows[0].provider_subject,
        status: rows[0].status,
      };
    },
    async findPrincipal(principalId) {
      const { rows } = await pool.query(
        "select id,principal_kind,status,identity_revision from public.identity_principals where id=$1",
        [principalId],
      );
      if (rows.length !== 1) return null;
      return {
        id: rows[0].id,
        principalKind: rows[0].principal_kind,
        status: rows[0].status,
        identityRevision: Number(rows[0].identity_revision),
      };
    },
    async listBusinessBindings(principalId, bindingType) {
      const params = [principalId];
      let sql =
        "select principal_id,binding_type,business_id,status from public.identity_business_bindings where principal_id=$1 and status='active'";
      if (bindingType) {
        params.push(bindingType);
        sql += " and binding_type=$2";
      }
      const { rows } = await pool.query(sql, params);
      return rows.map((row) => ({
        principalId: row.principal_id,
        bindingType: row.binding_type,
        businessId: row.business_id,
        status: row.status,
      }));
    },
  };
}

function testAdapter(providerKey, subject, extra = {}) {
  return {
    providerKey,
    providerKind: IdentityProviderKind.TEST,
    async authenticateCurrentRequest() {
      return {
        providerKey,
        providerKind: IdentityProviderKind.TEST,
        subject,
        sessionId: "test-session",
        assuranceLevel: IdentityAssuranceLevel.AAL1,
        authenticatedAt: "2026-10-06T00:00:00.000Z",
        expiresAt: "2026-10-06T01:00:00.000Z",
        ...extra,
      };
    },
  };
}

async function coreVendorAccess(principalId) {
  const { rows } = await pool.query(
    `select vdu.status
       from public.identity_business_bindings b
       join public.vendor_dashboard_users vdu on vdu.id=b.business_id
      where b.principal_id=$1
        and b.binding_type='vendor_dashboard_user'
        and b.status='active'`,
    [principalId],
  );
  return rows.length === 1 && rows[0].status === "active";
}

try {
  await bootstrapFreshDatabase();
  const businessBefore = await businessSnapshot();
  const policiesBefore = await policySnapshot();

  await pool.query(migration);

  const counts = await pool.query(`
    select
      (select count(*)::int from public.identity_principals) principals,
      (select count(*)::int from public.identity_provider_identities) providers,
      (select count(*)::int from public.identity_business_bindings) bindings,
      (select count(*)::int from public.identity_admin_roles) admin_roles
  `);
  assert.deepEqual(counts.rows[0], {
    principals: 3,
    providers: 3,
    bindings: 5,
    admin_roles: 1,
  });

  const vendorPrincipal = await pool.query(
    "select principal_id from public.identity_provider_identities where provider_key='supabase-primary' and provider_subject=$1",
    [ids.vendorUser],
  );
  const vendorPrincipalId = vendorPrincipal.rows[0].principal_id;

  await pool.query(
    `insert into public.identity_provider_identities
      (principal_id,provider_key,provider_kind,provider_subject,issuer,status)
      values($1,'test-oidc','test','vendor-external-subject','https://idp.phase22.test','active')`,
    [vendorPrincipalId],
  );

  const repository = sqlRepository();
  const alternate = await resolveMappedPrincipal(
    testAdapter("test-oidc", "vendor-external-subject", {
      role: "Superadmin",
      user_metadata: { role: "admin" },
      app_metadata: { admin_role: "Superadmin" },
    }),
    repository,
  );
  assert.equal(alternate.ok, true);
  assert.equal(alternate.context.principalId, vendorPrincipalId);
  assert.equal(await coreVendorAccess(vendorPrincipalId), true);

  const legacy = await resolveMappedPrincipal(
    {
      providerKey: "supabase-primary",
      providerKind: IdentityProviderKind.SUPABASE,
      async authenticateCurrentRequest() {
        return {
          providerKey: "supabase-primary",
          providerKind: IdentityProviderKind.SUPABASE,
          subject: ids.vendorUser,
          sessionId: "legacy-session",
          assuranceLevel: IdentityAssuranceLevel.UNKNOWN,
          authenticatedAt: null,
          expiresAt: null,
        };
      },
    },
    repository,
  );
  assert.equal(legacy.ok, true);
  assert.equal(legacy.context.principalId, alternate.context.principalId);

  await pool.query(
    "update public.vendor_dashboard_users set status='suspended' where id=$1",
    [ids.vendorMembership],
  );
  assert.equal(await coreVendorAccess(vendorPrincipalId), false);
  await pool.query(
    "update public.vendor_dashboard_users set status='active' where id=$1",
    [ids.vendorMembership],
  );

  await pool.query(
    "update public.identity_provider_identities set status='disabled' where provider_key='test-oidc'",
  );
  const providerDisabled = await resolveMappedPrincipal(
    testAdapter("test-oidc", "vendor-external-subject"),
    repository,
  );
  assert.deepEqual(providerDisabled, {
    ok: false,
    reason: "provider_identity_not_active",
  });
  await pool.query(
    "update public.identity_provider_identities set status='active' where provider_key='test-oidc'",
  );

  await pool.query(
    "update public.identity_principals set status='disabled' where id=$1",
    [vendorPrincipalId],
  );
  const principalDisabled = await resolveMappedPrincipal(
    testAdapter("test-oidc", "vendor-external-subject"),
    repository,
  );
  assert.deepEqual(principalDisabled, {
    ok: false,
    reason: "principal_not_active",
  });
  await pool.query(
    "update public.identity_principals set status='active' where id=$1",
    [vendorPrincipalId],
  );

  const admin = await pool.query(
    `select iar.admin_role
       from public.identity_admin_roles iar
       join public.identity_provider_identities pii on pii.principal_id=iar.principal_id
      where pii.provider_key='supabase-primary' and pii.provider_subject=$1`,
    [ids.adminUser],
  );
  assert.equal(admin.rows[0].admin_role, "Superadmin");

  const businessAfterFirst = await businessSnapshot();
  const policiesAfterFirst = await policySnapshot();
  assert.deepEqual(businessAfterFirst, businessBefore);
  assert.deepEqual(policiesAfterFirst, policiesBefore);

  await pool.query(migration);
  assert.deepEqual(await businessSnapshot(), businessBefore);
  assert.deepEqual(await policySnapshot(), policiesBefore);

  const secondCounts = await pool.query(`
    select
      (select count(*)::int from public.identity_principals) principals,
      (select count(*)::int from public.identity_provider_identities where provider_key='supabase-primary') supabase_links,
      (select count(*)::int from public.identity_business_bindings) bindings,
      (select count(*)::int from public.identity_admin_roles) admin_roles
  `);
  assert.deepEqual(secondCounts.rows[0], {
    principals: 3,
    supabase_links: 3,
    bindings: 5,
    admin_roles: 1,
  });

  const grants = await pool.query(`
    select grantee,privilege_type
    from information_schema.role_table_grants
    where table_schema='public'
      and table_name in (
        'identity_principals','identity_provider_identities',
        'identity_business_bindings','identity_admin_roles'
      )
      and grantee in ('anon','authenticated')
  `);
  assert.equal(grants.rows.length, 0);

  const fn = await pool.query(`
    select
      has_function_privilege('public','public.qf_sync_identity_business_binding()','EXECUTE') public_sync,
      has_function_privilege('anon','public.qf_sync_identity_business_binding()','EXECUTE') anon_sync,
      has_function_privilege('authenticated','public.qf_sync_identity_business_binding()','EXECUTE') authenticated_sync,
      has_function_privilege('public','public.handle_new_user()','EXECUTE') public_onboard
  `);
  assert.deepEqual(fn.rows[0], {
    public_sync: false,
    anon_sync: false,
    authenticated_sync: false,
    public_onboard: false,
  });

  console.log("QuickFurno Phase22 identity/auth PostgreSQL certification PASS");
  console.log(
    JSON.stringify(
      {
        alternateProviderMapsToSamePrincipal: true,
        providerClaimsGrantAuthorization: false,
        coreVendorSuspensionStillDenies: true,
        providerDisableFailsClosed: true,
        principalDisableFailsClosed: true,
        coreOwnedSuperadminMigrated: true,
        businessRowsChanged: false,
        authorizationPoliciesChanged: false,
        migrationRerunChangedBusinessState: false,
        legacyBusinessIdsRewritten: false,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
