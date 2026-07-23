-- ============================================================================
-- QuickFurno — QF-MVP-20.3B1 — MIGRATION B1 — Canonical assignment and credit authority
--
-- PHASE
--   QF-MVP-20.3B1. This file is Migration B1 of three.
--   Release order: A -> A2 -> B1 -> R1 (runtime) -> B2 -> C -> D -> E.
--
-- PURPOSE
--   Deploy the canonical assignment, credit, replacement and restoration
--   authority as service_role-only SECURITY DEFINER functions, WHILE the legacy
--   RPCs remain present and callable. Nothing is revoked and nothing is
--   enforced universally: this migration adds authority, it does not yet take
--   any away.
--
-- CLASSIFICATION
--   ADDITIVE. Five new functions and nothing else. No table, column,
--   constraint, index, trigger, policy or grant change to any existing object.
--   No data statement.
--
-- DEPENDENCIES
--   • Migration A  (20260723000100) — the five foundation tables and the
--     additive columns these functions read and write.
--   • Migration A2 (20260723000200) — historical lineage, so lifetime-six
--     counts real history from the first canonical call.
--   • Pre-existing baseline helpers, reused unchanged:
--       public.qf_norm_text(text)
--       public.qf_lead_vendor_parent_group_compatible(text,text,text,text[],text,text[])
--
-- AUTHORITATIVE SOURCES
--   docs/QF-MVP-20-3A-REMEDIATION-MIGRATION-DESIGN.md  (sections 4, 5, 6, 7, 8, 10, 11, 13)
--   docs/QF-MVP-20-3A-SCHEMA-CONTRACT.md               (section 9)
--   docs/QF-MVP-20-3A1-DECISION-CLOSURE.md             (sections 6, 9, 11, 13)
--   QF-MVP-20.3B1 founder decision 2 (audit model, recorded below).
--
-- FOUNDER DECISION 2 — AUDIT MODEL
--   public.audit_logs is ABSENT from the applied baseline (62 tables) and is
--   deliberately NOT created by Migration A. B1 therefore writes NO audit_logs
--   row. The authoritative domain audit evidence is:
--     assignment_operations, lead_assignment_events, vendor_credit_logs,
--     credit_restoration_approvals, communication_intents.
--   The design's separate "append audit" step is replaced by COMPLETING the
--   assignment_operations row with its sanitized result after the assignment,
--   ledger, lineage and communication-intent writes have all succeeded.
--
-- NO SUSPENSION OR RESTORATION MUTATION PATH
--   Migration A added the five vendors suspension columns as inert storage.
--   B1 READS them as a hard eligibility gate and NEVER writes them. No function
--   here can suspend, unsuspend or otherwise mutate a vendor's suspension
--   state. An audited administrative path is R1/B2 or a later reviewed
--   migration. qf_approve_credit_restoration_v2 applies an approval that
--   ALREADY EXISTS and is ALREADY in status 'approved'; it cannot create or
--   self-approve one.
--
-- ---------------------------------------------------------------------------
-- LOCKED INVARIANTS ENFORCED INSIDE qf_assign_lead_vendors_v2
-- ---------------------------------------------------------------------------
--   ACTIVE SET      = {assigned, delivered, accepted}   (never in_progress)
--   ACTIVE CAP      = 3   internal constant, no caller input, no app_settings
--   LIFETIME CAP    = 6   internal constant
--   LIFETIME COUNT  = count(distinct vendor_id) from lead_assignment_events
--                     where event_type = 'assignment_created'
--                       and lifecycle_to = 'assigned'
--                     -> a QUERY, never a constraint
--   A candidate that fails before assignment creation writes NO
--   assignment_created event and therefore consumes NO lifetime slot.
--   A later lifecycle event consumes NO additional lifetime slot.
--   The seventh DISTINCT historical vendor is rejected BEFORE assignment
--   insertion, BEFORE credit debit, BEFORE event insertion and BEFORE any
--   communication intent.
--
-- THE RPC DELIBERATELY DOES NOT ACCEPT
--   • a caller-controlled maximum count (there is no p_total_limit; this closes
--     the legacy 1..9 ceiling that reached the database from application code)
--   • a caller-proven actor identity (p_actor_id is RECORDED and CROSS-CHECKED,
--     never treated as proof of authority)
--   • an arbitrary credit delta (the debit is the internal cost constant)
--   • any provider-send instruction
--   • public_visibility as an eligibility gate (visibility governs public
--     listing only, never assignability)
--
-- DETERMINISTIC LOCK ORDER (the global deadlock-avoidance rule)
--   operation idempotency claim -> lead FOR UPDATE -> replacement request
--   FOR UPDATE -> candidate vendors FOR UPDATE in ASCENDING UUID ORDER.
--   No other order is permitted anywhere in the codebase. Isolation is the
--   PostgreSQL default READ COMMITTED: every invariant is protected by an
--   explicit row lock taken BEFORE the read that informs the decision, so
--   SERIALIZABLE is not required and its retry semantics are avoided.
--
-- ATOMICITY
--   Ledger debit, assignment insert, lineage event, communication intent and
--   the operation result are all in ONE transaction. A ledger failure rolls
--   back the assignment; an assignment failure rolls back the debit. There is
--   no partial state and no compensating write.
--
-- ---------------------------------------------------------------------------
-- DELIBERATELY NOT DONE IN THIS MIGRATION
-- ---------------------------------------------------------------------------
--   • NO enforcement trigger is created, attached or enabled. The three
--     universal triggers (active-3, lifetime-6, lineage-immutable) are
--     Migration B2 and must not exist before the R1 consumer release, because
--     legacy flows are still reachable: the legacy admin path accepts a total
--     limit up to 9, legacy RPCs write no lineage at all, and in production the
--     legacy blockers are still anon-executable. A universal trigger now would
--     convert working legacy flows into mid-transaction failures.
--     No trigger FUNCTION is defined either — the design does not require inert
--     trigger preparation in B1.
--   • NO legacy function is dropped, replaced or altered.
--   • NO legacy grant is revoked or broadened. Legacy service_role
--     compatibility is retained deliberately, so a runtime revert during R1
--     never needs a database rollback.
--   • NO grant to PUBLIC, anon or authenticated. Every function below is
--     REVOKE ALL FROM PUBLIC, anon, authenticated and GRANT EXECUTE TO
--     service_role only.
--   • NO public vendor projection, NO anon privilege change, NO leads policy
--     change (Migration C).
--   • NO auth.users trigger (Migration D).
--   • NO legacy EXECUTE revocation (Migration E).
--   • NO audit_logs table and NO audit_logs write (founder decision 2).
--   • NO vendor_packages debit. The wallet vendors.remaining_credits is the
--     sole assignment-debit authority; vendor_packages is an entitlement record
--     only and is never touched here.
--   • NO backfill of the 27 historical assignments lacking ledger evidence.
--     That gap stays open for QF-MVP-20.4 and is neither touched nor worsened.
--   • NO provider call of any kind: no Meta, no n8n, no Jarvis, no WhatsApp, no
--     SMS, no whatsapp_logs delivery write, no retry of an uncertain outcome.
--   • NO balance clamping and NO silent package-counter synchronisation.
--
-- ROLLBACK BOUNDARY
--   drop function if exists public.qf_approve_credit_restoration_v2(uuid, uuid, text);
--   drop function if exists public.qf_request_replacement_v2(uuid, uuid, text, text, uuid);
--   drop function if exists public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text);
--   drop function if exists public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean);
--   drop function if exists public.qf_vendor_assignment_eligible(uuid, uuid, integer);
--   Legacy RPCs are untouched and serve traffic immediately. Rows already
--   created by the canonical engine are business truth and are NEVER deleted to
--   roll back code (rollback rule 6).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. qf_vendor_assignment_eligible — canonical eligibility (STABLE, INVOKER)
--
--    Pure read. SECURITY INVOKER by contract: it grants no privilege of its own
--    and is only reachable by a role that can already read the tables.
--
--    HARD GATES (all must hold):
--      vendor exists · status approved/active · is_active · accepting_leads
--      · NOT temporarily assignment-suspended · sufficient wallet credit
--      · normalized city compatible · parent-category compatible
--      · not already assigned to this lead
--    RANKING SIGNALS, deliberately NOT gates: subcategory, area/distance,
--    package state, paid status.
--    public_visibility is NOT a gate.
-- ---------------------------------------------------------------------------

