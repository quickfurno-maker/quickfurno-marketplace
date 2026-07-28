-- ============================================================================
-- QF-MVP-30.5A — VENDOR CAMPAIGN EXECUTION HANDOFF FOUNDATION
--
-- WHAT THIS ADDS
--   1. communication_intents.aggregate_type gains 'vendor_campaign' — the change
--      QF-MVP-30.4A deliberately deferred (owner decision 4) and named 30.5 as
--      the owner of. Every existing value is preserved.
--   2. vendor_campaign_events.event_type gains 'execution_handoff'.
--   3. public.communication_frequency_policies — the Core-owned frequency
--      authority that migration 1300 (owner decision 6) required 30.5 to define.
--      It ships EMPTY. No duration and no count is invented here.
--   4. public.qf_handoff_vendor_campaign_intents_v1 — one narrow service-role
--      SECURITY DEFINER RPC that turns an APPROVED, still-current frozen
--      audience into provider-neutral communication intents.
--
-- WHAT THIS DOES NOT DO
--   Sends nothing. Calls no provider, no Meta, no WhatsApp, no n8n, no email,
--   no SMS, no webhook. Sets no provider message id. Claims no delivery. Enables
--   no outbound flag. Creates no canary. Creates no delivery/dispatch table.
--   QF-MVP-40 owns Meta transport; QF-MVP-50 owns n8n execution workflows.
--
-- APPROVAL IS NOT PERMISSION TO SEND
--   Approval authorises an audience at approval time. This function re-proves,
--   at handoff time and under the same locks, that:
--     * the campaign is still 'approved';
--     * the frozen snapshot still hashes to its recorded fingerprint;
--     * the segment evidence still matches;
--     * the template still recomputes to its pinned fingerprint;
--     * an explicit frequency policy exists and passes;
--     * each recipient is STILL consented and STILL not suppressed.
--   Any failure returns a deterministic code with ZERO intents inserted.
--
-- FAIL CLOSED ON DRIFT
--   No "if not exists" on the new table or the new constraints, and no
--   exception-swallowing DO block around them.
--
-- ROLLBACK BOUNDARY
--   Reversible while communication_frequency_policies is empty and no
--   'vendor_campaign' intent exists:
--     drop function public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text);
--     drop table public.communication_frequency_policies;
--     -- then restore the two widened check constraints to their prior values.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. aggregate_type — COMPATIBLE widening
-- ---------------------------------------------------------------------------
-- 'vendor_campaign' matches the aggregate table name (public.vendor_campaigns)
-- exactly as 'lead_assignment' matches public.lead_assignments. No existing
-- value is renamed, reordered or removed.
alter table public.communication_intents
  drop constraint communication_intents_aggregate_type_check;

alter table public.communication_intents
  add constraint communication_intents_aggregate_type_check
  check (aggregate_type = any (array[
    'lead_assignment','replacement','credit_restoration','lead','vendor_campaign'
  ]));

-- ---------------------------------------------------------------------------
-- 2. campaign event vocabulary — COMPATIBLE widening
-- ---------------------------------------------------------------------------
alter table public.vendor_campaign_events
  drop constraint vce_event_type_check;

alter table public.vendor_campaign_events
  add constraint vce_event_type_check
  check (event_type in (
    'created','updated','prepared','returned_to_draft','approved','cancelled',
    'archived','execution_handoff'
  ));

