-- ============================================================================
-- QuickFurno — QF-MVP-75.01 — MATCHCORE BINDING RANK ORDER
--
-- PHASE
--   QF-MVP-75.01. Single migration. Forward-only.
--
-- PURPOSE
--   Make the caller's canonical RANKED candidate order the BUSINESS ORDER of
--   public.qf_assign_lead_vendors_v2, without weakening concurrency safety,
--   idempotency, credit atomicity or database enforcement.
--
-- THE DEFECT THIS FIXES (QF-MVP-75.00 audit, section 2)
--   The authority consumed candidates with `order by vid` - ASCENDING VENDOR
--   UUID - and the file said so explicitly: the caller's rank was "only a
--   ranking preference, never as authority". Consequently, whenever more than
--   c_active_cap candidates in the submitted pool were eligible, the vendors
--   that actually won the lead were THE THREE LOWEST UUIDs. Match tier,
--   haversine distance, listed-area affinity and last-assigned fairness -
--   everything services/leadMatchingEngine computes - decided nothing.
--
--   The same statement also defeated the exact-category preference. The DB
--   taxonomy gate public.qf_lead_vendor_parent_group_compatible accepts any
--   PARENT-GROUP match, so a Tier-1 fallback vendor with a lower UUID could
--   displace a Tier-0 exact-category vendor that the matcher had ranked first.
--
-- CLASSIFICATION
--   FUNCTION REPLACEMENT ONLY. Exactly one object is replaced:
--     public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)
--   No table, column, constraint, index, trigger, policy, grant, role or data
--   statement anywhere in this file. No new function and no new signature, so
--   CREATE OR REPLACE keeps the existing object identity and therefore its
--   existing ACL. Signature, argument order, argument types, return type,
--   volatility, SECURITY DEFINER mode, owner and `set search_path` are all
--   reproduced EXACTLY as migration 20260723000300 established them, and the
--   body is byte-identical to that migration's apart from the four corrections
--   below.
--
-- THE FOUR CORRECTIONS, AND NOTHING ELSE
--   1. new declarations: c_fingerprint_version, v_ranked, v_lock_id
--   2. new step 1c: build the normalized ranked candidate list ONCE
--   3. step 2: the request fingerprint now carries that ORDER (version 1 -> 2)
--   4. the fused candidate loop is split into step 7b (LOCK pass, ascending
--      uuid) and step 8 (BUSINESS pass, rank order)
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * public.qf_vendor_assignment_eligible - untouched. It keeps every hard gate
--     and keeps its deliberately coarse `vendor_not_eligible` code. QF-MVP-75.01
--     removes the DECISION layer's dependence on that coarse code by mirroring
--     the missing assignment-suspension gate in TypeScript
--     (lib/vendors/vendorAutomaticEligibility.ts). The database stays the
--     enforcement backstop and remains the authority.
--   * public.qf_apply_credit_mutation_v2 - untouched. One credit per successful
--     assignment, ledger-mandatory, never clamping, debited inside the same
--     transaction. 75.01 changes WHICH eligible vendors are assigned, never WHEN
--     or WHETHER credit is consumed. Credit-on-send is QF-MVP-75.05 / 75.06.
--   * The active cap (3) and the lifetime cap (6). Both remain internal
--     constants with no caller-supplied ceiling and no configuration source.
--   * The taxonomy gate. Tier-1 parent-group fallback stays ELIGIBLE; it is not
--     demoted to force Tier-0 priority. Tier-0 wins now because rank order is
--     binding, which is the correct mechanism.
--   * Argument validation and every `unauthorized` reason code, duplicate
--     settlement, replacement approval, lineage events, communication intents,
--     the sanitized result shape, and every other reason code.
--
-- ---------------------------------------------------------------------------
-- CORRECTION 4 IN DETAIL - WHY TWO PASSES
-- ---------------------------------------------------------------------------
--   The previous implementation fused two unrelated concerns into one loop:
--   ascending-UUID iteration served BOTH as the deadlock-avoidance lock order
--   AND as the business selection order. Ranked order could not be honoured
--   without breaking deadlock safety, so ranked order was discarded. Splitting
--   the concerns is what lets both be correct at once:
--
--     PASS 1 (step 7b) - LOCK ORDER. Deterministic, deadlock-safe, ascending
--       vendor uuid, unchanged rule. Now acquires the WHOLE candidate lock set
--       up front instead of lazily, which is strictly stronger.
--     PASS 2 (step 8) - BUSINESS ORDER. The caller's rank order, under locks
--       already held.
--
--   Because the lock set is a SUPERSET acquired in one total global order, no
--   deadlock cycle is reachable regardless of the business order. Re-acquiring a
--   row lock this transaction already holds is immediate, so step 8 keeps its
--   per-candidate `select ... for update` verbatim, preserving the existing
--   not-found handling exactly.
--
-- ---------------------------------------------------------------------------
-- CORRECTION 3 IN DETAIL - IDEMPOTENCY MUST FOLLOW BUSINESS ORDER
-- ---------------------------------------------------------------------------
--   RESULTING BEHAVIOUR (the required QF-MVP-75.01 invariant):
--     same key + same normalized ORDERED candidates  -> already_applied (replay)
--     same key + same candidate SET, different ORDER -> idempotency_conflict,
--                                                       and ZERO mutation.
--
--   The operation KEY is deliberately NOT changed: it stays SET-derived
--   (lib/marketplace/canonicalAssignmentContract.candidateSetDigest). That is
--   exactly what makes a re-ordered resubmission collide on the key and fail
--   closed as a conflict, rather than proceeding as a second independent
--   operation against the same lead.
--
--   MIGRATION CONSEQUENCE, STATED PLAINLY: an operation claimed BEFORE this
--   migration carries a v1 fingerprint. If that same operation key is submitted
--   again AFTER this migration, the recomputed v2 fingerprint will not match and
--   the call returns `rejected` / `idempotency_conflict` instead of
--   `already_applied`. That is fail-closed: nothing is assigned, no credit moves,
--   and no committed assignment is altered. Only the classification of a
--   cross-version retry changes.
--
-- SECURITY POSTURE - UNCHANGED
--   SECURITY DEFINER, `set search_path = pg_catalog, public, pg_temp`, and no
--   GRANT or REVOKE statement anywhere in this file. CREATE OR REPLACE on an
--   unchanged signature preserves the existing ACL, so the authority stays
--   service_role-only exactly as QF-MVP-20.3B1 / 20.3E left it. This migration
--   adds no EXECUTE privilege to PUBLIC, anon or authenticated, and the
--   self-verification block below PROVES that from catalog facts rather than
--   assuming it.
--
-- SELF-VERIFICATION
--   Catalog facts only - existence at the exact signature, SECURITY DEFINER,
--   volatility, return type, the pinned search_path, and the ACL proven in BOTH
--   directions: service_role RETAINS EXECUTE, and PUBLIC/anon/authenticated have
--   NONE. The positive half matters as much as the negative one: an ACL that had
--   lost service_role would satisfy a forbidden-grants-only check while leaving
--   the sole assignment authority unreachable and every assignment path failing
--   closed at runtime.
--   It deliberately does NOT pattern-match the function body: QF-MVP-20.3B1A
--   failed and rolled back for exactly that reason (pg_get_functiondef returns
--   comments too), and QF-MVP-20.3B1R2 corrected it. That lesson is respected here.
-- ============================================================================