create or replace function public.qf_vendor_assignment_eligible(
  p_lead_id     uuid,
  p_vendor_id   uuid,
  p_credit_cost integer
) returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_lead   public.leads%rowtype;
  v_vendor public.vendors%rowtype;
  v_cost   integer := greatest(coalesce(p_credit_cost, 1), 0);
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'lead_not_found');
  end if;

  if coalesce(v_lead.is_duplicate, false) then
    return jsonb_build_object('eligible', false, 'reason_code', 'lead_not_eligible');
  end if;

  select * into v_vendor from public.vendors where id = p_vendor_id;
  if not found then
    return jsonb_build_object('eligible', false, 'reason_code', 'vendor_not_eligible');
  end if;

  -- Permanent legal/security block. No admin override may ever bypass this.
  if lower(trim(coalesce(v_vendor.status, ''))) not in ('approved', 'active') then
    return jsonb_build_object('eligible', false, 'reason_code', 'vendor_not_eligible');
  end if;

  if coalesce(v_vendor.is_active, false) is not true
     or coalesce(v_vendor.accepting_leads, true) is not true then
    return jsonb_build_object('eligible', false, 'reason_code', 'vendor_not_eligible');
  end if;

  -- Temporary assignment suspension, evaluated at READ time. Hard gate.
  if v_vendor.assignment_suspended_at is not null
     and (v_vendor.assignment_suspended_until is null
          or v_vendor.assignment_suspended_until > now()) then
    return jsonb_build_object('eligible', false, 'reason_code', 'vendor_not_eligible');
  end if;

  if coalesce(v_vendor.remaining_credits, 0) < v_cost then
    return jsonb_build_object('eligible', false, 'reason_code', 'insufficient_credits');
  end if;

  -- City is the hard geographic gate; area is a ranking signal only.
  if public.qf_norm_text(coalesce(nullif(trim(v_vendor.city), ''), v_vendor.office_city))
       is distinct from public.qf_norm_text(v_lead.city) then
    return jsonb_build_object('eligible', false, 'reason_code', 'vendor_not_eligible');
  end if;

  -- Parent category is the hard taxonomy gate; subcategory is a ranking signal.
  if not public.qf_lead_vendor_parent_group_compatible(
       v_lead.service_required, v_lead.category, v_lead.subcategory,
       v_vendor.service_categories, v_vendor.selected_category, v_vendor.selected_subcategories) then
    return jsonb_build_object('eligible', false, 'reason_code', 'vendor_not_eligible');
  end if;

  if exists (select 1 from public.lead_assignments
              where lead_id = p_lead_id and vendor_id = p_vendor_id) then
    return jsonb_build_object('eligible', false, 'reason_code', 'duplicate_assignment');
  end if;

  return jsonb_build_object('eligible', true, 'reason_code', null);
