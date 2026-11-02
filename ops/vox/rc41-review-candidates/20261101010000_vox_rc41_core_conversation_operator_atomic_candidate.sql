-- VOX RC41 Track a-core: candidate ATOMIC Core conversation PAUSE_AI / TAKEOVER.
-- UNINSTALLED / DRAFT / RELEASE HOLD. DISPOSABLE PG17 proof only.
-- NOT a migration, NOT part of any pinned manifest, never applied by tooling.
-- Requires independent DBA/AppSec review before any managed installation.
--
-- One PostgreSQL transaction (the single RPC call) that, for ONE vendor
-- WhatsApp conversation:
--   1. takes the SAME D2-D destination advisory key ('dst|<hash>|whatsapp') first,
--      with a bounded lock_timeout (consent writers serialize against us);
--   2. locks the conversation FOR UPDATE and its vendor/service-zone/city FOR SHARE
--      and requires revision == expected (compare-and-set);
--   3. re-verifies current Staff authority under FOR SHARE locks: operations_manager
--      membership + active team in the vendor's city + active profile + vox_staff
--      auth principal, the independently TL-reviewed client_success capability chain
--      (request/decision/activation), and a live conversation object scope;
--   4. evaluates canonical transactional consent (communication_suppressions then
--      communication_preferences, FOR SHARE) with the D2-C precedence/integrity rules;
--   5. applies exact-nonce idempotency: an exact replay returns the stored immutable
--      receipt (gated by the same current authority), a conflicting nonce is denied;
--   6. writes conversation state + one HUMAN event + one immutable receipt, then
--      re-checks every time-limited grant with clock_timestamp() before returning.
-- Any failure raises, so the whole call rolls back: no partial state, no event.
--
-- NO provider send, outbox row, message, credit, opt-in, consent write, vendor write
-- and NO AB7B CORE_CONVERSATION source row. providerMessagesSent is a CHECK = 0.
--
-- TRUST BOUNDARY (review item): PostgreSQL cannot verify a GoTrue session. p_aal and
-- p_aal_expires_at are an ATTESTATION from the server-side verifier
-- (verifyVoxOperationsStaffBearer, remote Auth getUser + aal2 claim) and are only
-- honoured because EXECUTE is granted to service_role alone. This function checks
-- aal='aal2' and expiry here; it does not replace the verifier.
--
-- ISOLATION: must run READ COMMITTED (the PostgREST default). Under SERIALIZABLE or
-- REPEATABLE READ the snapshot would predate the destination lock (RC27), so the
-- function refuses to run.
--
-- ACL (review item): SECURITY DEFINER so service_role needs NO DML on the receipt
-- table. Install with a minimum-privilege non-superuser OWNER holding only:
--   SELECT,UPDATE on communication_conversations; INSERT on
--   communication_conversation_events; SELECT,INSERT on the receipt table;
--   SELECT,UPDATE (row-lock requirement of FOR SHARE) on vendors,
--   marketplace_service_zones, cities, vox_staff_* tables, profiles,
--   communication_suppressions, communication_preferences; SELECT,UPDATE on
--   auth.users (FOR SHARE only; no write is ever issued) -- reviewers may choose to
--   drop the auth.users lock and accept a metadata-revocation race instead.
-- The owner also needs BYPASSRLS (like service_role): every touched table has RLS
-- enabled without policies, and the receipt table is FORCE RLS.
-- Vendor subject only. Client conversations need the separate RC12 project binding
-- and are denied here (RC41_CONVERSATION_SCOPE_DENIED).
begin;
create table public.vox_rc41_core_conversation_operator_receipts_candidate_v1(
 nonce uuid primary key,
 conversation_id uuid not null references public.communication_conversations(id)
  on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 action text not null check(action in ('PAUSE_AI','TAKEOVER')),
 previous_revision bigint not null check(previous_revision>=0),
 new_revision bigint not null check(new_revision=previous_revision+1),
 event_id uuid not null unique references public.communication_conversation_events(id)
  on delete restrict,
 consent_scope text not null check(consent_scope='transactional'),
 consent_policy_version text not null check(consent_policy_version ~ '^[A-Za-z0-9._:-]{1,64}$'),
 consent_reason text not null check(consent_reason in (
  'transactional_no_consent_objection','preference_transactional_no_objection',
  'preference_policy_version_mismatch_no_objection')),
 receipt_sha256 text not null check(receipt_sha256 ~ '^[a-f0-9]{64}$'),
 provider_messages_sent integer not null default 0 check(provider_messages_sent=0),
 occurred_at timestamptz not null default clock_timestamp(),
 unique(conversation_id,new_revision)
);
create or replace function public.qf_vox_rc41_receipt_immutable_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'RC41_RECEIPT_IMMUTABLE'; end $$;
create trigger vox_rc41_receipt_immutable before update or delete
 on public.vox_rc41_core_conversation_operator_receipts_candidate_v1
 for each row execute function public.qf_vox_rc41_receipt_immutable_candidate_v1();
