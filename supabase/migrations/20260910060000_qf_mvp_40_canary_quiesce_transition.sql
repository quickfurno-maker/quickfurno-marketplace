-- ============================================================================
-- QF-MVP-40 — CANARY QUIESCE TRANSITION (closure-only de-escalation)
--
-- WHY THIS EXISTS
--   `qf_disable_meta_canary_v1` closes outbound AND webhook processing AND health
--   checks in one step. That is correct for emergency closure, but it means a Meta
--   delivery-status callback arriving moments after a canary send lands on a closed
--   webhook gate and is refused. The controlled canary sequence therefore needs a
--   middle transition:
--
--     ARM_READINESS -> ARM_CANARY -> one authorised send -> QUIESCE_CANARY
--       -> outbound OFF, webhook processing STILL ON -> observe callbacks -> DISABLE
--
--   This migration adds ONLY that middle transition.
--
-- WHAT IT CAN DO
--   Exactly one thing: take the Meta WhatsApp runtime policy from CANARY (or from an
--   already-exact READINESS posture) down to the EXISTING readiness posture, and remove
--   every send-enabling row. It reuses the posture 40.13B already defines; it does not
--   invent a third "quiesce posture".
--
-- WHAT IT CAN NEVER DO
--   Open or enlarge send authority. It cannot reach `active` or `canary`, cannot enable
--   outbound, cannot create a policy row, cannot touch `communication_provider_accounts`,
--   cannot reopen a `disabled` environment, and takes NO caller-supplied target state.
--   Recovery from an abnormal posture stays with the canonical DISABLE path.
--
-- SAFETY POSTURE (unchanged from 40.13B)
--   SECURITY DEFINER, pinned search_path, service_role-only execute, provider/channel
--   hard-coded, no network, one transaction, fail-loud post-write invariants.
--
-- This migration does NOT edit any historical migration and adds no new grant to the
-- two switch tables beyond the single new function's execute privilege.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Explicit transaction wrapper.
--
-- This file creates a SECURITY DEFINER function, changes function privileges, and THEN
-- runs fail-loud self-verification. Without an all-file transaction, a verification
-- failure could leave the function and its grants partially applied — and because the
-- preflight deliberately REFUSES to redefine an existing function, the rerun would then
-- abort on "already exists" and need manual recovery. Matching 40.13B, everything below
-- commits together or not at all.
-- ---------------------------------------------------------------------------
begin;

-- ---------------------------------------------------------------------------
-- 0. Preflight — the objects this authority depends on must already exist.
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.communication_provider_runtime_policies',
    'public.communication_provider_canary_destinations',
    'public.communication_provider_template_mappings'
  ] loop
    if to_regclass(v_sig) is null then
      raise exception 'QF-MVP-40 quiesce aborted: % is missing.', v_sig;
    end if;
  end loop;

  -- The 40.13B authority must still be present: quiesce is a SIBLING of those
  -- transitions, not a replacement, and the operator sequence depends on all of them.
  foreach v_sig in array array[
    'public.qf_arm_meta_provider_readiness_v1(text,text,text)',
    'public.qf_arm_meta_canary_v1(text,text,text,text,timestamptz,text)',
    'public.qf_disable_meta_canary_v1()'
  ] loop
    if to_regprocedure(v_sig) is null then
      raise exception 'QF-MVP-40 quiesce aborted: prerequisite % is missing.', v_sig;
    end if;
  end loop;

  -- Drift guard: if a function with this exact signature already exists, it was not
  -- created by this migration. Fail rather than silently redefine somebody else's
  -- authority under the same name.
  if to_regprocedure('public.qf_quiesce_meta_canary_v1()') is not null then
    raise exception
      'QF-MVP-40 quiesce aborted: public.qf_quiesce_meta_canary_v1() already exists.';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. The closure-only transition.
