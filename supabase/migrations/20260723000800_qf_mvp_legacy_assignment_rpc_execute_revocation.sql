-- ============================================================================
-- QF-MVP-20.3E — LEGACY ASSIGNMENT RPC EXECUTE REVOCATION (ACL-ONLY)
--
-- Forward-only. ACL-ONLY. Non-destructive to DEFINITIONS and DATA. STAGING
-- FIRST. NOT AUTHORIZED FOR PRODUCTION by this phase. Generated and reviewed
-- only; application is a separate, separately authorized phase.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES
-- ---------------------------------------------------------------------------
-- It pins the EXECUTE posture of the six legacy, state-changing lead-assignment
-- RPCs to SERVER-OWNED authority only: EXECUTE revoked from PUBLIC, anon and
-- authenticated, retained for service_role. It changes ACLs ONLY — it does not
-- drop, rename, recreate, or alter the body, signature, return type, security
-- mode, volatility, search_path or owner of any function, and it touches no
-- table, policy, index, trigger or row.
--
-- The canonical authority (public.qf_assign_lead_vendors_v2, Migration B1) is
-- the sole live assignment path; QF-MVP-20.3R1 migrated every runtime consumer
-- onto it, so NO application code calls any of the six legacy RPCs (they survive
-- only as documented, service-role-reachable legacy surface). The safe,
-- read-only public discovery RPC public.get_public_eligible_vendors keeps its
-- anon/authenticated EXECUTE and is NOT touched here.
--
-- ---------------------------------------------------------------------------
-- RECONCILIATION — WHY THIS IS DEFENCE-IN-DEPTH, NOT A LIVE-HOLE FIX
-- ---------------------------------------------------------------------------
-- HONEST FINDING: the applied QF-MVP-20.2 baseline ALREADY carries, for all six
-- targets, `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE
-- ... TO service_role`, and NO applied migration (A/A2/B1/G/B2/C/D) re-creates
-- or re-grants them. On the current staging state the six are therefore already
-- service_role-only — the QF-MVP-20.3D advisors confirm none of the six is anon/
-- authenticated-executable. E does not close an open exposure.
--
-- E's value is forward-only ENFORCEMENT and CATALOG PROOF: it re-asserts the
-- safe posture as an explicit, idempotent step in the migration chain, so the
-- lockdown is guaranteed independently of the baseline dump (e.g. if a target is
-- ever DROP+CREATE'd, which resets ACLs to the PUBLIC-executable default). The
-- REVOKE/GRANT statements are idempotent: re-revoking an already-absent grant
-- and re-granting an existing one are both no-ops. The §self-verification block
-- is the load-bearing deliverable — it PROVES the posture from catalog facts.
--
-- ---------------------------------------------------------------------------
-- WHY PUBLIC MUST BE REVOKED (role inheritance)
-- ---------------------------------------------------------------------------
-- PUBLIC is a pseudo-role every role belongs to. A function's default ACL grants
-- EXECUTE to PUBLIC, so revoking only anon and authenticated would leave both
-- still able to execute VIA PUBLIC. Each REVOKE below therefore names PUBLIC,
-- anon and authenticated together. service_role's EXECUTE is an explicit grant
-- and is re-asserted, not revoked. The owner (postgres) and superusers retain
-- inherent break-glass authority that no GRANT/REVOKE here changes.
--
-- ---------------------------------------------------------------------------
-- FROZEN TARGET SET (exactly six; signature-qualified; SECURITY DEFINER; jsonb)
-- ---------------------------------------------------------------------------
--   public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)
--   public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)
--   public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])
--   public.assign_lead_to_preferred_vendor(uuid, uuid)
--   public.assign_lead_to_vendors(uuid, uuid[], boolean, text)
--   public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)
--
-- EXPLICITLY OUT OF SCOPE (not touched): the canonical B1 RPC; the safe
-- read-only public.get_public_eligible_vendors; credit RPCs (deduct/restore/
-- increment_vendor_credit, qf_apply_vendor_credit_delta, qf_apply_credit_
-- mutation_v2); assign_package_to_vendor (package, not lead assignment) — none
-- of which is a state-changing LEAD-assignment RPC, and none of which is granted
-- to anon/authenticated in the baseline.
--
-- No explicit transaction control (the CLI wraps file + history in one
-- transaction). No data change. No migration-history write. No secret or project
-- ref. No DROP/CREATE/ALTER of any function. No ALTER DEFAULT PRIVILEGES. No
-- broad schema-level REVOKE. Self-verification uses CATALOG FACTS only — no
-- lexical assertion over pg_get_functiondef()/prosrc, every catalog `name` is
-- compared as text, and any set comparison normalises both sides.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Re-assert server-owned-only EXECUTE on the six legacy assignment RPCs.
--    REVOKE names PUBLIC first (see role-inheritance note); the GRANT re-pins
--    the single required server role. Both are idempotent.
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer) from public, anon, authenticated;
grant  execute on function public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer) to service_role;