-- ---------------------------------------------------------------------------
-- 3. communication_frequency_policies — Core-owned, EXPLICIT, UNSEEDED
-- ---------------------------------------------------------------------------
-- Migration 1300 recorded that "no frequency-cap authority exists anywhere in
-- this codebase" and required 30.5 to define a minimal fail-closed rule. No
-- business number is chosen here: the table ships EMPTY and the RPC returns
-- FREQUENCY_POLICY_NOT_CONFIGURED until an operator inserts an explicit,
-- auditable row. Zero intents may be created while it is empty.
--
-- It lives in its own table on purpose: 1300 check 9.7 forbids frequency_cap /
-- frequency_policy columns on the campaign tables.
create table public.communication_frequency_policies (
  id                 uuid        primary key default gen_random_uuid(),
  channel            text        not null,
  scope              text        not null,
  -- Minimum gap between two intents for the same recipient on this channel.
  min_interval       interval    not null,
  -- At most max_per_window intents per recipient within window_length.
  max_per_window     integer     not null,
  window_length      interval    not null,
  is_active          boolean     not null default true,
  effective_from     timestamptz not null default now(),
  effective_to       timestamptz,
  -- Bounded, auditable provenance. Never PII.
  policy_reference   text        not null,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint cfp_channel_check check (channel = any (array['whatsapp','sms','email','dashboard'])),
  constraint cfp_scope_check   check (scope   = any (array['transactional','marketing'])),
  -- Bounds keep an operator typo from becoming an unbounded or nonsensical rule.
  constraint cfp_min_interval_check   check (min_interval   >= interval '0 second'
                                         and min_interval   <= interval '365 days'),
  constraint cfp_window_length_check  check (window_length  >  interval '0 second'
                                         and window_length  <= interval '365 days'),
  constraint cfp_max_per_window_check check (max_per_window >= 0 and max_per_window <= 1000),
  constraint cfp_effective_range_check check (effective_to is null or effective_to > effective_from),
  constraint cfp_policy_reference_check check (char_length(policy_reference) between 3 and 200),
  constraint cfp_created_by_fk foreign key (created_by)
    references public.profiles (id) on update restrict on delete set null
);

-- At most ONE active policy per (channel, scope): the gate must never have to
-- choose between two competing rules.
create unique index uq_communication_frequency_policies_active
  on public.communication_frequency_policies (channel, scope)
  where is_active;

comment on table public.communication_frequency_policies is
  'QF-MVP-30.5A: Core-owned communication frequency authority. Ships EMPTY — no duration or count is seeded. While no active policy exists for a (channel, scope), qf_handoff_vendor_campaign_intents_v1 returns FREQUENCY_POLICY_NOT_CONFIGURED and creates zero intents. Service-role/admin controlled; no public or admin UI in 30.5A.';

alter table public.communication_frequency_policies enable row level security;