-- ---------------------------------------------------------------------------
create function public.qf_quiesce_meta_canary_v1()
returns table (
  prior_activation_status text,
  policy_activation_status text,
  policy_outbound_enabled boolean,
  policy_webhook_processing_enabled boolean,
  policy_health_check_enabled boolean,
  deactivated_mappings integer,
  deactivated_canary_destinations integer,
  active_mappings_remaining integer,
  active_canary_remaining integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  c_provider constant text := 'meta_whatsapp_cloud';
  c_channel  constant text := 'whatsapp';
  v_policy public.communication_provider_runtime_policies%rowtype;
  v_prior text;
  v_mappings integer := 0;
  v_canary integer := 0;
  v_active_mappings integer;
  v_active_canary integer;
begin
  -- 1. Lock the ONE policy row before reading its state, so the prior-state decision
  --    and the write cannot straddle a concurrent arm.
  select * into v_policy
    from public.communication_provider_runtime_policies
   where provider_key = c_provider and channel = c_channel
     for update;

  -- 2. A missing policy row is NOT created here. Quiesce de-escalates an existing
  --    posture; conjuring a row would be an opening act, and `webhook_processing_enabled`
  --    would be turned ON for an environment that never had it on.
  if v_policy.provider_key is null then
    raise exception 'QF_CANARY_QUIESCE_POLICY_MISSING' using errcode = 'P0001';
  end if;

  v_prior := v_policy.activation_status;

  -- 3. CLOSED PRIOR-STATE RULE.
  --
  --    Only two starting states are supported, and both are states in which webhook
  --    processing and health checks are ALREADY on — so this transition never has to
  --    turn either of them on, and therefore can never re-open a closed environment.
  --
  --      A. 'canary'          with webhook=true and health=true.
  --                           outbound may be true or already false: quiesce only ever
  --                           reduces authority, so an already-closed switch is fine.
  --      B. 'readiness_only'  already EXACTLY the readiness posture -> idempotent.
  --
  --    Everything else — including 'disabled' — is refused. DISABLED IS NEVER REOPENED.
  --    Abnormal posture recovery belongs to qf_disable_meta_canary_v1().
  if v_prior = 'canary' then
    if v_policy.webhook_processing_enabled is not true
       or v_policy.health_check_enabled is not true then
      raise exception 'QF_CANARY_QUIESCE_STATE_NOT_SUPPORTED' using errcode = 'P0001';
    end if;
  elsif v_prior = 'readiness_only' then
    if v_policy.outbound_enabled is not false
       or v_policy.webhook_processing_enabled is not true
       or v_policy.health_check_enabled is not true then
      raise exception 'QF_CANARY_QUIESCE_STATE_NOT_SUPPORTED' using errcode = 'P0001';
    end if;
  else
    raise exception 'QF_CANARY_QUIESCE_STATE_NOT_SUPPORTED' using errcode = 'P0001';
  end if;

  -- 4. Reduce the policy to the EXISTING readiness posture. `update ... where` only —
  --    there is deliberately no insert path in this function.
  update public.communication_provider_runtime_policies
     set activation_status = 'readiness_only',
         outbound_enabled = false,
         webhook_processing_enabled = true,
         health_check_enabled = true,
         updated_at = now()
   where provider_key = c_provider and channel = c_channel
  returning * into v_policy;

  -- 5. Remove every remaining send-enabling row. Both are pure reductions, so they run
  --    for the idempotent branch too: a stray active destination or mapping is extra
  --    send surface no matter which supported state we started from.
  with closed as (
    update public.communication_provider_canary_destinations
       set is_active = false,
           expires_at = least(coalesce(expires_at, now()), now()),
           updated_at = now()
     where provider_key = c_provider and channel = c_channel and is_active
     returning 1
  ) select count(*)::integer into v_canary from closed;

  with closed as (
    update public.communication_provider_template_mappings
       set is_active = false, updated_at = now()
     where provider_key = c_provider and channel = c_channel and is_active
     returning 1
  ) select count(*)::integer into v_mappings from closed;

  -- 6. The provider ACCOUNT table is deliberately NOT touched anywhere in this function.
  --    Readiness and the provider identity survive a quiesce — that is the whole point of
  --    the middle transition, and it is what lets the operator observe callbacks and then
  --    either re-arm or DISABLE. (The table is not named here on purpose: the
  --    self-verification below proves its absence from the function definition, and
  --    pg_get_functiondef includes comments.)

  select count(*)::integer into v_active_mappings
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel and is_active;
  select count(*)::integer into v_active_canary
    from public.communication_provider_canary_destinations
   where provider_key = c_provider and channel = c_channel and is_active;

  -- 7. Post-write invariants. Any failure rolls the whole transaction back.
  if v_policy.activation_status is distinct from 'readiness_only'
     or v_policy.outbound_enabled is not false
     or v_policy.webhook_processing_enabled is not true
     or v_policy.health_check_enabled is not true
     or v_active_mappings <> 0
     or v_active_canary <> 0 then
    raise exception 'QF_CANARY_QUIESCE_INCOMPLETE' using errcode = 'P0001';
  end if;

  return query
  select v_prior, v_policy.activation_status, v_policy.outbound_enabled,
         v_policy.webhook_processing_enabled, v_policy.health_check_enabled,
         v_mappings, v_canary, v_active_mappings, v_active_canary;
end;
$$;

comment on function public.qf_quiesce_meta_canary_v1() is
  'QF-MVP-40 closure-only canary de-escalation. Takes no argument and no attestation. '
  'Moves the Meta WhatsApp runtime policy from canary (or an already-exact readiness '
  'posture) down to the existing readiness posture — outbound OFF while webhook '
  'processing stays ON so late delivery callbacks are still accepted — and deactivates '
  'every active canary destination and template mapping. Refuses every other prior '
  'state, including disabled, which it can never reopen. Never writes '
  'communication_provider_accounts. Raises if any send-enabling surface remains.';

-- ---------------------------------------------------------------------------
-- 2. Privileges — service_role only, matching the 40.13B authority exactly.
--    No grant on the two switch tables is added or widened here.
-- ---------------------------------------------------------------------------
revoke all on function public.qf_quiesce_meta_canary_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.qf_quiesce_meta_canary_v1() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Self-verification — fail loud rather than ship a weakened authority.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_sig constant text := 'public.qf_quiesce_meta_canary_v1()';
  v_oid oid;
  v_def text;
  v_other text;
  v_role text;
  v_priv text;
begin
  v_oid := to_regprocedure(v_sig);
  if v_oid is null then
    raise exception 'QF-MVP-40 quiesce aborted: % is missing.', v_sig;
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
    raise exception 'QF-MVP-40 quiesce aborted: % is not SECURITY DEFINER.', v_sig;
  end if;
  if not (
    select array_to_string(coalesce(p.proconfig, array[]::text[]), ',')
             like '%search_path=pg_catalog, public, pg_temp%'
      from pg_proc p where p.oid = v_oid
  ) then
    raise exception 'QF-MVP-40 quiesce aborted: % lacks the pinned search_path.', v_sig;
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('authenticated', v_oid, 'execute')
     or has_function_privilege('public', v_oid, 'execute') then
    raise exception 'QF-MVP-40 quiesce aborted: % granted beyond service_role.', v_sig;
  end if;
  if not has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'QF-MVP-40 quiesce aborted: service_role cannot execute %.', v_sig;
  end if;

  select pg_get_functiondef(v_oid) into v_def;

  -- 3.1 It can never reach a sending posture.
  if v_def ~ 'activation_status\s*=\s*''active''' then
    raise exception 'QF-MVP-40 quiesce aborted: it assigns activation_status=active.';
  end if;
  if v_def ~ 'activation_status\s*=\s*''canary''' then
    raise exception 'QF-MVP-40 quiesce aborted: it assigns activation_status=canary.';
  end if;
  if v_def ~ 'outbound_enabled\s*=\s*true' then
    raise exception 'QF-MVP-40 quiesce aborted: it can enable outbound.';
  end if;

  -- 3.2 It assigns exactly the readiness posture.
  if v_def !~ 'activation_status\s*=\s*''readiness_only''' then
    raise exception 'QF-MVP-40 quiesce aborted: it does not assign the readiness posture.';
  end if;

  -- 3.3 It never writes the account table, and never inserts a policy row.
  if v_def ~ 'communication_provider_accounts' then
    raise exception 'QF-MVP-40 quiesce aborted: it writes communication_provider_accounts.';
  end if;
  if v_def ~* 'insert\s+into\s+public\.communication_provider_runtime_policies' then
    raise exception 'QF-MVP-40 quiesce aborted: it can create a runtime policy row.';
  end if;

  -- 3.4 It keeps its refusal of every unsupported prior state, disabled included.
  if v_def !~ 'QF_CANARY_QUIESCE_STATE_NOT_SUPPORTED'
     or v_def !~ 'QF_CANARY_QUIESCE_POLICY_MISSING'
     or v_def !~ 'QF_CANARY_QUIESCE_INCOMPLETE' then
    raise exception 'QF-MVP-40 quiesce aborted: a fail-closed guard was removed.';
  end if;

  -- 3.5 No provider/network operation may appear in SQL.
  if v_def ~* '(https?://|graph\.facebook|/messages|pg_net|http_post|http_get|dblink)' then
    raise exception 'QF-MVP-40 quiesce aborted: it contains a network/provider operation.';
  end if;

  -- 3.6 The historical authority is untouched: still present, still service_role-only.
  foreach v_other in array array[
    'public.qf_arm_meta_provider_readiness_v1(text,text,text)',
    'public.qf_arm_meta_canary_v1(text,text,text,text,timestamptz,text)',
    'public.qf_disable_meta_canary_v1()'
  ] loop
    if to_regprocedure(v_other) is null then
      raise exception 'QF-MVP-40 quiesce aborted: % disappeared.', v_other;
    end if;
    if has_function_privilege('anon', to_regprocedure(v_other), 'execute')
       or has_function_privilege('authenticated', to_regprocedure(v_other), 'execute') then
      raise exception 'QF-MVP-40 quiesce aborted: % was widened.', v_other;
    end if;
    if not has_function_privilege('service_role', to_regprocedure(v_other), 'execute') then
      raise exception 'QF-MVP-40 quiesce aborted: service_role lost execute on %.', v_other;
    end if;
  end loop;

  -- 3.7 Direct writes to the two switch tables remain revoked for EVERY client role.
  --
  --     This is a DRIFT DETECTOR, not a privilege redesign: it grants and revokes nothing,
  --     it only proves the boundary 40.13B established is still whole. The previous
  --     revision asserted four of the eighteen combinations while the comment claimed the
  --     complete boundary, so the claim outran the check. All 2 x 3 x 3 are now proven.
  foreach v_other in array array[
    'public.communication_provider_runtime_policies',
    'public.communication_provider_canary_destinations'
  ] loop
    foreach v_role in array array['service_role', 'anon', 'authenticated'] loop
      foreach v_priv in array array['insert', 'update', 'delete'] loop
        if has_table_privilege(v_role, v_other, v_priv) then
          raise exception
            'QF-MVP-40 quiesce aborted: % holds % on % — a direct write path was restored.',
            v_role, v_priv, v_other;
        end if;
      end loop;
    end loop;
  end loop;

  -- 3.8 The SELECT the operator legitimately needs is UNCHANGED, so this migration
  --     cannot have over-revoked while tightening the write boundary.
  foreach v_other in array array[
    'public.communication_provider_runtime_policies',
    'public.communication_provider_canary_destinations'
  ] loop
    if not has_table_privilege('service_role', v_other, 'select') then
      raise exception 'QF-MVP-40 quiesce aborted: service_role lost select on %.', v_other;
    end if;
  end loop;
end;
$verify$;

commit;
