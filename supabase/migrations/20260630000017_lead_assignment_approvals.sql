-- ============================================================================
-- QuickFurno - Phase 13: Lead Assignment Approval Workflow (Preview Only)
-- Migration suggestion only. Safe to run on the live DB (idempotent).
--
-- Purpose:
-- - Stores Superadmin "preview/draft" lead -> vendor assignment approvals.
-- - This table is a PREVIEW record only. It does NOT assign leads, does NOT
--   notify vendors, does NOT send WhatsApp, and does NOT deduct credits.
-- - The real assignment path (public.assign_lead_to_vendors / lead_assignments)
--   is untouched. Nothing here writes to those tables.
--
-- Two-lock safety (unchanged, see Phase 12):
-- - Lock 1 (server env): N8N_ENABLED && N8N_OUTBOUND_WEBHOOK_ENABLED.
-- - Lock 2 (runtime):    aos_runtime_settings 'aos_n8n_master_router'
--                        enabled=true && mode='preview'.
-- - An approval record always saves safely. The lead.assignment_approved AOS
--   event is only forwarded to n8n when BOTH locks are ON.
--
-- Safety:
-- - Uses IF NOT EXISTS for the table. No drop/delete/truncate. Non-destructive.
-- - Hard DB guard: selected_vendor_count <= 3 (CHECK constraint).
-- - Admin-only RLS. No anon/public policies.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- LEAD ASSIGNMENT APPROVALS (preview / draft records)
-- ----------------------------------------------------------------------------
create table if not exists public.lead_assignment_approvals (
  id                    uuid primary key default gen_random_uuid(),
  -- lead_id is stored as text so preview/mock lead ids are also accepted; real
  -- leads are uuids. No FK is added so a preview can never block on lead state.
  lead_id               text not null,
  selected_vendor_ids   jsonb not null default '[]'::jsonb,
  selected_vendor_count int not null default 0 check (selected_vendor_count <= 3),
  status                text not null default 'preview_approved'
                          check (status in ('draft', 'preview_approved', 'preview_sent_to_aos', 'cancelled')),
  mode                  text not null default 'preview'
                          check (mode in ('preview')),
  approval_note         text,
  approved_by           text,
  aos_event_emitted     boolean not null default false,
  n8n_webhook_called    boolean not null default false,
  side_effects          jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.lead_assignment_approvals is
  'Phase 13: Superadmin preview/draft lead->vendor assignment approvals. PREVIEW ONLY. Never assigns leads, notifies vendors, sends WhatsApp, or deducts credits. Max 3 vendors enforced by CHECK.';

-- Defensive: ensure columns exist if an earlier partial table is present.
alter table if exists public.lead_assignment_approvals add column if not exists selected_vendor_ids jsonb not null default '[]'::jsonb;
alter table if exists public.lead_assignment_approvals add column if not exists selected_vendor_count int not null default 0;
alter table if exists public.lead_assignment_approvals add column if not exists status text not null default 'preview_approved';
alter table if exists public.lead_assignment_approvals add column if not exists mode text not null default 'preview';
alter table if exists public.lead_assignment_approvals add column if not exists approval_note text;
alter table if exists public.lead_assignment_approvals add column if not exists approved_by text;
alter table if exists public.lead_assignment_approvals add column if not exists aos_event_emitted boolean not null default false;
alter table if exists public.lead_assignment_approvals add column if not exists n8n_webhook_called boolean not null default false;
alter table if exists public.lead_assignment_approvals add column if not exists side_effects jsonb not null default '{}'::jsonb;
alter table if exists public.lead_assignment_approvals add column if not exists created_at timestamptz not null default now();
alter table if exists public.lead_assignment_approvals add column if not exists updated_at timestamptz not null default now();

-- Defensive: add the max-3 guard if an older table was created without it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lead_assignment_approvals_max_three_vendors'
      and conrelid = 'public.lead_assignment_approvals'::regclass
  ) then
    alter table public.lead_assignment_approvals
      add constraint lead_assignment_approvals_max_three_vendors
      check (selected_vendor_count <= 3);
  end if;
end $$;

create index if not exists idx_lead_assignment_approvals_lead_id on public.lead_assignment_approvals(lead_id);
create index if not exists idx_lead_assignment_approvals_status on public.lead_assignment_approvals(status);
create index if not exists idx_lead_assignment_approvals_created_at on public.lead_assignment_approvals(created_at desc);

-- ----------------------------------------------------------------------------
-- RLS: admin-only. No anon/public policies are created.
-- ----------------------------------------------------------------------------
alter table public.lead_assignment_approvals enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_assignment_approvals'
      and policyname = 'lead_assignment_approvals admin all'
  ) then
    execute 'create policy "lead_assignment_approvals admin all" on public.lead_assignment_approvals for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;
end $$;
