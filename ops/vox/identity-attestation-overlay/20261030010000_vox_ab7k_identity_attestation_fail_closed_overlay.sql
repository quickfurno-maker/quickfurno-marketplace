-- AB7K identity/attestation FAIL-CLOSED OVERLAY. UNINSTALLED, source only.
-- Apply ONLY after the AB7F..AB7J candidates, in a disposable database first.
-- Lives outside ops/vox/sql-candidates so the pinned 30-file AB7K fingerprint is
-- untouched; a human release owner must decide how to pin/order it (see report).
-- It does NOT add an attestation writer and does NOT verify any signature.
--  1. AB7G/AB7H approval tables get an always-on trigger: no row can be written
--     by anyone until a reviewed writer replaces this guard.
--  2. RPCs that trust a caller-supplied Owner/operator UUID lose service_role.
--  3. service_role keeps SELECT only on every AB7F..AB7J ledger.
--  4. AB7J AAL2 checks become null-safe (a JWT without an aal claim is denied).
begin;
do $$
begin
 if to_regprocedure('public.qf_vox_ab7g_official_eod_publish_candidate_v1(uuid,uuid,uuid,uuid,text)') is null
  or to_regprocedure('public.qf_vox_ab7h_signed_operator_atomic_candidate_v1(uuid,text,uuid,bigint,text,text)') is null
  or to_regprocedure('public.qf_vox_ab7f_conversation_atomic_operator_candidate_v1(uuid,bigint,uuid,uuid,text)') is null
  or to_regprocedure('public.qf_vox_ab7f_staff_suspend_atomic_candidate_v1(uuid,uuid,uuid,uuid,uuid,uuid)') is null
  or to_regprocedure('public.qf_vox_ab7j_owner_propose_staff_suspend_v1(uuid,uuid,uuid,uuid,uuid,text)') is null
  or to_regprocedure('public.qf_vox_ab7j_tl_approve_staff_suspend_v1(uuid,text)') is null
 then raise exception 'AB7K_OVERLAY_REQUIRES_AB7F_TO_AB7J_CANDIDATES';end if;
end;
$$;

-- 1. No verified writer exists for AB7G/AB7H approvals: block every write path.
create function public.qf_vox_ab7k_attestation_writer_absent_v1()
returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'AB7K_VERIFIED_ATTESTATION_WRITER_NOT_INSTALLED';
end;
$$;
revoke all on function public.qf_vox_ab7k_attestation_writer_absent_v1()
 from public,anon,authenticated,service_role;
create trigger ab7k_no_verified_writer_row
 before insert or update or delete on public.vox_ab7g_eod_owner_approvals_candidate_v1
 for each row execute function public.qf_vox_ab7k_attestation_writer_absent_v1();
create trigger ab7k_no_verified_writer_stmt
 before truncate on public.vox_ab7g_eod_owner_approvals_candidate_v1
 for each statement execute function public.qf_vox_ab7k_attestation_writer_absent_v1();
create trigger ab7k_no_verified_writer_row
 before insert or update or delete on public.vox_ab7h_operator_review_candidate_v1
 for each row execute function public.qf_vox_ab7k_attestation_writer_absent_v1();
create trigger ab7k_no_verified_writer_stmt
 before truncate on public.vox_ab7h_operator_review_candidate_v1
 for each statement execute function public.qf_vox_ab7k_attestation_writer_absent_v1();
alter table public.vox_ab7g_eod_owner_approvals_candidate_v1
 enable always trigger ab7k_no_verified_writer_row;
alter table public.vox_ab7g_eod_owner_approvals_candidate_v1
 enable always trigger ab7k_no_verified_writer_stmt;
alter table public.vox_ab7h_operator_review_candidate_v1
 enable always trigger ab7k_no_verified_writer_row;
alter table public.vox_ab7h_operator_review_candidate_v1
 enable always trigger ab7k_no_verified_writer_stmt;