end;
$$;

comment on function public.qf_vendor_assignment_eligible(uuid, uuid, integer) is
  'QF-MVP-20 canonical eligibility. Hard gates only; subcategory, area, package and paid status are ranking signals, and public_visibility is never a gate. Pure read, mutates nothing.';

-- ---------------------------------------------------------------------------
-- 2. qf_apply_credit_mutation_v2 — the sole canonical credit authority
--
--    Wallet-only. vendors.remaining_credits is the sole assignment-debit
--    target; vendor_packages is never touched.
--
--    Every mutation writes a ledger row carrying vendor, delta, balance before,
--    balance after, change type, reason, trusted actor, reference type,
--    reference id, idempotency key, approval reference (when required) and
--    timestamp. A mutation without a successful ledger row is impossible: they
--    are the same transaction and there is no exception handler around the
--    ledger insert.
--
--    Debits never clamp. An insufficient balance fails with insufficient_credits.
-- ---------------------------------------------------------------------------

create or replace function public.qf_apply_credit_mutation_v2(
  p_vendor_id      uuid,
  p_delta          integer,
  p_change_type    text,
  p_reason         text,
  p_reference_type text,
  p_reference_id   text,
  p_actor_kind     text,
  p_actor_id       uuid,
  p_idempotency_key text,
  p_allow_negative boolean
) returns jsonb
  language plpgsql
  security definer
  set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_vendor    public.vendors%rowtype;
  v_before    integer;
  v_after     integer;
  v_ledger_id uuid;
  v_approval  uuid;
  v_existing  uuid;
begin
  -- Canonical vocabulary only. Legacy values stay valid for historical rows but
  -- may never be written by the canonical authority.
  if coalesce(p_change_type, '') not in (
       'lead_assignment_debit','approved_bad_lead_restoration','package_purchase_credit',
       'authorized_manual_adjustment','migration_reconciliation_adjustment') then
    return jsonb_build_object('status','rejected','reason_code','unauthorized');
  end if;

  if coalesce(p_actor_kind, '') not in ('system','client','admin','worker') then
    return jsonb_build_object('status','rejected','reason_code','unauthorized');
  end if;

  if p_delta is null or p_delta = 0 then
    return jsonb_build_object('status','rejected','reason_code','unauthorized');
  end if;

  -- A restoration must carry approval evidence, and the approval must already
  -- be approved or applied. This function can neither create nor approve one.
  if p_change_type = 'approved_bad_lead_restoration' then
    begin
      v_approval := p_reference_id::uuid;
    exception when others then
      return jsonb_build_object('status','rejected','reason_code','approval_invalid');
    end;

    if p_reference_type is distinct from 'credit_restoration_approval' then
      return jsonb_build_object('status','rejected','reason_code','approval_invalid');
    end if;

    if not exists (select 1 from public.credit_restoration_approvals
                    where id = v_approval and status in ('approved','applied')) then
      return jsonb_build_object('status','rejected','reason_code','approval_required');
    end if;
  end if;

  -- Idempotency guard 1: the primary reference authority, checked before any lock.
  if p_reference_type is not null and p_reference_id is not null then
    select id into v_existing from public.vendor_credit_logs
      where reference_type = p_reference_type and reference_id = p_reference_id;
    if found then
      return jsonb_build_object('status','already_applied','reason_code',null,
                                'ledger_id', v_existing, 'vendor_id', p_vendor_id);
    end if;
  end if;

  -- Idempotency guard 2: the secondary key.
  if p_idempotency_key is not null then
    select id into v_existing from public.vendor_credit_logs
      where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('status','already_applied','reason_code',null,
                                'ledger_id', v_existing, 'vendor_id', p_vendor_id);
    end if;
  end if;

  -- Vendor row lock. Callers that already hold this lock keep the same
  -- ascending-uuid order, so no new lock ordering is introduced.
  select * into v_vendor from public.vendors where id = p_vendor_id for update;
  if not found then
    return jsonb_build_object('status','rejected','reason_code','vendor_not_eligible');
  end if;

  -- Re-check under the lock: a concurrent transaction may have written it.
  if p_reference_type is not null and p_reference_id is not null then
    select id into v_existing from public.vendor_credit_logs
      where reference_type = p_reference_type and reference_id = p_reference_id;
    if found then
      return jsonb_build_object('status','already_applied','reason_code',null,
                                'ledger_id', v_existing, 'vendor_id', p_vendor_id);
    end if;
  end if;

  v_before := coalesce(v_vendor.remaining_credits, 0);
  v_after  := v_before + p_delta;

  -- Never clamp. A negative result requires an explicit opt-in AND an
  -- authorized manual adjustment; it is impossible on an assignment debit.
  if v_after < 0 then
    if coalesce(p_allow_negative, false) is not true
       or p_change_type <> 'authorized_manual_adjustment' then
      return jsonb_build_object('status','rejected','reason_code','insufficient_credits');
    end if;
  end if;

  -- Conditional update, so two concurrent debits cannot consume the same credit.
  update public.vendors
     set remaining_credits = v_after,
         last_assigned_at  = case when p_change_type = 'lead_assignment_debit'
                                  then now() else last_assigned_at end
   where id = p_vendor_id
     and coalesce(remaining_credits, 0) = v_before;

  if not found then
    return jsonb_build_object('status','rejected','reason_code','conflict_retry');
  end if;

  -- MANDATORY ledger row. No exception handler: if this cannot be written the
  -- entire transaction, including the balance change, rolls back.
  insert into public.vendor_credit_logs (
    vendor_id, change_type, credits_before, credits_delta, credits_after,
    reason, updated_by, reference_type, reference_id,
    approval_reference, idempotency_key, actor_kind, actor_id
  ) values (
    p_vendor_id, p_change_type, v_before, p_delta, v_after,
    p_reason, 'qf_canonical_authority_v2', p_reference_type, p_reference_id,
    v_approval, p_idempotency_key, p_actor_kind, p_actor_id
  ) returning id into v_ledger_id;

  return jsonb_build_object(
    'status','applied','reason_code',null,
    'ledger_id', v_ledger_id, 'vendor_id', p_vendor_id,
    'credits_before', v_before, 'credits_after', v_after);