begin;

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
  -- from app_settings, vendor_packages or any configuration row: no caller and
  -- no data value may raise or lower them.
  c_active_cap   constant integer := 3;
  c_lifetime_cap constant integer := 6;

  -- ASSIGNMENT_CREDIT_COST = 1 (LOCKED, QF-MVP-20.3B1R founder decision 2).
  -- One newly created vendor assignment costs exactly one wallet credit.
  -- This literal is the single unambiguous authority for that cost. It is never
  -- accepted from the caller, never read from app_settings, never inferred from
  -- vendor_packages and never varied by operation mode. A replay, an
  -- already-assigned vendor, a rejected candidate, a cap-blocked candidate and
  -- the A2 historical backfill all cost ZERO because none of them reaches the
  -- debit at all.
  c_credit_cost  constant integer := 1;

  v_lead          public.leads%rowtype;
  v_operation_id  uuid;
  v_fingerprint   text;
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

  -- QF-MVP-75.01 fingerprint version. 1 = sorted candidate SET (order was not
  -- authoritative). 2 = order-preserving candidate LIST (order is authoritative).
  c_fingerprint_version constant integer := 2;

  -- QF-MVP-75.01: the ONE normalized ranked candidate list. Built before the
  -- fingerprint and reused by the fingerprint, the lock pass and the business
  -- pass, so those three can never disagree about the caller's ranked order.
  v_ranked        uuid[] := '{}';
  v_lock_id       uuid;
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

  -- 1b. CLIENT-SELECTED MODE IS FAIL-CLOSED IN THIS PHASE.
  --     R1_BLOCKED_PENDING_OWNER_BINDING (QF-MVP-20.3B1R founder decision 3).
  --
  --     A client-selected assignment requires the AUTHORITY to re-assert, in the
  --     database, that this client owns this lead. The schema provides no such
  --     binding: public.leads has no client_account_id, user_id or created_by
  --     column, and the only available correlation is the lead's phone text.
  --     Phone equality is explicitly NOT accepted as ownership authority, and
  --     the schema offers no canonical phone normalizer either
  --     (public.qf_norm_text is lower(trim(...)), i.e. raw-text equality after
  --     casing, which cannot canonicalise a telephone number).
  --
  --     Inventing a phone canonicalisation here would be a new runtime
  --     ownership system that the schema contract never froze, and would weaken
  --     authorization purely to make the mode operational. So this mode fails
  --     closed and mutates NOTHING - the rejection happens BEFORE the operation
  --     claim, so not even an operation row is created.
  --
  --     Unblocking is R1 work and needs one of:
  --       * an explicit lead/client ownership binding column, or
  --       * a server-created client-selection request row binding the
  --         authenticated client, the lead and the requested vendor.
  --     Until then no runtime consumer may activate client_selected mode.
  if p_mode = 'client_selected' then
    return jsonb_build_object('status','unauthorized','reason_code','unauthorized');
  end if;

  -- 1c. QF-MVP-75.01 - NORMALIZED RANKED CANDIDATE LIST.
  --
  --     Drop NULL entries, de-duplicate keeping the FIRST occurrence (which is
  --     the best rank), and preserve the caller's remaining order verbatim.
  --     This is the single definition of "the caller's ranked order" inside the
  --     authority, and it is the sole input to the fingerprint (step 2), the
  --     lock pass (step 7b) and the business pass (step 8).
  --
  --     lib/matchcore/automaticMatchDecision.normalizeRankedVendorIds and
  --     lib/marketplace/canonicalAssignmentContract.normalizeCandidateVendorIds
  --     implement the identical rule in TypeScript (they additionally drop
  --     non-UUID text, which a uuid[] argument cannot carry).
  select coalesce(array_agg(d.vid order by d.first_rank), '{}'::uuid[])
    into v_ranked
    from (
      select item.vendor_id as vid, min(item.ordinality) as first_rank
        from unnest(coalesce(p_candidate_vendors, '{}'::uuid[]))
             with ordinality as item(vendor_id, ordinality)
       where item.vendor_id is not null
       group by item.vendor_id
    ) d;

  -- 2. Normalized authority-request fingerprint.
  --
  --    QF-MVP-75.01 CHANGED THIS. The v1 fingerprint hashed the candidate list
  --    DEDUPLICATED AND SORTED, on the stated ground that caller ordering was
  --    "only a ranking preference". That is no longer true: since step 8 now
  --    fills the remaining slots in RANK order, the order decides WHICH eligible
  --    vendors win the lead. Order is therefore a material business input and
  --    must be inside the fingerprint, otherwise two genuinely different
  --    business requests would be indistinguishable and the second would
  --    silently replay the first one's result.
  --
  --    The version is bumped 1 -> 2 so a v1 sorted-set fingerprint can never be
  --    mistaken for a v2 ordered-list fingerprint, including the case where the
  --    caller's order happened to be ascending and the two hashes would
  --    otherwise have coincided.
  --
  --    Still deliberately excludes now(), txid, random values and all volatile
  --    database state, so the same authority request always fingerprints
  --    identically and a genuine replay is always recognised as one.
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'v',               c_fingerprint_version,
    'lead_id',         p_lead_id::text,
    'mode',            p_mode,
    'candidates',      coalesce((
                         select jsonb_agg(to_jsonb(u.vid::text) order by u.ord)
                           from unnest(v_ranked) with ordinality as u(vid, ord)
                       ), '[]'::jsonb),
    'reason_code',     coalesce(p_reason_code, ''),
    'replacement_ref', coalesce(p_replacement_ref::text, ''),
    'actor_kind',      p_actor_kind,
    'actor_id',        coalesce(p_actor_id::text, '')
  )::text, 'UTF8')), 'hex');

  -- 3. Operation idempotency claim, BEFORE any lock. Exactly one invocation can
  --    win the unique key; a concurrent duplicate blocks here until the first
  --    transaction resolves, then takes the replay/conflict path below.
  insert into public.assignment_operations (
    idempotency_key, request_fingerprint, lead_id, mode, actor_kind, actor_id,
    replacement_request_id, reason_code, status)
  values (
    p_operation_key, v_fingerprint, p_lead_id, p_mode, p_actor_kind, p_actor_id,
    p_replacement_ref, p_reason_code, 'in_progress')
  on conflict (idempotency_key) do nothing
  returning id into v_operation_id;

  if v_operation_id is null then
    -- The key was already claimed. Decide replay versus conflict WITHOUT
    -- trusting the key alone, and WITHOUT mutating anything on any branch.
    select * into v_existing_op from public.assignment_operations
      where idempotency_key = p_operation_key;

    if not found then
      -- The concurrent claimant rolled back after ON CONFLICT saw its row.
      -- Nothing is authoritative yet; the caller may retry with the same key.
      return jsonb_build_object('status','rejected','reason_code','conflict_retry');
    end if;

    -- 3a. Same key, DIFFERENT authority request. This is misuse of the key and
    --     must never replay somebody else's result. Zero mutation.
    if v_existing_op.request_fingerprint is distinct from v_fingerprint then
      return jsonb_build_object(
        'status','rejected','reason_code','idempotency_conflict',
        'operation_id', v_existing_op.id);
    end if;

    -- 3b. Same key, same request, but the original attempt never reached a
    --     terminal state: an incomplete or rolled-back infrastructure attempt.
    --     There is no authoritative result to replay, so do not invent one.
    if v_existing_op.status = 'in_progress' then
      return jsonb_build_object(
        'status','rejected','reason_code','conflict_retry',
        'operation_id', v_existing_op.id);
    end if;

    -- 3c. EXACT REPLAY. Return the persisted result verbatim: no recomputation,
    --     no new eligibility evaluation, no new id, and no dependence on vendor
    --     state, credit balance or assignment counts that changed after the
    --     original operation committed.
    return v_existing_op.result
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

  -- NOTE: there is deliberately NO database-side client ownership re-assertion
  -- here. The only mode that would need one, client_selected, is rejected in
  -- step 1b before any write, because the schema provides no trustworthy
  -- lead-to-client binding to re-assert against
  -- (R1_BLOCKED_PENDING_OWNER_BINDING). No weaker substitute is accepted.

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

  -- 7b. LOCK PASS — QF-MVP-75.01.
  --
  --     Acquire the WHOLE candidate vendor lock set up front, iterating in
  --     ASCENDING VENDOR UUID ORDER. That is the global deadlock-avoidance rule
  --     and it is UNCHANGED; what changed is that it is now a pass of its own,
  --     so lock order can no longer leak into the business outcome.
  --
  --     This pass reads no business meaning, evaluates no eligibility, writes
  --     nothing, and cannot alter the result. A candidate id matching no row
  --     simply locks nothing, and step 8 reports it as not eligible exactly as
  --     before.
  --
  --     Acquiring the FULL set in one global order is strictly stronger than the
  --     previous lazy, early-exiting acquisition: two concurrent operations can
  --     no longer hold partially-ordered overlapping lock sets, so no deadlock
  --     cycle is reachable whatever order step 8 uses. That is precisely what
  --     makes the business order free.
  --
  --     COST, STATED HONESTLY: this transaction now holds up to
  --     MAX_CANONICAL_CANDIDATE_POOL (20) vendor row locks instead of at most 3,
  --     for the same short transaction. The exposure is bounded contention on
  --     public.vendors rows, never deadlock. Accepted deliberately: a partially
  --     ordered lock set is the one thing that could make a free business order
  --     unsafe.
  for v_lock_id in
    select u.vid from unnest(v_ranked) as u(vid) order by u.vid
  loop
    perform 1 from public.vendors where id = v_lock_id for update;
  end loop;

  -- 8. Candidate loop — QF-MVP-75.01 BUSINESS PASS.
  --
  --    Candidates are evaluated in the caller's RANK order. This is the binding
  --    correction: the first eligible candidates BY RANK fill the remaining
  --    active slots, so match tier, distance, area affinity and fairness finally
  --    decide which eligible vendors win the lead. An ineligible high-rank
  --    candidate is recorded as skipped and consumes NO slot, so the next ranks
  --    fill in its place. A Tier-0 exact-category candidate ranked ahead of a
  --    Tier-1 parent-group fallback is now assigned first, which ascending-UUID
  --    order could not guarantee.
  --
  --    Every vendor row touched below is ALREADY locked by step 7b, so the
  --    retained per-candidate 'for update' re-acquires a lock this transaction
  --    already holds: immediate, and incapable of deadlocking.
  for v_candidate in
    select u.vid from unnest(v_ranked) with ordinality as u(vid, ord) order by u.ord
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
  'QF-MVP-75.01 rank-bound sole assignment authority. The caller ranked candidate order IS the business order: vendor row locks are acquired in a separate ascending-uuid pass, then candidates are evaluated in rank order, so match tier, distance, area affinity and fairness decide which eligible vendors fill the remaining slots. Request fingerprint version 2 carries that order, so the same operation key with a re-ordered candidate set returns idempotency_conflict and mutates nothing. Enforces active-3 and lifetime-6 internally with no caller-controlled ceiling. Lifetime is count(distinct vendor_id) over assignment_created/assigned lineage events. Ledger-only debit, atomic rollback, communication intent only.';