-- ---------------------------------------------------------------------------
-- 4. qf_handoff_vendor_campaign_intents_v1 — the canonical handoff authority
-- ---------------------------------------------------------------------------
create or replace function public.qf_handoff_vendor_campaign_intents_v1(
  p_campaign_id       uuid,
  p_expected_revision integer,
  p_actor_id          uuid,
  p_batch_limit       integer,
  p_idempotency_key   text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_campaign     public.vendor_campaigns%rowtype;
  v_segment      public.vendor_segments%rowtype;
  v_template     public.communication_templates%rowtype;
  v_policy       public.communication_frequency_policies%rowtype;
  v_snap_actual  text;
  v_tmpl_actual  text;
  v_members      integer;
  v_limit        integer;
  v_member       record;
  v_phone        text;
  v_dest_hash    text;
  v_pref_state   text;
  v_suppressed   boolean;
  v_recent       integer;
  v_last_at      timestamptz;
  v_key          text;
  v_intent_id    uuid;
  v_considered   integer := 0;
  v_created      integer := 0;
  v_existing     integer := 0;
  v_skip_consent integer := 0;
  v_skip_suppr   integer := 0;
  v_skip_freq    integer := 0;
  v_skip_dest    integer := 0;
begin
  -- ---- bounded input -------------------------------------------------------
  if p_campaign_id is null or p_expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8
     or char_length(p_idempotency_key) > 200 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  v_limit := coalesce(p_batch_limit, 100);
  if v_limit < 1 or v_limit > 500 then
    return jsonb_build_object('ok', false, 'code', 'BATCH_LIMIT_OUT_OF_RANGE');
  end if;

  -- ---- LOCK ORDER 1 of 3 — the campaign head -------------------------------
  -- Identical order to prepare and approve (campaign -> segment -> template),
  -- so handoff can never deadlock against either.
  select * into v_campaign from public.vendor_campaigns
   where id = p_campaign_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CAMPAIGN_NOT_FOUND');
  end if;

  -- Only an APPROVED campaign may hand off. draft / ready_for_review /
  -- cancelled / archived are all refused, with cancelled and archived named
  -- explicitly so an operator sees why.
  if v_campaign.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'code', 'CAMPAIGN_CANCELLED');
  end if;
  if v_campaign.status = 'archived' then
    return jsonb_build_object('ok', false, 'code', 'CAMPAIGN_ARCHIVED');
  end if;
  if v_campaign.status <> 'approved' then
    return jsonb_build_object('ok', false, 'code', 'CAMPAIGN_NOT_APPROVED');
  end if;
  if v_campaign.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'REVISION_MISMATCH');
  end if;

  if v_campaign.prepared_snapshot_id is null
     or v_campaign.prepared_snapshot_revision is null
     or v_campaign.prepared_recipient_count is null
     or v_campaign.snapshot_fingerprint is null
     or v_campaign.prepared_segment_fingerprint is null
     or v_campaign.prepared_template_version is null
     or v_campaign.prepared_template_fingerprint is null then
    return jsonb_build_object('ok', false, 'code', 'PREPARED_EVIDENCE_INCOMPLETE');
  end if;

  -- ---- LOCK ORDER 2 of 3 — the source SEGMENT row --------------------------
  -- FOR SHARE, exactly as approve: it conflicts with FOR NO KEY UPDATE and
  -- FOR UPDATE, so no concurrent UPDATE/DELETE of this evidence can interleave
  -- between the recheck below and this transaction's commit.
  select * into v_segment from public.vendor_segments
   where id = v_campaign.segment_id for share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SEGMENT_MISSING');
  end if;

  -- ---- LOCK ORDER 3 of 3 — the source TEMPLATE row -------------------------
  select * into v_template from public.communication_templates
   where template_key = v_campaign.template_key for share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_MISSING');
  end if;

  -- ---- send-time evidence recheck -----------------------------------------
  -- (a) the frozen snapshot must still hash to its recorded fingerprint. This
  --     RECOMPUTES from the immutable audience rows via the canonical function.
  v_snap_actual := public.qf_campaign_snapshot_fingerprint_v1(
                     p_campaign_id, v_campaign.prepared_snapshot_id,
                     v_campaign.prepared_snapshot_revision);
  if v_snap_actual is null then
    return jsonb_build_object('ok', false, 'code', 'SNAPSHOT_ORDINAL_INVALID');
  end if;
  if v_snap_actual <> v_campaign.snapshot_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'SNAPSHOT_FINGERPRINT_MISMATCH');
  end if;

  select count(*) into v_members
    from public.vendor_campaign_audience_members m
   where m.campaign_id = p_campaign_id
     and m.snapshot_id = v_campaign.prepared_snapshot_id
     and m.snapshot_revision = v_campaign.prepared_snapshot_revision;
  if v_members <> v_campaign.prepared_recipient_count then
    return jsonb_build_object('ok', false, 'code', 'SNAPSHOT_COUNT_MISMATCH');
  end if;

  -- (b) SEGMENT evidence. There is deliberately NO database function that
  --     recomputes a segment definition fingerprint: vendor_segments
  --     .definition_fingerprint is produced by the segment service, which is the
  --     single canonicaliser. Re-deriving it here would be a SECOND
  --     canonicalisation that could silently disagree, so this compares the
  --     stored evidence under the FOR SHARE lock — byte-identical to the check
  --     qf_approve_vendor_campaign_v1 already performs.
  if v_segment.status = 'archived' then
    return jsonb_build_object('ok', false, 'code', 'SEGMENT_ARCHIVED');
  end if;
  if v_segment.definition_version is distinct from v_campaign.prepared_segment_version
     or v_segment.definition_fingerprint is distinct from v_campaign.prepared_segment_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'SEGMENT_EVIDENCE_MISMATCH');
  end if;

  -- (c) TEMPLATE evidence, RECOMPUTED from the authoritative catalog row.
  if v_template.is_active is not true or v_template.readiness_status = 'disabled' then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_NOT_USABLE');
  end if;
  if v_template.version is distinct from v_campaign.prepared_template_version then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_VERSION_MISMATCH');
  end if;
  if v_campaign.consent_scope = 'marketing' and v_template.category <> 'marketing' then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_CATEGORY_MISMATCH');
  end if;
  v_tmpl_actual := public.qf_communication_template_fingerprint_v1(v_campaign.template_key);
  if v_tmpl_actual is null then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_FINGERPRINT_UNAVAILABLE');
  end if;
  if v_tmpl_actual <> v_campaign.prepared_template_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_FINGERPRINT_MISMATCH');
  end if;

  -- ---- frequency policy gate — BEFORE any insert ---------------------------
  select * into v_policy from public.communication_frequency_policies
   where channel = v_campaign.channel
     and scope   = v_campaign.consent_scope
     and is_active
     and effective_from <= now()
     and (effective_to is null or effective_to > now());
  if not found then
    return jsonb_build_object(
      'ok', false, 'code', 'FREQUENCY_POLICY_NOT_CONFIGURED',
      'channel', v_campaign.channel, 'scope', v_campaign.consent_scope,
      'created', 0);
  end if;

  -- ---- bounded batch over the IMMUTABLE frozen audience --------------------
  for v_member in
    select m.vendor_id, m.ordinal
      from public.vendor_campaign_audience_members m
     where m.campaign_id = p_campaign_id
       and m.snapshot_id = v_campaign.prepared_snapshot_id
       and m.snapshot_revision = v_campaign.prepared_snapshot_revision
     order by m.ordinal
     limit v_limit
  loop
    v_considered := v_considered + 1;

    -- Destination identity. vendors.phone must ALREADY be canonical E.164;
    -- lib/communication/phone.ts normalizes such a value to itself, so
    -- sha256(phone) here is byte-identical to hashPhoneE164(phone) there.
    -- Anything not already canonical is EXCLUDED rather than normalized by a
    -- second implementation that could disagree and make a suppressed
    -- destination look eligible.
    select v.phone into v_phone from public.vendors v where v.id = v_member.vendor_id;
    if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
      v_skip_dest := v_skip_dest + 1;
      continue;
    end if;
    v_dest_hash := encode(sha256(convert_to(v_phone, 'UTF8')), 'hex');

    -- CONSENT recheck at handoff time. Approval is not permission to send.
    select p.state into v_pref_state
      from public.communication_preferences p
     where p.principal_type = 'vendor'
       and p.principal_id   = v_member.vendor_id
       and p.channel        = v_campaign.channel
       and p.scope          = v_campaign.consent_scope;

    if v_campaign.consent_scope = 'marketing' then
      -- Marketing requires an explicit, current opt-in.
      if v_pref_state is distinct from 'allowed' then
        v_skip_consent := v_skip_consent + 1;
        continue;
      end if;
    else
      -- Transactional: absence is not objection, but an explicit block is final.
      if v_pref_state = 'blocked' then
        v_skip_consent := v_skip_consent + 1;
        continue;
      end if;
    end if;

    -- SUPPRESSION recheck. A global suppression outranks every scope, and STOP
    -- is never bypassed.
    select exists (
      select 1 from public.communication_suppressions s
       where s.destination_hash = v_dest_hash
         and s.channel = v_campaign.channel
         and s.scope in (v_campaign.consent_scope, 'global')
         and s.is_active
         and (s.expires_at is null or s.expires_at > now())
    ) into v_suppressed;
    if v_suppressed then
      v_skip_suppr := v_skip_suppr + 1;
      continue;
    end if;

    -- FREQUENCY gate, evaluated per recipient against the explicit policy.
    v_key := 'vendor_campaign_handoff:' || p_campaign_id::text || ':'
             || v_member.vendor_id::text || ':' || v_campaign.channel;

    select count(*), max(i.created_at) into v_recent, v_last_at
      from public.communication_intents i
     where i.recipient_ref = encode(sha256(('vendor:' || v_member.vendor_id::text)::bytea), 'hex')
       and i.channel = v_campaign.channel
       and i.idempotency_key <> v_key
       and i.created_at > now() - v_policy.window_length;

    if v_recent >= v_policy.max_per_window
       or (v_last_at is not null and v_last_at > now() - v_policy.min_interval) then
      v_skip_freq := v_skip_freq + 1;
      continue;
    end if;

    -- PROVIDER-NEUTRAL intent. recipient_ref is an opaque sha256 reference, not
    -- a destination. No provider, no message id, no delivery claim.
    insert into public.communication_intents (
      aggregate_type, aggregate_id, channel, template_purpose,
      recipient_ref, payload_ref, idempotency_key, status)
    values (
      'vendor_campaign', p_campaign_id, v_campaign.channel, v_campaign.template_key,
      encode(sha256(('vendor:' || v_member.vendor_id::text)::bytea), 'hex'),
      jsonb_build_object(
        'campaign_id', p_campaign_id,
        'snapshot_id', v_campaign.prepared_snapshot_id,
        'snapshot_revision', v_campaign.prepared_snapshot_revision,
        'template_key', v_campaign.template_key,
        'template_version', v_campaign.prepared_template_version,
        'consent_scope', v_campaign.consent_scope),
      v_key,
      'pending')
    on conflict (idempotency_key) do nothing
    returning id into v_intent_id;

    if v_intent_id is null then
      -- The unique index already held this recipient-channel identity: a replay,
      -- not a duplicate. Deterministic count, no second row.
      v_existing := v_existing + 1;
    else
      v_created := v_created + 1;
    end if;
    v_intent_id := null;
  end loop;

  -- ---- bounded, non-PII audit evidence ------------------------------------
  insert into public.vendor_campaign_events (
    campaign_id, event_type, campaign_revision, snapshot_id, snapshot_revision,
    actor_id, reason_code, metadata, event_idempotency_key)
  values (
    p_campaign_id, 'execution_handoff', v_campaign.revision,
    v_campaign.prepared_snapshot_id, v_campaign.prepared_snapshot_revision,
    p_actor_id, 'execution_handoff',
    jsonb_build_object(
      'considered', v_considered, 'created', v_created, 'existing', v_existing,
      'skipped_consent', v_skip_consent, 'skipped_suppressed', v_skip_suppr,
      'skipped_frequency', v_skip_freq, 'skipped_destination', v_skip_dest,
      'batch_limit', v_limit),
    'campaign_handoff:' || p_campaign_id::text || ':' || p_idempotency_key)
  on conflict (event_idempotency_key) do nothing;

  return jsonb_build_object(
    'ok', true, 'code', 'HANDOFF_COMPLETE',
    'considered', v_considered, 'created', v_created, 'existing', v_existing,
    'skipped_consent', v_skip_consent, 'skipped_suppressed', v_skip_suppr,
    'skipped_frequency', v_skip_freq, 'skipped_destination', v_skip_dest,
    'batch_limit', v_limit);