exception
  when unique_violation then
    -- A concurrent transaction won the reference/idempotency race.
    return jsonb_build_object('status','already_applied','reason_code',null,
                              'vendor_id', p_vendor_id);
end;
$$;

comment on function public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean) is
  'QF-MVP-20 sole canonical credit authority. Wallet-only; never touches vendor_packages. Mandatory ledger row, never clamps, returns already_applied on a duplicate reference or idempotency key.';

-- ---------------------------------------------------------------------------
-- 3. qf_assign_lead_vendors_v2 — the sole assignment authority
-- ---------------------------------------------------------------------------

create or replace function public.qf_assign_lead_vendors_v2(
  p_lead_id           uuid,
  p_mode              text,
  p_candidate_vendors uuid[],
  p_operation_key     text,
  p_actor_kind        text,
  p_actor_id          uuid,
  p_replacement_ref   uuid,
  p_reason_code       text
) returns jsonb
  language plpgsql
  security definer
  set search_path = pg_catalog, public, pg_temp
as $$
declare
  -- Internal constants. Deliberately NOT parameters and deliberately NOT read
  -- from app_settings: no caller and no configuration row may raise them.
  c_active_cap   constant integer := 3;
  c_lifetime_cap constant integer := 6;
  c_credit_cost  constant integer := 1;

  v_lead          public.leads%rowtype;
  v_operation_id  uuid;
  v_existing_op   public.assignment_operations%rowtype;
  v_replacement   public.replacement_requests%rowtype;
  v_active_count  integer;
  v_lifetime      integer;
  v_vendor        public.vendors%rowtype;
  v_candidate     uuid;
  v_eligible      jsonb;
  v_credit        jsonb;
  v_assignment_id uuid;
  v_event_id      uuid;
  v_intent_id     uuid;
  v_is_new_vendor boolean;
  v_assigned      jsonb := '[]'::jsonb;
  v_skipped       jsonb := '[]'::jsonb;
  v_intent_ids    uuid[] := '{}';
  v_result        jsonb;
  v_status        text;
  v_assigned_n    integer := 0;
