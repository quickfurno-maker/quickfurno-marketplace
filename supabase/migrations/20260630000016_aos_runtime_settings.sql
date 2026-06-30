-- ============================================================================
-- QuickFurno - Phase 12: Admin-Controlled AOS / n8n Activation Switch
-- Migration suggestion only. Safe to run on the live DB (idempotent).
--
-- Purpose:
-- - Runtime setting (Lock 2) that lets a Superadmin enable/disable AOS -> n8n
--   event forwarding from the admin dashboard WITHOUT editing .env.local.
-- - Server env flags (Lock 1) remain the hard gate. Both locks must be ON
--   before any event is forwarded to the n8n Master Preview Router.
-- - No WhatsApp, no vendor notification, no credit deduction, no auto
--   assignment, and NO Supabase writes from n8n are introduced here.
--
-- Safety:
-- - Uses IF NOT EXISTS for the table.
-- - Uses a safe upsert (ON CONFLICT DO NOTHING) for the default row so an
--   existing admin-chosen value is never overwritten on re-run.
-- - Admin-only RLS. No anon/public policies.
-- - Default row is OFF / mode 'off'.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- AOS RUNTIME SETTINGS
-- ----------------------------------------------------------------------------
create table if not exists public.aos_runtime_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text unique not null,
  enabled boolean not null default false,
  mode text not null default 'off' check (mode in ('off', 'preview', 'production_locked')),
  description text,
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.aos_runtime_settings is
  'Admin-only AOS runtime switches (Lock 2). RLS enabled. Controls whether QuickFurno forwards AOS events to n8n preview routers. No secrets are stored here.';

-- Defensive: ensure columns exist if an earlier partial table is present.
alter table if exists public.aos_runtime_settings add column if not exists enabled boolean not null default false;
alter table if exists public.aos_runtime_settings add column if not exists mode text not null default 'off';
alter table if exists public.aos_runtime_settings add column if not exists description text;
alter table if exists public.aos_runtime_settings add column if not exists updated_by text;
alter table if exists public.aos_runtime_settings add column if not exists updated_at timestamptz not null default now();
alter table if exists public.aos_runtime_settings add column if not exists created_at timestamptz not null default now();

create index if not exists idx_aos_runtime_settings_setting_key on public.aos_runtime_settings(setting_key);
create index if not exists idx_aos_runtime_settings_updated_at on public.aos_runtime_settings(updated_at desc);

-- ----------------------------------------------------------------------------
-- RLS: admin-only. No anon/public policies are created.
-- ----------------------------------------------------------------------------
alter table public.aos_runtime_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'aos_runtime_settings'
      and policyname = 'aos_runtime_settings admin all'
  ) then
    execute 'create policy "aos_runtime_settings admin all" on public.aos_runtime_settings for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- SEED: default master-router switch. OFF by default.
-- Safe upsert: DO NOTHING preserves any existing admin-chosen value on re-run.
-- ----------------------------------------------------------------------------
insert into public.aos_runtime_settings (setting_key, enabled, mode, description)
values (
  'aos_n8n_master_router',
  false,
  'off',
  'Controls QuickFurno AOS event forwarding to n8n Master Preview Router.'
)
on conflict (setting_key) do nothing;