end;
$$;

comment on function public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text) is
  'QF-MVP-30.5A: creates provider-neutral communication intents from an APPROVED campaign''s immutable frozen audience. Re-proves snapshot/segment/template evidence under the campaign->segment->template lock order, requires an explicit active frequency policy, and rechecks consent and suppression per recipient at handoff time. Sends nothing and calls no provider. Zero intents on any evidence or policy failure.';

-- ---------------------------------------------------------------------------
-- 5. Privileges — fail closed
-- ---------------------------------------------------------------------------
revoke all on function public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text) from public;
revoke all on function public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text) from anon;
revoke all on function public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text) from authenticated;
grant execute on function public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text) to service_role;

revoke all on table public.communication_frequency_policies from public;
revoke all on table public.communication_frequency_policies from anon;
revoke all on table public.communication_frequency_policies from authenticated;
grant select, insert, update on table public.communication_frequency_policies to service_role;

-- ---------------------------------------------------------------------------
-- 6. Self-verification — the delivered shape, asserted
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_def text;
  v_n   integer;
begin
  -- 6.1 aggregate_type widened WITHOUT losing any legacy value.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.communication_intents')
     and c.conname  = 'communication_intents_aggregate_type_check';
  if v_def is null then
    raise exception 'QF-MVP-30.5A aborted: aggregate_type check constraint is missing.';
  end if;
  if v_def not like '%vendor_campaign%' then
    raise exception 'QF-MVP-30.5A aborted: aggregate_type was not widened.';
  end if;
  if v_def not like '%lead_assignment%' or v_def not like '%replacement%'
     or v_def not like '%credit_restoration%' or v_def not like '%''lead''%' then
    raise exception 'QF-MVP-30.5A aborted: aggregate_type widening dropped a legacy value (%).', v_def;
  end if;

  -- 6.2 campaign event vocabulary widened, legacy values preserved.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.vendor_campaign_events')
     and c.conname  = 'vce_event_type_check';
  if v_def not like '%execution_handoff%' or v_def not like '%approved%'
     or v_def not like '%prepared%' or v_def not like '%archived%' then
    raise exception 'QF-MVP-30.5A aborted: campaign event vocabulary is wrong (%).', v_def;
  end if;

  -- 6.3 the frequency policy table ships EMPTY. No business number is seeded.
  select count(*) into v_n from public.communication_frequency_policies;
  if v_n <> 0 then
    raise exception 'QF-MVP-30.5A aborted: a frequency policy was seeded (% row(s)); the value is an owner decision.', v_n;
  end if;

  -- 6.4 the RPC exists, is SECURITY DEFINER and has a fixed search_path.
  select count(*) into v_n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'qf_handoff_vendor_campaign_intents_v1'
     and p.prosecdef
     and array_to_string(coalesce(p.proconfig, array[]::text[]), ',') like '%search_path=%';
  if v_n <> 1 then
    raise exception 'QF-MVP-30.5A aborted: handoff RPC is missing, not SECURITY DEFINER, or has no fixed search_path.';
  end if;

  -- 6.5 execute is fail-closed for every untrusted role.
  if has_function_privilege('anon',
       'public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)', 'execute')
     or has_function_privilege('authenticated',
       'public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)', 'execute') then
    raise exception 'QF-MVP-30.5A aborted: handoff RPC is executable by anon/authenticated.';
  end if;
  if not has_function_privilege('service_role',
       'public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)', 'execute') then
    raise exception 'QF-MVP-30.5A aborted: service_role cannot execute the handoff RPC.';
  end if;

  -- 6.6 NO provider/delivery/dispatch object was created.
  if to_regclass('public.vendor_campaign_deliveries') is not null
     or to_regclass('public.vendor_campaign_dispatches') is not null
     or to_regclass('public.vendor_campaign_providers') is not null then
    raise exception 'QF-MVP-30.5A aborted: a provider/delivery object exists (out of 30.5A scope).';
  end if;

  -- 6.7 the canonical fingerprint functions this RPC depends on still exist.
  if to_regprocedure('public.qf_campaign_snapshot_fingerprint_v1(uuid,uuid,integer)') is null
     or to_regprocedure('public.qf_communication_template_fingerprint_v1(text)') is null then
    raise exception 'QF-MVP-30.5A aborted: a canonical fingerprint function is missing.';
  end if;

  -- 6.8 only ONE active policy per (channel, scope) is representable.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'uq_communication_frequency_policies_active') then
    raise exception 'QF-MVP-30.5A aborted: the single-active-policy index is missing.';
  end if;
end;
$verify$;

commit;