begin
  -- 0. Argument shape. Sanitized reasons only; no internal state is leaked.
  if p_lead_id is null or coalesce(p_operation_key, '') = '' then
    return jsonb_build_object('status','unauthorized','reason_code','unauthorized');
  end if;

  if coalesce(p_mode, '') not in
       ('automatic','client_selected','admin_manual','delayed_fill','replacement','recovery_replay') then
    return jsonb_build_object('status','unauthorized','reason_code','unauthorized');
  end if;

  if coalesce(p_actor_kind, '') not in ('system','client','admin','worker') then
    return jsonb_build_object('status','unauthorized','reason_code','unauthorized');
  end if;

  -- Replacement mode requires its approved request reference, and only
  -- replacement mode may supply one.
  if (p_mode = 'replacement') <> (p_replacement_ref is not null) then
    return jsonb_build_object('status','unauthorized','reason_code','unauthorized');
  end if;

  -- 1. Trusted actor resolution. p_actor_id is NEVER proof of authority: it is
  --    cross-checked against server-owned state, and rejected before any lock.
  if p_actor_kind in ('system','worker') and p_actor_id is not null then
    return jsonb_build_object('status','unauthorized','reason_code','unauthorized');
  end if;

  if p_actor_kind in ('client','admin') and p_actor_id is null then
    return jsonb_build_object('status','unauthorized','reason_code','unauthorized');
  end if;

  -- 2. Operation idempotency claim, BEFORE any lock.
  insert into public.assignment_operations (
    idempotency_key, lead_id, mode, actor_kind, actor_id,
    replacement_request_id, reason_code, status)
  values (
    p_operation_key, p_lead_id, p_mode, p_actor_kind, p_actor_id,
    p_replacement_ref, p_reason_code, 'in_progress')
  on conflict (idempotency_key) do nothing
  returning id into v_operation_id;

  if v_operation_id is null then
    -- Replay: return the stored result verbatim and perform NO further write.
    select * into v_existing_op from public.assignment_operations
      where idempotency_key = p_operation_key;
    return coalesce(v_existing_op.result, '{}'::jsonb)
           || jsonb_build_object('status','already_applied',
                                 'operation_id', v_existing_op.id,
                                 'already_applied', true);
  end if;

  -- 3. Lead lock — the master invariant lock. Serialises every assignment and
  --    replacement mutation for this lead.
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    update public.assignment_operations
       set status = 'rejected', completed_at = now(),
           result = jsonb_build_object('status','rejected','reason_code','lead_not_found')
     where id = v_operation_id;
    return jsonb_build_object('status','rejected','reason_code','lead_not_found',
                              'operation_id', v_operation_id);
  end if;

  if coalesce(v_lead.is_duplicate, false) then
    update public.assignment_operations
       set status = 'rejected', completed_at = now(),
           result = jsonb_build_object('status','rejected','reason_code','lead_not_eligible')
     where id = v_operation_id;
    return jsonb_build_object('status','rejected','reason_code','lead_not_eligible',
                              'operation_id', v_operation_id);
  end if;

  -- 3b. Client ownership re-assertion, UNDER the lead lock. The calling route
  --     verifies ownership before the privileged call; the authority re-asserts
  --     it here so a compromised route cannot assign another client's lead.
  --     The only ownership linkage that exists in the schema is the verified
  --     client account phone, so that is what is cross-checked.
  if p_actor_kind = 'client' then
    if not exists (
      select 1 from public.client_accounts ca
       where ca.user_id = p_actor_id
         and ca.status = 'active'
         and ca.phone_e164 is not null
         and public.qf_norm_text(ca.phone_e164) = public.qf_norm_text(v_lead.phone)
    ) then
      update public.assignment_operations
         set status = 'rejected', completed_at = now(),
             result = jsonb_build_object('status','unauthorized','reason_code','unauthorized')
       where id = v_operation_id;
      return jsonb_build_object('status','unauthorized','reason_code','unauthorized',
                                'operation_id', v_operation_id);
    end if;
  end if;

  -- 4. Replacement request lock. The partial unique index is the one-at-a-time
  --    authority; this lock serialises the approved row itself.
  if p_mode = 'replacement' then
    select * into v_replacement from public.replacement_requests
      where id = p_replacement_ref for update;

    if not found or v_replacement.lead_id is distinct from p_lead_id then
      update public.assignment_operations
         set status = 'rejected', completed_at = now(),
             result = jsonb_build_object('status','rejected','reason_code','approval_invalid')
       where id = v_operation_id;
      return jsonb_build_object('status','rejected','reason_code','approval_invalid',
                                'operation_id', v_operation_id);
    end if;

    -- Approval is a database row with an approver, never a caller-supplied flag.
    if v_replacement.status <> 'approved' or v_replacement.approved_by is null then
      update public.assignment_operations
         set status = 'rejected', completed_at = now(),
             result = jsonb_build_object('status','rejected','reason_code','approval_required')
       where id = v_operation_id;
      return jsonb_build_object('status','rejected','reason_code','approval_required',
                                'operation_id', v_operation_id);
    end if;
  end if;

  -- 5. Immutable lifetime history — a QUERY over DISTINCT vendors, never a raw
  --    row count and never a constraint.
  select count(distinct vendor_id) into v_lifetime
    from public.lead_assignment_events
   where lead_id = p_lead_id
     and event_type = 'assignment_created'
     and lifecycle_to = 'assigned';

  -- 6. Active count over the locked ACTIVE SET.
  select count(*) into v_active_count
    from public.lead_assignments
   where lead_id = p_lead_id
     and lifecycle_status in ('assigned','delivered','accepted');

  -- 7. Active-three headroom.
  if v_active_count >= c_active_cap then
    v_result := jsonb_build_object(
      'operation_id', v_operation_id, 'status','rejected', 'reason_code','active_limit_reached',
      'lead_id', p_lead_id, 'assigned','[]'::jsonb,
      'skipped','[]'::jsonb,
      'active_count_after', v_active_count, 'lifetime_count_after', v_lifetime,
      'communication_intent_ids','[]'::jsonb);
    update public.assignment_operations
       set status = 'rejected', completed_at = now(), result = v_result
     where id = v_operation_id;
    return v_result;
  end if;

  -- 8. Candidate loop. Vendors are locked in ASCENDING UUID ORDER — the global
  --    deadlock-avoidance rule — while the caller-supplied order is preserved
  --    only as a ranking preference, never as authority.
  for v_candidate in
    select vid from (
      select distinct on (item.vendor_id) item.vendor_id as vid, item.ordinality
        from unnest(coalesce(p_candidate_vendors, '{}'::uuid[])) with ordinality as item(vendor_id, ordinality)
       where item.vendor_id is not null
       order by item.vendor_id, item.ordinality
    ) deduped
    order by vid
  loop
    exit when v_active_count >= c_active_cap;

    -- 8a. Lifetime-six headroom for a GENUINELY NEW vendor. Rejected BEFORE the
    --     assignment, BEFORE the debit, BEFORE the event, BEFORE any intent.
    select not exists (
      select 1 from public.lead_assignment_events
       where lead_id = p_lead_id and vendor_id = v_candidate
         and event_type = 'assignment_created' and lifecycle_to = 'assigned')
      into v_is_new_vendor;

    if v_is_new_vendor and v_lifetime >= c_lifetime_cap then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('vendor_id', v_candidate, 'reason_code','lifetime_limit_reached'));
      continue;
    end if;

    -- 8b. Vendor row lock, then canonical eligibility under that lock.
    select * into v_vendor from public.vendors where id = v_candidate for update;
    if not found then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('vendor_id', v_candidate, 'reason_code','vendor_not_eligible'));
      continue;
    end if;

    v_eligible := public.qf_vendor_assignment_eligible(p_lead_id, v_candidate, c_credit_cost);
    if coalesce((v_eligible->>'eligible')::boolean, false) is not true then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('vendor_id', v_candidate,
                           'reason_code', coalesce(v_eligible->>'reason_code','vendor_not_eligible')));
      continue;
    end if;

    -- 8c. Assignment row first, so the ledger reference is the assignment id and
    --     the existing UNIQUE (lead_id, vendor_id) settles duplicate races.
    begin
      insert into public.lead_assignments (
        lead_id, vendor_id, assignment_type, credit_deducted,
        lifecycle_status, lifecycle_updated_at, operation_id)
      values (
        p_lead_id, v_candidate,
        case p_mode
          when 'client_selected' then 'client_selected'
          when 'admin_manual'    then 'admin_assigned'
          else 'auto_assigned'
        end,
        true, 'assigned', now(), v_operation_id)
      returning id into v_assignment_id;
    exception when unique_violation then
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('vendor_id', v_candidate, 'reason_code','duplicate_assignment'));
      continue;
    end;

    -- 8d. Ledger-backed debit through the sole credit authority. No debit
    --     without a ledger row, and no ledger row without a debit.
    v_credit := public.qf_apply_credit_mutation_v2(
      v_candidate, -c_credit_cost, 'lead_assignment_debit',
      'Canonical marketplace assignment', 'lead_assignment', v_assignment_id::text,
      p_actor_kind, p_actor_id,
      'assignment_debit:' || v_operation_id::text || ':' || v_assignment_id::text,
      false);

    if coalesce(v_credit->>'status','') <> 'applied' then
      -- The debit did not happen, so the assignment must not stand. Raising
      -- rolls the whole transaction back; there is no compensating write.
      raise exception using
        errcode = 'P0001',
        message = 'QF_ASSIGN_CREDIT_FAILED:' || coalesce(v_credit->>'reason_code','insufficient_credits');
    end if;

    -- 8e. Append lineage. The AUTHORITY derives the key; no caller supplies it.
    insert into public.lead_assignment_events (
      assignment_id, lead_id, vendor_id, operation_id,
      event_type, lifecycle_from, lifecycle_to, occurred_at, recorded_at,
      actor_kind, actor_id, reason_code, source_kind, source_reference,
      event_idempotency_key, metadata)
    values (
      v_assignment_id, p_lead_id, v_candidate, v_operation_id,
      'assignment_created', null, 'assigned', now(), now(),
      p_actor_kind, p_actor_id, coalesce(p_reason_code, p_mode),
      'canonical_authority', p_operation_key,
      'assignment_event:' || v_operation_id::text || ':' || v_assignment_id::text || ':assignment_created',
      jsonb_build_object('mode', p_mode))
    on conflict (event_idempotency_key) do nothing
    returning id into v_event_id;

    -- 8f. Communication INTENT only — never a send, never a provider call.
    insert into public.communication_intents (
      aggregate_type, aggregate_id, channel, template_purpose,
      recipient_ref, payload_ref, idempotency_key, status)
    values (
      'lead_assignment', v_assignment_id, 'whatsapp', 'vendor_lead_assigned',
      encode(sha256(('vendor:' || v_candidate::text)::bytea), 'hex'),
      jsonb_build_object('assignment_id', v_assignment_id, 'lead_id', p_lead_id),
      v_assignment_id::text || ':vendor_lead_assigned:' || v_candidate::text,
      'pending')
    on conflict (idempotency_key) do nothing
    returning id into v_intent_id;

    if v_intent_id is not null then
      v_intent_ids := v_intent_ids || v_intent_id;
    end if;

    if v_is_new_vendor then
      v_lifetime := v_lifetime + 1;
    end if;
    v_active_count := v_active_count + 1;
    v_assigned_n   := v_assigned_n + 1;

    v_assigned := v_assigned || jsonb_build_array(jsonb_build_object(
      'assignment_id', v_assignment_id,
      'vendor_id', v_candidate,
      'credit_ledger_id', v_credit->>'ledger_id'));
  end loop;

  -- 9. Sanitized result. No SQL text, no balances, no internal reasons.
  if v_assigned_n = 0 then
    v_status := 'rejected';
  elsif jsonb_array_length(v_skipped) > 0 then
    v_status := 'partial';
  else
    v_status := 'applied';
  end if;

  v_result := jsonb_build_object(
    'operation_id', v_operation_id,
    'status', v_status,
    'lead_id', p_lead_id,
    'assigned', v_assigned,
    'skipped', v_skipped,
    'active_count_after', v_active_count,
    'lifetime_count_after', v_lifetime,
    'communication_intent_ids', to_jsonb(v_intent_ids));

  -- 10. Complete the operation record. This REPLACES the design's separate
  --     "append audit_logs" step (founder decision 2): the operation row, the
  --     lineage events, the ledger rows and the intents ARE the audit evidence.
  update public.assignment_operations
     set status = case when v_status = 'applied' then 'applied'
                       when v_status = 'partial' then 'partial'
                       else 'rejected' end,
         completed_at = now(),
         result = v_result
   where id = v_operation_id;

  return v_result;