-- 2. These definer RPCs take the Owner/operator identity from the caller and
--    have no provable current-principal binding (service_role has no auth.uid).
revoke all on function public.qf_vox_ab7g_official_eod_publish_candidate_v1(
 uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.qf_vox_ab7h_signed_operator_atomic_candidate_v1(
 uuid,text,uuid,bigint,text,text) from public,anon,authenticated,service_role;
revoke all on function public.qf_vox_ab7f_conversation_atomic_operator_candidate_v1(
 uuid,bigint,uuid,uuid,text) from public,anon,authenticated,service_role;

-- 3. Ledgers: service_role is read-only (Supabase default privileges grant ALL).
revoke all on public.vox_ab7f_staff_suspend_receipts_candidate_v1
 from public,anon,authenticated,service_role;
revoke all on public.vox_ab7f_four_source_eod_candidate_v1
 from public,anon,authenticated,service_role;
revoke all on public.vox_ab7f_conversation_operator_receipts_candidate_v1
 from public,anon,authenticated,service_role;
revoke all on public.vox_ab7g_eod_owner_approvals_candidate_v1
 from public,anon,authenticated,service_role;
revoke all on public.vox_ab7g_eod_official_publications_candidate_v1
 from public,anon,authenticated,service_role;
revoke all on public.vox_ab7h_operator_review_candidate_v1
 from public,anon,authenticated,service_role;
revoke all on public.vox_ab7h_operator_atomic_receipts_candidate_v1
 from public,anon,authenticated,service_role;
revoke all on public.vox_ab7i_staff_suspend_approvals_candidate_v1
 from public,anon,authenticated,service_role;
revoke all on public.vox_ab7j_staff_suspend_intents_candidate_v1
 from public,anon,authenticated,service_role;
grant select on public.vox_ab7f_staff_suspend_receipts_candidate_v1 to service_role;
grant select on public.vox_ab7f_four_source_eod_candidate_v1 to service_role;
grant select on public.vox_ab7f_conversation_operator_receipts_candidate_v1 to service_role;
grant select on public.vox_ab7g_eod_owner_approvals_candidate_v1 to service_role;
grant select on public.vox_ab7g_eod_official_publications_candidate_v1 to service_role;
grant select on public.vox_ab7h_operator_review_candidate_v1 to service_role;
grant select on public.vox_ab7h_operator_atomic_receipts_candidate_v1 to service_role;
grant select on public.vox_ab7i_staff_suspend_approvals_candidate_v1 to service_role;

-- 4. AB7J: `(auth.jwt()->>'aal')<>'aal2'` is NULL when the claim is absent and
--    plpgsql IF treats NULL as false. Same bodies, null-safe principal checks.
create or replace function public.qf_vox_ab7j_owner_propose_staff_suspend_v1(
 p_nonce uuid,p_target uuid,p_reviewer uuid,p_team uuid,p_city uuid,p_digest text
) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid;actual_city uuid;
begin
 me:=auth.uid();
 if me is null or coalesce(auth.jwt()->>'role','')<>'authenticated' or
  coalesce(auth.jwt()->>'aal','')<>'aal2' or
  me::text is distinct from (auth.jwt()->>'sub') or
  p_nonce is null or p_target is null or p_reviewer is null or
  p_team is null or p_city is null or p_digest is null or
  p_digest !~ '^[a-f0-9]{64}$' or
  me=p_target or me=p_reviewer or p_reviewer=p_target then
  raise exception 'AB7J_SIGNED_OWNER_AAL2_AND_DISTINCT_REVIEWER_REQUIRED';end if;
 if not exists(select 1 from public.profiles p where p.id=me
  and p.role='admin' and p.is_active=true) then
  raise exception 'AB7J_OWNER_CURRENT_PROFILE_DENIED';end if;
 select t.city_id into actual_city from public.vox_staff_teams_v1 t
 where t.id=p_team and t.is_active=true;
 if actual_city is distinct from p_city then
  raise exception 'AB7J_ACTIVE_TEAM_CITY_REQUIRED';end if;
 if not exists(select 1 from public.vox_staff_memberships_v1 m
  where m.auth_user_id=p_target and m.team_id=p_team and m.is_active=true
  and m.revoked_at is null and m.staff_role not in ('team_leader','auditor')
  and m.expires_at>clock_timestamp()) then
  raise exception 'AB7J_CURRENT_SUSPENSION_TARGET_REQUIRED';end if;
 if not exists(select 1 from public.vox_staff_memberships_v1 m
  join public.profiles p on p.id=m.auth_user_id
  where m.auth_user_id=p_reviewer and m.team_id=p_team
  and m.staff_role='team_leader' and m.is_active=true
  and m.revoked_at is null and m.expires_at>clock_timestamp()
  and p.is_active=true and p.role is null) then
  raise exception 'AB7J_CURRENT_INDEPENDENT_TL_REQUIRED';end if;
 insert into public.vox_ab7j_staff_suspend_intents_candidate_v1(
  nonce,owner_id,reviewer_id,target_id,team_id,city_id,request_digest)
 values(p_nonce,me,p_reviewer,p_target,p_team,p_city,p_digest);
 return p_nonce;
end;
$$;
create or replace function public.qf_vox_ab7j_tl_approve_staff_suspend_v1(
 p_nonce uuid,p_digest text
) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid;req record;
begin
 me:=auth.uid();
 if me is null or coalesce(auth.jwt()->>'role','')<>'authenticated' or
  coalesce(auth.jwt()->>'aal','')<>'aal2' or
  me::text is distinct from (auth.jwt()->>'sub') or
  p_nonce is null or p_digest is null or
  p_digest !~ '^[a-f0-9]{64}$' then
  raise exception 'AB7J_TL_AAL2_REQUIRED';end if;
 select * into req from public.vox_ab7j_staff_suspend_intents_candidate_v1 x
 where x.nonce=p_nonce for update;
 if not found or req.reviewer_id<>me or req.owner_id=me or
  req.target_id=me or req.request_digest<>p_digest or
  req.expires_at<=clock_timestamp() then
  raise exception 'AB7J_INDEPENDENT_TL_INTENT_NOT_CURRENT';end if;
 if not exists(select 1 from public.vox_staff_memberships_v1 m
  join public.profiles p on p.id=m.auth_user_id
  join public.vox_staff_teams_v1 t on t.id=m.team_id
  where m.auth_user_id=me and m.team_id=req.team_id and
  m.staff_role='team_leader' and m.is_active=true and
  m.revoked_at is null and m.expires_at>clock_timestamp()
  and t.city_id=req.city_id and t.is_active=true
  and p.role is null and p.is_active=true) then
  raise exception 'AB7J_TL_CURRENT_MEMBERSHIP_REVOKED';end if;
 if not exists(select 1 from public.profiles p where p.id=req.owner_id
  and p.role='admin' and p.is_active=true) then
  raise exception 'AB7J_OWNER_REVOKED';end if;
 insert into public.vox_ab7i_staff_suspend_approvals_candidate_v1(
  nonce,target_id,owner_id,reviewer_id,team_id,city_id,
  signed_decision_digest,expires_at)
 values(req.nonce,req.target_id,req.owner_id,me,req.team_id,req.city_id,
  req.request_digest,req.expires_at);
 return req.nonce;
end;
$$;
revoke all on function public.qf_vox_ab7j_owner_propose_staff_suspend_v1(
 uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.qf_vox_ab7j_tl_approve_staff_suspend_v1(
 uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.qf_vox_ab7j_owner_propose_staff_suspend_v1(
 uuid,uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.qf_vox_ab7j_tl_approve_staff_suspend_v1(
 uuid,text) to authenticated;
commit;
