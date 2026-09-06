-- ============================================================================
-- QF-MVP-82A-R0 — WhatsApp inbox Realtime publication foundation
--
-- WHAT THIS DOES
--   Adds EXACTLY two existing tables to the `supabase_realtime` publication:
--
--     public.communication_messages
--     public.communication_inbound_messages
--
--   That is the entire database-semantic purpose of this migration. It exists so
--   a SERVER-SIDE Supabase Realtime subscription can observe changes on the two
--   authorities behind the QF-MVP-82A unified inbox: a Meta webhook writing an
--   inbound row, and an outbound row whose delivery lifecycle advances.
--
-- WHAT THIS DOES NOT DO
--   No INSERT, UPDATE, DELETE or TRUNCATE. No backfill. No trigger. No function
--   and no RPC. No RLS change, no policy change, no GRANT to anon or
--   authenticated, no table or column rewrite, and no view.
--
--   PUBLICATION MEMBERSHIP IS NOT BROWSER AUTHORIZATION. Both tables remain
--   RLS-enabled and service-role-only exactly as before; a subscriber still
--   needs service-role credentials, which live only on the server. Nothing here
--   makes a row readable by anon or authenticated, and nothing here can send a
--   WhatsApp message.
--
-- DELIBERATELY NOT PUBLISHED
--   communication_delivery_events. A delivery callback already updates
--   communication_messages, so the inbox refreshes from that UPDATE alone —
--   publishing the append-only event ledger as well would widen the surface
--   without adding a single signal. communication_webhook_receipts, leads,
--   vendors, assignments, credits, payments, packages, consent and automation
--   tables are likewise NOT published.
--
-- FAIL CLOSED ON DRIFT
--   This migration is deliberately NOT written to be forced through. There is no
--   `if not exists` guard around the membership change and no exception handler:
--   if `supabase_realtime` does not exist, or if either table is unexpectedly
--   already a member, the apply FAILS and the drift is surfaced for a human to
--   look at. Hiding that in SQL would mean deploying against a database whose
--   real state nobody had established.
--
-- NOT APPLIED BY THIS PHASE. Source only. It carries no applied evidence and
-- requires its own separate staging deployment gate.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Preconditions — proved, not assumed
--
-- Each is a fact this migration depends on. Failing here is the intended
-- behaviour: it means the target database is not in the state this change was
-- reviewed against.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception
      'QF-MVP-82A-R0: publication supabase_realtime does not exist. This migration adds membership to the managed Supabase Realtime publication and will not create, replace or widen it.';
  end if;

  if (select puballtables from pg_publication where pubname = 'supabase_realtime') then
    raise exception
      'QF-MVP-82A-R0: supabase_realtime is FOR ALL TABLES. Membership cannot be added table-by-table, and this migration will not narrow an existing publication. Resolve the drift deliberately.';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'communication_messages'
  ) then
    raise exception 'QF-MVP-82A-R0: public.communication_messages does not exist.';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'communication_inbound_messages'
  ) then
    raise exception 'QF-MVP-82A-R0: public.communication_inbound_messages does not exist.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. The change
--
-- Exact, schema-qualified, and exactly two tables. Never FOR ALL TABLES.
--
-- Unguarded on purpose: if either table is already a member, Postgres raises
-- and the apply stops, because "already published" means the database drifted
-- from what was reviewed and that is worth a human deciding about.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime
  add table public.communication_messages,
            public.communication_inbound_messages;

-- ---------------------------------------------------------------------------
-- 3. Self-verification — the migration proves it did what it claims
-- ---------------------------------------------------------------------------
do $$
declare
  v_published_communication_tables text[];
begin
  -- Both intended tables are now members.
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'communication_messages'
  ) then
    raise exception 'QF-MVP-82A-R0: communication_messages was not added to supabase_realtime.';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'communication_inbound_messages'
  ) then
    raise exception 'QF-MVP-82A-R0: communication_inbound_messages was not added to supabase_realtime.';
  end if;

  -- No OTHER communication table became a member as a side effect.
  select array_agg(tablename order by tablename)
    into v_published_communication_tables
    from pg_publication_tables
   where pubname = 'supabase_realtime'
     and schemaname = 'public'
     and tablename like 'communication\_%';

  if v_published_communication_tables is distinct from
     array['communication_inbound_messages', 'communication_messages']::text[] then
    raise exception
      'QF-MVP-82A-R0: unexpected communication tables in supabase_realtime: %',
      v_published_communication_tables;
  end if;

  -- Row level security is untouched on both tables.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('communication_messages', 'communication_inbound_messages')
      and c.relrowsecurity = false
  ) then
    raise exception 'QF-MVP-82A-R0: a communication table lost row level security.';
  end if;

  -- And neither API role gained access. Publication membership is not a grant,
  -- and this asserts that nothing here quietly behaved as though it were.
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('communication_messages', 'communication_inbound_messages')
      and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'QF-MVP-82A-R0: an API role has access to a communication table.';
  end if;
end
$$;