end;
$$;

comment on function public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text) is
  'QF-MVP-20 sole assignment authority. Enforces active-3 and lifetime-6 internally with no caller-controlled ceiling. Lifetime is count(distinct vendor_id) over assignment_created/assigned lineage events. Ledger-only debit, atomic rollback, communication intent only.';

-- ---------------------------------------------------------------------------
-- 4. qf_request_replacement_v2 — create a replacement request (never approve it)
--
--    One open request per lead is guaranteed by uq_replacement_requests_open_per_lead,
--    a partial unique index. This function CANNOT approve: approved_by is left
--    NULL and status is 'requested'. Approval is a separate authorized action.
-- ---------------------------------------------------------------------------

create or replace function public.qf_request_replacement_v2(
  p_lead_id                uuid,
  p_original_assignment_id uuid,
  p_reason_code            text,
  p_evidence_reference     text,
  p_actor_id               uuid
) returns jsonb
  language plpgsql
  security definer
  set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assignment public.lead_assignments%rowtype;
  v_request_id uuid;
begin
  if p_lead_id is null or p_original_assignment_id is null or coalesce(p_reason_code,'') = '' then
    return jsonb_build_object('status','rejected','reason_code','unauthorized');
  end if;

  perform 1 from public.leads where id = p_lead_id for update;
  if not found then
    return jsonb_build_object('status','rejected','reason_code','lead_not_found');
  end if;

  select * into v_assignment from public.lead_assignments
    where id = p_original_assignment_id and lead_id = p_lead_id;
  if not found then
    return jsonb_build_object('status','rejected','reason_code','lead_not_eligible');
  end if;

  if v_assignment.lifecycle_status not in ('assigned','delivered','accepted') then
    return jsonb_build_object('status','rejected','reason_code','lead_not_eligible');
  end if;

  begin
    insert into public.replacement_requests (
      lead_id, original_assignment_id, original_vendor_id,
      reason_code, evidence_reference, status, requested_by,
      idempotency_key)
    values (
      p_lead_id, p_original_assignment_id, v_assignment.vendor_id,
      p_reason_code, p_evidence_reference, 'requested', p_actor_id,
      'replacement_request:' || p_original_assignment_id::text || ':' || p_reason_code)
    returning id into v_request_id;
  exception when unique_violation then
    -- Either an open request already exists for this lead, or this exact request
    -- was already made. Both are the same sanitized answer.
    return jsonb_build_object('status','rejected','reason_code','replacement_in_progress');
  end;

  return jsonb_build_object('status','applied','reason_code',null,
                            'replacement_request_id', v_request_id, 'lead_id', p_lead_id);