revoke execute on function public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant  execute on function public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer) to service_role;

revoke execute on function public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[]) from public, anon, authenticated;
grant  execute on function public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[]) to service_role;

revoke execute on function public.assign_lead_to_preferred_vendor(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.assign_lead_to_preferred_vendor(uuid, uuid) to service_role;

revoke execute on function public.assign_lead_to_vendors(uuid, uuid[], boolean, text) from public, anon, authenticated;
grant  execute on function public.assign_lead_to_vendors(uuid, uuid[], boolean, text) to service_role;

revoke execute on function public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text) from public, anon, authenticated;
grant  execute on function public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text) to service_role;


-- ---------------------------------------------------------------------------
-- 2. Self-verification — fail closed on any deviation from the E contract.
--    CATALOG FACTS ONLY. No pg_get_functiondef()/prosrc assertion; every
--    catalog `name` compared as text; every set comparison normalises both
--    sides (the B1R2 / B2R1 / CVR1 defect classes are all avoided).
-- ---------------------------------------------------------------------------

do $verify$
declare
  r_sig     text;
  v_oid     oid;
  v_count   integer;
  c_targets constant text[] := array[
    'public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)',
    'public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)',
    'public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])',
    'public.assign_lead_to_preferred_vendor(uuid, uuid)',
    'public.assign_lead_to_vendors(uuid, uuid[], boolean, text)',
    'public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)'
  ];