-- ---------------------------------------------------------------------------
-- SELF-VERIFICATION - catalog facts only.
--
-- Deliberately NOT a body-text match: pg_get_functiondef() returns the
-- definition including comments, and a naive body assertion is exactly what
-- made QF-MVP-20.3B1A fail and roll back (corrected by QF-MVP-20.3B1R2).
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_oid       oid;
  v_secdef    boolean;
  v_volatile  "char";
  v_rettype   text;
  v_bad_acl   integer;
  v_svc_acl   integer;
  v_proconfig text[];
begin
  v_oid := to_regprocedure(
    'public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)')::oid;

  if v_oid is null or v_oid = 0 then
    raise exception
      'QF-MVP-75.01 aborted: qf_assign_lead_vendors_v2 is missing at its exact signature after replacement.';
  end if;

  select p.prosecdef, p.provolatile, pg_catalog.format_type(p.prorettype, null)
    into v_secdef, v_volatile, v_rettype
    from pg_catalog.pg_proc p
   where p.oid = v_oid;

  if v_secdef is not true then
    raise exception
      'QF-MVP-75.01 aborted: qf_assign_lead_vendors_v2 is no longer SECURITY DEFINER.';
  end if;

  if v_volatile <> 'v' then
    raise exception
      'QF-MVP-75.01 aborted: qf_assign_lead_vendors_v2 volatility is %, expected VOLATILE.', v_volatile;
  end if;

  if v_rettype <> 'jsonb' then
    raise exception
      'QF-MVP-75.01 aborted: qf_assign_lead_vendors_v2 return type is %, expected jsonb.', v_rettype;
  end if;

  -- The pinned search_path is a SECURITY DEFINER safety property, not a style
  -- choice: without it a caller-controlled search_path could resolve the
  -- unqualified helper calls in this function to attacker-owned objects running
  -- as the definer. Matched loosely on the three required entries so the check
  -- proves the property rather than a spelling.
  select p.proconfig into v_proconfig
    from pg_catalog.pg_proc p
   where p.oid = v_oid;

  if v_proconfig is null
     or not exists (
       select 1 from unnest(v_proconfig) as cfg(entry)
        where cfg.entry like 'search_path=%'
          and cfg.entry like '%pg_catalog%'
          and cfg.entry like '%public%'
          and cfg.entry like '%pg_temp%'
     ) then
    raise exception
      'QF-MVP-75.01 aborted: qf_assign_lead_vendors_v2 lost its pinned search_path (proconfig = %).',
      coalesce(array_to_string(v_proconfig, ', '), '<null>');
  end if;

  -- POSITIVE ACL PROOF. CREATE OR REPLACE preserves the ACL established by
  -- migration 20260723000300, which granted EXECUTE to service_role. Proving only
  -- the ABSENCE of PUBLIC/anon/authenticated would also pass on an ACL that had
  -- lost service_role entirely — which would leave the sole assignment authority
  -- unreachable and every assignment path failing closed at runtime. Both
  -- directions are therefore asserted.
  select count(*)
    into v_svc_acl
    from pg_catalog.pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid = v_oid
     and a.privilege_type = 'EXECUTE'
     and a.grantee <> 0
     and pg_catalog.pg_get_userbyid(a.grantee) = 'service_role';

  if v_svc_acl = 0 then
    raise exception
      'QF-MVP-75.01 aborted: qf_assign_lead_vendors_v2 does not grant EXECUTE to service_role. The sole assignment authority would be unreachable.';
  end if;

  -- No EXECUTE for PUBLIC, anon or authenticated. CREATE OR REPLACE preserves
  -- the pre-existing ACL; this proves the posture instead of assuming it.
  select count(*)
    into v_bad_acl
    from pg_catalog.pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid = v_oid
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0
          or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'));

  if v_bad_acl > 0 then
    raise exception
      'QF-MVP-75.01 aborted: qf_assign_lead_vendors_v2 grants EXECUTE to PUBLIC/anon/authenticated (% grant(s)). The authority must stay service_role-only.',
      v_bad_acl;
  end if;

  raise notice
    'QF-MVP-75.01: qf_assign_lead_vendors_v2 replaced. Rank order is binding, lock order remains ascending uuid, fingerprint version 2. ACL proven service_role-only in both directions; SECURITY DEFINER and pinned search_path intact.';
end
$verify$;

commit;