end;
$$;

comment on function public.qf_request_replacement_v2(uuid, uuid, text, text, uuid) is
  'QF-MVP-20 replacement request. Creates a requested row only and can never approve it. One open request per lead is enforced by a partial unique index, not by application logic.';

-- ---------------------------------------------------------------------------
-- 5. qf_approve_credit_restoration_v2 — apply an ALREADY-APPROVED restoration
--
--    Flips an existing 'approved' row to 'applied' AND writes the restoration
--    ledger row in ONE transaction. It cannot create an approval and it cannot
--    approve one: an approval that is not already 'approved' is refused.
-- ---------------------------------------------------------------------------

create or replace function public.qf_approve_credit_restoration_v2(
  p_approval_id uuid,
  p_actor_id    uuid,
  p_reason_code text
) returns jsonb
  language plpgsql
  security definer
  set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_approval public.credit_restoration_approvals%rowtype;
  v_credit   jsonb;
begin
  if p_approval_id is null then
    return jsonb_build_object('status','rejected','reason_code','approval_invalid');
  end if;

  select * into v_approval from public.credit_restoration_approvals
    where id = p_approval_id for update;
  if not found then
    return jsonb_build_object('status','rejected','reason_code','approval_invalid');
  end if;

  if v_approval.status = 'applied' then
    return jsonb_build_object('status','already_applied','reason_code',null,
                              'approval_id', v_approval.id,
                              'ledger_id', v_approval.restoration_ledger_id);
  end if;

  -- The approval must ALREADY carry an approver. This function never approves.
  if v_approval.status <> 'approved' or v_approval.approved_by is null then
    return jsonb_build_object('status','rejected','reason_code','approval_required');
  end if;

  v_credit := public.qf_apply_credit_mutation_v2(
    v_approval.vendor_id, 1, 'approved_bad_lead_restoration',
    coalesce(p_reason_code, v_approval.reason_code),
    'credit_restoration_approval', v_approval.id::text,
    'admin', p_actor_id,
    'restoration:' || v_approval.id::text,
    false);

  if coalesce(v_credit->>'status','') not in ('applied','already_applied') then
    return jsonb_build_object('status','rejected',
                              'reason_code', coalesce(v_credit->>'reason_code','approval_invalid'));
  end if;

  update public.credit_restoration_approvals
     set status = 'applied',
         restoration_ledger_id = coalesce((v_credit->>'ledger_id')::uuid, restoration_ledger_id),
         decided_at = coalesce(decided_at, now()),
         updated_at = now()
   where id = v_approval.id;

  return jsonb_build_object('status','applied','reason_code',null,
                            'approval_id', v_approval.id,
                            'ledger_id', v_credit->>'ledger_id');