begin
  -- 2.1 Each target still exists exactly once, unchanged in shape, and holds the
  --     server-owned-only EXECUTE posture.
  foreach r_sig in array c_targets loop
    v_oid := to_regprocedure(r_sig);
    if v_oid is null then
      raise exception 'QF-MVP-20.3E aborted: target % is missing (E must not drop functions).', r_sig;
    end if;

    -- definition-equivalence at the catalog level: SECURITY DEFINER + jsonb
    -- result, so E cannot have quietly changed the security mode or return type.
    if not exists (
      select 1 from pg_proc p
       where p.oid = v_oid and p.prosecdef
         and pg_get_function_result(p.oid) = 'jsonb'
    ) then
      raise exception 'QF-MVP-20.3E aborted: target % is no longer a SECURITY DEFINER jsonb function.', r_sig;
    end if;

    -- the posture: PUBLIC / anon / authenticated hold NO execute; service_role does.
    if has_function_privilege('public', v_oid, 'EXECUTE')
       or has_function_privilege('anon', v_oid, 'EXECUTE')
       or has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'QF-MVP-20.3E aborted: % is still EXECUTE-able by PUBLIC/anon/authenticated.', r_sig;
    end if;
    if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
      raise exception 'QF-MVP-20.3E aborted: service_role lost EXECUTE on % (server-owned runtime needs it).', r_sig;
    end if;
  end loop;

  -- 2.2 The reported legacy set is exactly six and all present (no over/under-reach).
  select count(*) into v_count
    from unnest(c_targets) s(sig)
   where to_regprocedure(s.sig) is not null;
  if v_count <> 6 then
    raise exception 'QF-MVP-20.3E aborted: expected exactly 6 present legacy targets, found %.', v_count;
  end if;

  -- 2.3 The SAFE read-only public discovery RPC is UNCHANGED — anon and
  --     authenticated must keep EXECUTE (E must never revoke it).
  v_oid := to_regprocedure('public.get_public_eligible_vendors(text, text, text)');
  if v_oid is null then
    raise exception 'QF-MVP-20.3E aborted: public.get_public_eligible_vendors(text,text,text) is missing.';
  end if;
  if not (has_function_privilege('anon', v_oid, 'EXECUTE')
          and has_function_privilege('authenticated', v_oid, 'EXECUTE')
          and has_function_privilege('service_role', v_oid, 'EXECUTE')) then
    raise exception 'QF-MVP-20.3E aborted: the safe public discovery RPC lost anon/authenticated/service_role EXECUTE.';
  end if;

  -- 2.4 The CANONICAL authority remains and is server-executable.
  v_oid := to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)');
  if v_oid is null then
    raise exception 'QF-MVP-20.3E aborted: the canonical B1 authority qf_assign_lead_vendors_v2 is missing.';
  end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'QF-MVP-20.3E aborted: service_role lost EXECUTE on the canonical authority.';
  end if;
  -- and the canonical authority must NOT have been exposed to untrusted roles.
  if has_function_privilege('anon', v_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'QF-MVP-20.3E aborted: the canonical authority is EXECUTE-able by anon/authenticated.';
  end if;

  -- 2.5 SCOPE FENCE — A/A2/B1/G/B2/C/D objects are intact and untouched by E.
  select count(*) into v_count
    from unnest(array[
      'public.qf_vendor_assignment_eligible(uuid, uuid, integer)',
      'public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)',
      'public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)',
      'public.qf_request_replacement_v2(uuid, uuid, text, text, uuid)',
      'public.qf_approve_credit_restoration_v2(uuid, uuid, text)']) s(sig)
   where to_regprocedure(s.sig) is not null;
  if v_count <> 5 then
    raise exception 'QF-MVP-20.3E aborted: the five canonical B1 functions are not all present (found %).', v_count;
  end if;

  select count(*) into v_count
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname = 'public'
     and t.tgname in ('trg_lead_assignments_active_cap','trg_lead_assignment_events_lifetime_cap',
                      'trg_lead_assignment_events_immutable','trg_lead_assignment_events_no_truncate');
  if v_count <> 4 then
    raise exception 'QF-MVP-20.3E aborted: the four B2 enforcement triggers are not all present (found %).', v_count;
  end if;

  -- G lineage append-only boundary: PUBLIC/anon/authenticated hold no U/D/T on the ledger.
  if exists (
    select 1 from unnest(array['public','anon','authenticated']) rr(role_name)
      cross join unnest(array['UPDATE','DELETE','TRUNCATE']) pp(priv)
     where has_table_privilege(rr.role_name, 'public.lead_assignment_events', pp.priv)
  ) then
    raise exception 'QF-MVP-20.3E aborted: Migration G lineage append-only boundary was weakened.';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'vendor_public_v' and c.relkind = 'v'
  ) then
    raise exception 'QF-MVP-20.3E aborted: the Migration C public projection is missing.';
  end if;
  if has_table_privilege('anon', 'public.vendors', 'SELECT')
     or has_table_privilege('anon', 'public.leads', 'SELECT') then
    raise exception 'QF-MVP-20.3E aborted: the Migration C anon revocation was weakened.';
  end if;

  -- D onboarding trigger + hardened function intact.
  select count(*) into v_count
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and t.tgname = 'on_auth_user_created'
     and n.nspname = 'auth' and c.relname = 'users' and t.tgtype = 5 and t.tgenabled = 'O';
  if v_count <> 1 then
    raise exception 'QF-MVP-20.3E aborted: the D auth onboarding trigger posture changed.';
  end if;
  v_oid := to_regprocedure('public.handle_new_user()');
  if v_oid is null or not exists (select 1 from pg_proc p where p.oid = v_oid and p.prosecdef) then
    raise exception 'QF-MVP-20.3E aborted: the D onboarding function posture changed.';
  end if;

  -- 2.6 SCOPE FENCE — E does NOT perform QF-MVP-20.4 or owner binding.
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.leads'::regclass and not attisdropped
       and attname::text = any(array['client_account_id','user_id','created_by']::text[])
  ) then
    raise exception 'QF-MVP-20.3E aborted: an owner-binding column exists on public.leads (that is a later phase).';
  end if;

  raise notice 'QF-MVP-20.3E legacy assignment RPC EXECUTE revocation verified: six legacy assignment RPCs are service_role-only (PUBLIC/anon/authenticated hold no EXECUTE), all still present as SECURITY DEFINER jsonb functions, get_public_eligible_vendors anon/authenticated EXECUTE preserved, canonical B1 authority server-only and intact, A/A2/B1/G/B2/C/D preserved, owner binding and 20.4 not started.';
end;
$verify$;
