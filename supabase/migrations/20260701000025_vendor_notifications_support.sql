-- Phase 25B Step 6: vendor notifications and support inbox.
-- Additive only: no lead matching, no WhatsApp, no package approval.

create table if not exists public.vendor_notifications (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  title text not null,
  message text not null,
  type text default 'general',
  priority text default 'normal',
  is_read boolean default false,
  cta_label text,
  cta_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.vendor_notifications add column if not exists type text default 'general';
alter table public.vendor_notifications add column if not exists priority text default 'normal';
alter table public.vendor_notifications add column if not exists is_read boolean default false;
alter table public.vendor_notifications add column if not exists cta_label text;
alter table public.vendor_notifications add column if not exists cta_url text;
alter table public.vendor_notifications add column if not exists updated_at timestamptz default now();

create table if not exists public.vendor_support_threads (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  subject text not null,
  topic text default 'general',
  status text default 'open',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.vendor_support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.vendor_support_threads(id) on delete cascade,
  sender_type text not null,
  sender_id uuid null,
  message text not null,
  created_at timestamptz default now()
);

alter table public.vendor_support_threads
  add constraint vendor_support_threads_status_check
  check (status in ('open', 'admin_replied', 'vendor_replied', 'closed'))
  not valid;

alter table public.vendor_support_messages
  add constraint vendor_support_messages_sender_type_check
  check (sender_type in ('vendor', 'admin', 'system'))
  not valid;

create index if not exists idx_vendor_notifications_vendor_created
  on public.vendor_notifications(vendor_id, created_at desc);
create index if not exists idx_vendor_notifications_vendor_read
  on public.vendor_notifications(vendor_id, is_read, created_at desc);
create index if not exists idx_vendor_support_threads_vendor_updated
  on public.vendor_support_threads(vendor_id, updated_at desc);
create index if not exists idx_vendor_support_threads_status_updated
  on public.vendor_support_threads(status, updated_at desc);
create index if not exists idx_vendor_support_messages_thread_created
  on public.vendor_support_messages(thread_id, created_at asc);

alter table public.vendor_notifications enable row level security;
alter table public.vendor_support_threads enable row level security;
alter table public.vendor_support_messages enable row level security;

grant select, update on public.vendor_notifications to authenticated;
grant select, insert, update on public.vendor_support_threads to authenticated;
grant select, insert on public.vendor_support_messages to authenticated;
grant select, insert, update, delete on public.vendor_notifications to service_role;
grant select, insert, update, delete on public.vendor_support_threads to service_role;
grant select, insert, update, delete on public.vendor_support_messages to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vendor_notifications' and policyname = 'vendor_notifications owner read'
  ) then
    execute 'create policy "vendor_notifications owner read" on public.vendor_notifications for select to authenticated using (public.owns_vendor(vendor_id) or public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vendor_notifications' and policyname = 'vendor_notifications owner update'
  ) then
    execute 'create policy "vendor_notifications owner update" on public.vendor_notifications for update to authenticated using (public.owns_vendor(vendor_id) or public.is_admin()) with check (public.owns_vendor(vendor_id) or public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vendor_notifications' and policyname = 'vendor_notifications admin all'
  ) then
    execute 'create policy "vendor_notifications admin all" on public.vendor_notifications for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vendor_support_threads' and policyname = 'vendor_support_threads owner read'
  ) then
    execute 'create policy "vendor_support_threads owner read" on public.vendor_support_threads for select to authenticated using (public.owns_vendor(vendor_id) or public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vendor_support_threads' and policyname = 'vendor_support_threads owner insert'
  ) then
    execute 'create policy "vendor_support_threads owner insert" on public.vendor_support_threads for insert to authenticated with check (public.owns_vendor(vendor_id))';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vendor_support_threads' and policyname = 'vendor_support_threads owner update'
  ) then
    execute 'create policy "vendor_support_threads owner update" on public.vendor_support_threads for update to authenticated using (public.owns_vendor(vendor_id) or public.is_admin()) with check (public.owns_vendor(vendor_id) or public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vendor_support_threads' and policyname = 'vendor_support_threads admin all'
  ) then
    execute 'create policy "vendor_support_threads admin all" on public.vendor_support_threads for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vendor_support_messages' and policyname = 'vendor_support_messages owner read'
  ) then
    execute 'create policy "vendor_support_messages owner read" on public.vendor_support_messages for select to authenticated using (exists (select 1 from public.vendor_support_threads t where t.id = thread_id and (public.owns_vendor(t.vendor_id) or public.is_admin())))';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vendor_support_messages' and policyname = 'vendor_support_messages owner insert'
  ) then
    execute 'create policy "vendor_support_messages owner insert" on public.vendor_support_messages for insert to authenticated with check (sender_type = ''vendor'' and exists (select 1 from public.vendor_support_threads t where t.id = thread_id and public.owns_vendor(t.vendor_id)))';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vendor_support_messages' and policyname = 'vendor_support_messages admin all'
  ) then
    execute 'create policy "vendor_support_messages admin all" on public.vendor_support_messages for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;
end $$;