end;
$$;

comment on function public.qf_approve_credit_restoration_v2(uuid, uuid, text) is
  'QF-MVP-20 restoration application. Applies an approval that is ALREADY in status approved; it can neither create nor approve one. The ledger row and the status flip are the same transaction.';

-- ---------------------------------------------------------------------------
-- 6. Least-privilege grants
--
--    PUBLIC has no EXECUTE on any mutation function, ever. anon and
--    authenticated are explicitly revoked and never granted. Client and admin
--    authorization runs through server-owned APIs (R1), never direct RPC.
-- ---------------------------------------------------------------------------

revoke all on function public.qf_vendor_assignment_eligible(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.qf_request_replacement_v2(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.qf_approve_credit_restoration_v2(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.qf_vendor_assignment_eligible(uuid, uuid, integer)
  to service_role;
grant execute on function public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)
  to service_role;
grant execute on function public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)
  to service_role;
grant execute on function public.qf_request_replacement_v2(uuid, uuid, text, text, uuid)
  to service_role;
grant execute on function public.qf_approve_credit_restoration_v2(uuid, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Verification — fail closed on any deviation from the B1 contract
-- ---------------------------------------------------------------------------

do $verify$
declare
  v_missing text := '';
  v_fn      text;
  v_sigs    text[] := array[
    'public.qf_vendor_assignment_eligible(uuid, uuid, integer)',
    'public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)',
    'public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)',
    'public.qf_request_replacement_v2(uuid, uuid, text, text, uuid)',
    'public.qf_approve_credit_restoration_v2(uuid, uuid, text)'
  ];
begin
  -- 7.1 every canonical function exists with the EXACT frozen signature, and is
  --     executable by service_role but by none of PUBLIC, anon, authenticated.
  foreach v_fn in array v_sigs loop
    if to_regprocedure(v_fn) is null then
      v_missing := v_missing || ' [missing ' || v_fn || ']';
      continue;
    end if;

    if has_function_privilege('public',  to_regprocedure(v_fn), 'EXECUTE')
       or has_function_privilege('anon',          to_regprocedure(v_fn), 'EXECUTE')
       or has_function_privilege('authenticated', to_regprocedure(v_fn), 'EXECUTE') then
      raise exception
        'QF-MVP-20.3B1 Migration B1 aborted: % is executable by PUBLIC, anon or authenticated. Canonical mutation authority is service_role only.', v_fn;
    end if;

    if not has_function_privilege('service_role', to_regprocedure(v_fn), 'EXECUTE') then
      v_missing := v_missing || ' [service_role cannot execute ' || v_fn || ']';
    end if;
  end loop;

  -- 7.2 the assignment authority has no caller-controlled ceiling parameter.
  if (select pg_catalog.pg_get_function_identity_arguments(
               to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)')))
     ilike '%limit%' then
    raise exception
      'QF-MVP-20.3B1 Migration B1 aborted: qf_assign_lead_vendors_v2 exposes a limit-like parameter. No caller-controlled maximum count may exist.';
  end if;

  -- 7.3 SECURITY DEFINER routines pin a safe search_path.
  if exists (
    select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('qf_apply_credit_mutation_v2','qf_assign_lead_vendors_v2',
                         'qf_request_replacement_v2','qf_approve_credit_restoration_v2')
       and p.prosecdef
       and (p.proconfig is null
            or not exists (select 1 from unnest(p.proconfig) cfg
                            where cfg like 'search_path=%'))
  ) then
    raise exception
      'QF-MVP-20.3B1 Migration B1 aborted: a SECURITY DEFINER canonical function does not pin search_path.';
  end if;

  -- 7.4 the eligibility helper is INVOKER, not DEFINER.
  if exists (
    select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'qf_vendor_assignment_eligible' and p.prosecdef
  ) then
    raise exception
      'QF-MVP-20.3B1 Migration B1 aborted: qf_vendor_assignment_eligible must be SECURITY INVOKER.';
  end if;

  -- 7.5 B1 must not have created any enforcement trigger. Those are B2.
  if exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid in ('public.lead_assignments'::regclass,
                       'public.lead_assignment_events'::regclass)
       and not tgisinternal
  ) then
    raise exception
      'QF-MVP-20.3B1 Migration B1 aborted: an enforcement trigger exists on lead_assignments or lead_assignment_events. Those belong to Migration B2, after the R1 consumer release.';
  end if;

  -- 7.6 legacy compatibility is intact: the six legacy assignment RPCs remain.
  if (select count(*) from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('admin_smart_assign_lead_to_vendors','assign_client_selected_vendor_to_group',
                           'assign_lead_to_preferred_vendor','assign_lead_to_vendors',
                           'assign_package_to_vendor','assign_vendor_to_requirement_group')) < 6 then
    raise exception
      'QF-MVP-20.3B1 Migration B1 aborted: one or more legacy assignment functions is missing. B1 must retain full legacy compatibility; retirement is Migration E and later.';
  end if;

  if v_missing <> '' then
    raise exception 'QF-MVP-20.3B1 Migration B1 verification failed:%', v_missing;
  end if;
end
$verify$;