create trigger vox_rc41_receipt_no_truncate before truncate
 on public.vox_rc41_core_conversation_operator_receipts_candidate_v1
 for each statement execute function public.qf_vox_rc41_receipt_immutable_candidate_v1();
alter table public.vox_rc41_core_conversation_operator_receipts_candidate_v1
 enable row level security;
alter table public.vox_rc41_core_conversation_operator_receipts_candidate_v1
 force row level security;
revoke all on public.vox_rc41_core_conversation_operator_receipts_candidate_v1
 from public,anon,authenticated,service_role;
revoke all on function public.qf_vox_rc41_receipt_immutable_candidate_v1()
 from public,anon,authenticated,service_role;

create or replace function public.qf_vox_rc41_core_conversation_operator_atomic_candidate_v1(
 p_actor uuid,p_aal text,p_aal_expires_at timestamptz,p_conversation uuid,
 p_nonce uuid,p_expected_revision bigint,p_action text
)
returns table(nonce uuid,conversation_id uuid,action text,previous_revision bigint,
 new_revision bigint,state text,event_id uuid,consent_scope text,
 consent_policy_version text,consent_reason text,replayed boolean,
 receipt_sha256 text,provider_messages_sent integer)
language plpgsql security definer set search_path='' set lock_timeout='3000ms' as $$
#variable_conflict use_column
declare
 v_hash text;v_c record;v_r record;v_old record;
 v_city uuid;v_team uuid;v_scope uuid;v_cap uuid;v_tl uuid;
 v_n integer;v_g integer;v_s integer;v_blocked boolean;v_pref_n integer;
 v_reason text;v_target text;v_next bigint;v_event uuid;v_now timestamptz;v_receipt text;
 v_policy constant text:='qf-consent-v1';
begin
 if p_actor is null or p_conversation is null or p_nonce is null or
    p_expected_revision is null or p_aal is distinct from 'aal2' or
    p_aal_expires_at is null or p_action is null or
    p_action not in ('PAUSE_AI','TAKEOVER') or
    p_expected_revision<0 or p_expected_revision>2147483646
 then raise exception 'RC41_INPUT_DENIED';end if;
 if p_aal_expires_at<=clock_timestamp()
 then raise exception 'RC41_AAL2_EXPIRED';end if;
 if current_setting('transaction_isolation')<>'read committed'
 then raise exception 'RC41_READ_COMMITTED_REQUIRED';end if;
 v_target:=case p_action when 'TAKEOVER' then 'HUMAN' else 'PAUSED' end;
 -- (1) Unlocked read ONLY to learn the destination key; re-verified under lock below.
 select c.destination_hash into v_hash
  from public.communication_conversations c where c.id=p_conversation;
 if v_hash is null or v_hash !~ '^[a-f0-9]{64}$'
 then raise exception 'RC41_CONVERSATION_SCOPE_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended('dst|'||v_hash||'|whatsapp',0));
 -- (2) Conversation, then vendor/zone/city, locked in the D2-D / RC8 order.
 select c.id,c.tenant_id,c.channel,c.destination_hash,c.subject_type,c.subject_id,
  c.state,c.revision,c.assigned_actor,c.human_takeover into v_c
  from public.communication_conversations c where c.id=p_conversation for update;
 if not found or v_c.destination_hash<>v_hash or v_c.tenant_id<>'quickfurno' or
    v_c.channel<>'whatsapp' or v_c.subject_type<>'vendor' or v_c.subject_id is null
 then raise exception 'RC41_CONVERSATION_SCOPE_DENIED';end if;
 v_n:=0;
 for v_r in
  select geo.id from public.vendors v
   join public.marketplace_service_zones z on z.id=v.service_zone_id
   join public.cities geo on lower(btrim(geo.name))=lower(btrim(z.canonical_city))
   where v.id=v_c.subject_id and z.is_active=true and z.matching_enabled=true
    and geo.is_active=true
   for share of v,z,geo
 loop v_n:=v_n+1;v_city:=v_r.id;end loop;
 if v_n<>1 then raise exception 'RC41_CONVERSATION_SCOPE_DENIED';end if;
 -- (3) Current Staff authority (AAL2 attested above), team+city bound.
 v_n:=0;
 for v_r in
  select m.team_id from public.vox_staff_memberships_v1 m
   join public.vox_staff_teams_v1 t on t.id=m.team_id
   join public.profiles p on p.id=m.auth_user_id
   join auth.users u on u.id=m.auth_user_id
   where m.auth_user_id=p_actor and m.staff_role='operations_manager'
    and m.is_active=true and m.revoked_at is null
    and m.expires_at>clock_timestamp() and t.is_active=true
    and t.city_id=v_city and p.is_active=true and p.role is null
    and u.raw_app_meta_data->>'qf_principal'='vox_staff'
    and u.raw_app_meta_data->>'vox_role'='operations_manager'
    and u.raw_app_meta_data->>'admin_role' is null
   for share of m,t,p,u
 loop v_n:=v_n+1;v_team:=v_r.team_id;end loop;
 if v_n<>1 then raise exception 'RC41_STAFF_NOT_CURRENT';end if;
 -- A capability row alone grants NOTHING: the independent TL decision, request
 -- and activation must all be current and locked against concurrent revocation.
 v_n:=0;
 for v_r in
  select cap.id as cap_id,req.decided_by as reviewer_id
   from public.vox_staff_department_capabilities_v1 cap
   join public.vox_staff_department_requests_v1 req on req.id=cap.request_id
   join public.vox_staff_department_decisions_v1 d on d.request_id=req.id
   join public.vox_staff_department_activations_v1 x
    on x.request_id=req.id and x.capability_id=cap.id
   join public.profiles reviewer on reviewer.id=req.decided_by
   join auth.users reviewer_auth on reviewer_auth.id=reviewer.id
   join public.vox_staff_memberships_v1 tl on tl.auth_user_id=reviewer.id
   join public.vox_staff_teams_v1 rt on rt.id=tl.team_id
   where cap.auth_user_id=p_actor and cap.team_id=v_team and cap.city_id=v_city
    and cap.department='client_success' and cap.revoked_at is null
    and cap.revision=2 and cap.expires_at>clock_timestamp()
    and req.state='APPROVED' and req.revision=1
    and req.expires_at>clock_timestamp() and req.target_staff_id=p_actor
    and req.team_id=v_team and req.city_id=v_city
    and req.department='client_success'
    and req.decided_by<>req.requested_by and req.decided_by<>req.target_staff_id
    and d.reviewer_id=req.decided_by and d.decision='APPROVED'
    and d.decision_reference=req.decision_reference
    and x.activated_by=req.requested_by and cap.granted_by=req.requested_by
    and reviewer.role is null and reviewer.is_active=true
    and reviewer_auth.raw_app_meta_data->>'qf_principal'='vox_staff'
    and reviewer_auth.raw_app_meta_data->>'vox_role'='team_leader'
    and reviewer_auth.raw_app_meta_data->>'admin_role' is null
    and tl.staff_role='team_leader' and tl.is_active=true
    and tl.revoked_at is null and tl.expires_at>clock_timestamp()
    and rt.id=req.team_id and rt.city_id=req.city_id and rt.is_active=true
   for share of cap,req,d,x,reviewer,reviewer_auth,tl,rt
 loop v_n:=v_n+1;v_cap:=v_r.cap_id;v_tl:=v_r.reviewer_id;end loop;
 if v_n<>1 then raise exception 'RC41_DEPARTMENT_REVIEW_REQUIRED';end if;
 v_n:=0;
 for v_r in
  select s.id from public.vox_staff_object_scopes_v1 s
   where s.auth_user_id=p_actor and s.scope_kind='conversation'
    and s.object_id=p_conversation and s.revoked_at is null
    and s.expires_at>clock_timestamp()
   for share
 loop v_n:=v_n+1;v_scope:=v_r.id;end loop;
 if v_n<>1 then raise exception 'RC41_OBJECT_GRANT_REVOKED';end if;
 -- (5) Exact-nonce idempotency, AFTER authority and BEFORE revision/state/consent:
 -- a replay is a no-op that never re-evaluates (or writes) anything.
 select q.* into v_old
  from public.vox_rc41_core_conversation_operator_receipts_candidate_v1 q
  where q.nonce=p_nonce;
 if found then
  if v_old.actor_id<>p_actor or v_old.conversation_id<>p_conversation or
     v_old.action<>p_action or v_old.previous_revision<>p_expected_revision
  then raise exception 'RC41_NONCE_CONFLICT';end if;
  return query select v_old.nonce,v_old.conversation_id,v_old.action,
   v_old.previous_revision,v_old.new_revision,v_target,v_old.event_id,
   v_old.consent_scope,v_old.consent_policy_version,v_old.consent_reason,true,
   v_old.receipt_sha256,v_old.provider_messages_sent;
  return;
 end if;
 if v_c.revision<>p_expected_revision
 then raise exception 'RC41_REVISION_CONFLICT';end if;
 if v_c.human_takeover is distinct from false or
    v_c.assigned_actor not in ('ANISHA','AAROHI','RIYA') or
    (p_action='PAUSE_AI' and v_c.state<>'OPEN') or
    (p_action='TAKEOVER' and v_c.state not in ('OPEN','PAUSED'))
 then raise exception 'RC41_STATE_DENIED';end if;
 -- (4) Canonical same-transaction transactional consent (D2-C precedence).
 -- Validate EVERY row and detect duplicates before any block decision.
 v_g:=0;v_s:=0;v_blocked:=false;
 for v_r in
  select sp.scope,sp.reason,sp.policy_version,sp.is_active,sp.expires_at,
   sp.deactivated_at
   from public.communication_suppressions sp
   where sp.destination_hash=v_hash and sp.channel='whatsapp'
    and sp.is_active=true and sp.scope in ('global','transactional')
   for share
 loop
  if v_r.scope not in ('global','transactional') or
     v_r.reason not in ('unspecified','user_stop','provider_block','hard_bounce',
      'complaint','admin','legal','abuse') or
     v_r.policy_version !~ '^[A-Za-z0-9._:-]{1,64}$' or
     v_r.is_active is distinct from true or v_r.deactivated_at is not null
  then raise exception 'RC41_CONSENT_INTEGRITY';end if;
  if v_r.scope='global' then v_g:=v_g+1;else v_s:=v_s+1;end if;
  if v_r.expires_at is null or v_r.expires_at>clock_timestamp()
  then v_blocked:=true;end if;
 end loop;
 if v_g>1 or v_s>1 then raise exception 'RC41_CONSENT_INTEGRITY';end if;
 if v_blocked then raise exception 'RC41_CONSENT_DENIED';end if;
 v_pref_n:=0;v_reason:='transactional_no_consent_objection';
 for v_r in
  select pr.state,pr.policy_version,pr.consented_at,pr.withdrawn_at
   from public.communication_preferences pr
   where pr.principal_type='vendor' and pr.principal_id=v_c.subject_id
    and pr.channel='whatsapp' and pr.scope='transactional'
   for share
 loop
  v_pref_n:=v_pref_n+1;
  if v_r.state not in ('allowed','blocked') or
     v_r.policy_version !~ '^[A-Za-z0-9._:-]{1,64}$' or
     (v_r.state='allowed' and (v_r.consented_at is null or v_r.withdrawn_at is not null)) or
     (v_r.state='blocked' and (v_r.consented_at is not null or v_r.withdrawn_at is null))
  then raise exception 'RC41_CONSENT_INTEGRITY';end if;
  if v_r.state='blocked' then v_blocked:=true;end if;
  v_reason:=case when v_r.policy_version=v_policy
   then 'preference_transactional_no_objection'
   else 'preference_policy_version_mismatch_no_objection' end;
 end loop;
 if v_pref_n>1 then raise exception 'RC41_CONSENT_INTEGRITY';end if;
 if v_blocked then raise exception 'RC41_CONSENT_DENIED';end if;
 -- (6) Writes. Revision compare-and-set under the row lock already held.
 v_now:=clock_timestamp();v_next:=p_expected_revision+1;
 update public.communication_conversations c
  set state=v_target,
   assigned_actor=case when p_action='TAKEOVER' then 'HUMAN' else c.assigned_actor end,
   human_takeover=(p_action='TAKEOVER'),jarvis_enabled=false,revision=v_next,
   updated_at=v_now
  where c.id=p_conversation and c.revision=p_expected_revision;
 if not found then raise exception 'RC41_REVISION_CONFLICT';end if;
 insert into public.communication_conversation_events
  (conversation_id,event_type,actor_type,safe_summary,event_data)
  values(p_conversation,
   case when p_action='TAKEOVER' then 'human.takeover_started'
    else 'ai.paused_by_operator' end,
   'HUMAN','Core consent-bound Staff control; no provider send',
   jsonb_build_object('operatorUserId',p_actor,'revision',v_next,
    'nonce',p_nonce,'consentScope','transactional'))
  returning id into v_event;
 -- PostgreSQL's clock advanced while we held SHARE locks: a grant may cross its
 -- expiry boundary with no concurrent UPDATE. Re-check all of them now.
 perform 1
  from public.vox_staff_object_scopes_v1 os
  join public.vox_staff_memberships_v1 m on m.auth_user_id=os.auth_user_id
  join public.vox_staff_department_capabilities_v1 cap
   on cap.auth_user_id=m.auth_user_id and cap.team_id=m.team_id
  join public.vox_staff_department_requests_v1 req on req.id=cap.request_id
  join public.vox_staff_memberships_v1 tl
   on tl.auth_user_id=req.decided_by and tl.team_id=req.team_id
  join public.vox_staff_teams_v1 t on t.id=m.team_id
  where os.id=v_scope and cap.id=v_cap and tl.auth_user_id=v_tl
   and m.auth_user_id=p_actor and m.team_id=v_team and t.city_id=v_city
   and t.is_active=true and m.staff_role='operations_manager'
   and m.is_active=true and m.revoked_at is null and m.expires_at>clock_timestamp()
   and os.revoked_at is null and os.expires_at>clock_timestamp()
   and cap.revoked_at is null and cap.expires_at>clock_timestamp()
   and req.state='APPROVED' and req.expires_at>clock_timestamp()
   and tl.staff_role='team_leader' and tl.is_active=true and tl.revoked_at is null
   and tl.expires_at>clock_timestamp()
   and p_aal_expires_at>clock_timestamp();
 if not found then raise exception 'RC41_GRANT_EXPIRED_DURING_TRANSACTION';end if;
 v_receipt:=encode(sha256(convert_to(concat_ws('|','vox-rc41-core-conversation-operator-v1',
  p_nonce,p_conversation,p_actor,v_team,v_city,p_action,p_expected_revision,v_next,
  v_event,'transactional',v_policy,v_reason,
  (extract(epoch from v_now)*1000000)::bigint),'UTF8')),'hex');
 insert into public.vox_rc41_core_conversation_operator_receipts_candidate_v1
  (nonce,conversation_id,actor_id,team_id,city_id,action,previous_revision,new_revision,
   event_id,consent_scope,consent_policy_version,consent_reason,receipt_sha256,occurred_at)
  values(p_nonce,p_conversation,p_actor,v_team,v_city,p_action,p_expected_revision,v_next,
   v_event,'transactional',v_policy,v_reason,v_receipt,v_now);
 return query select p_nonce,p_conversation,p_action,p_expected_revision,v_next,
  v_target,v_event,'transactional'::text,v_policy,v_reason,false,v_receipt,0;
end;
$$;
revoke all on function public.qf_vox_rc41_core_conversation_operator_atomic_candidate_v1(
 uuid,text,timestamptz,uuid,uuid,bigint,text
) from public,anon,authenticated;
grant execute on function public.qf_vox_rc41_core_conversation_operator_atomic_candidate_v1(
 uuid,text,timestamptz,uuid,uuid,bigint,text
) to service_role;
commit;
