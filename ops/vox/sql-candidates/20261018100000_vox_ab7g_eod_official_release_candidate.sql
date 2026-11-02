-- AB7G OFFICIAL EOD: immutable approval attestation + publication receipt.
-- Uninstalled candidate: verified independent DBA/AppSec/Owner GO mandatory.
-- Access to approval_attestation table INSERT is NEVER granted service_role.
-- Core must verify pinned Ed25519 signatures before independent attestation.
begin;
create table public.vox_ab7g_eod_owner_approvals_candidate_v1(
 report_id uuid primary key references
  public.vox_ab7f_four_source_eod_candidate_v1(id) on delete restrict,
 owner_id uuid not null references public.profiles(id) on delete restrict,
 team_leader_id uuid not null references public.vox_staff_memberships_v1(auth_user_id)
  on delete restrict,
 digest text not null check(digest~'^[a-f0-9]{64}$'),
 verified_signature_digest text not null check(verified_signature_digest~'^[a-f0-9]{64}$'),
 reviewed_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 constraint ab7g_owner_not_tl check(owner_id<>team_leader_id),
 constraint ab7g_approval_fresh check(expires_at>reviewed_at
   and expires_at<=reviewed_at+interval '15 minutes')
);
create table public.vox_ab7g_eod_official_publications_candidate_v1(
 report_id uuid primary key references
  public.vox_ab7f_four_source_eod_candidate_v1(id) on delete restrict,
 nonce uuid not null unique,
 owner_id uuid not null references public.profiles(id) on delete restrict,
 team_leader_id uuid not null references public.vox_staff_memberships_v1(auth_user_id)
   on delete restrict,
 source_digest text not null check(source_digest~'^[a-f0-9]{64}$'),
 published_at timestamptz not null default clock_timestamp()
);
alter table public.vox_ab7g_eod_owner_approvals_candidate_v1 enable row level security;
alter table public.vox_ab7g_eod_owner_approvals_candidate_v1 force row level security;
alter table public.vox_ab7g_eod_official_publications_candidate_v1 enable row level security;
alter table public.vox_ab7g_eod_official_publications_candidate_v1 force row level security;
revoke all on public.vox_ab7g_eod_owner_approvals_candidate_v1
 from public,anon,authenticated,service_role;
revoke all on public.vox_ab7g_eod_official_publications_candidate_v1
 from public,anon,authenticated,service_role;
grant select on public.vox_ab7g_eod_owner_approvals_candidate_v1 to service_role;
grant select on public.vox_ab7g_eod_official_publications_candidate_v1 to service_role;
create function public.qf_vox_ab7g_official_eod_publish_candidate_v1(
 p_report uuid,p_owner uuid,p_tl uuid,p_nonce uuid,p_source_digest text
) returns table(publication_report_id uuid,receipt_nonce uuid,
 publication_state text,source_sha256 text)
language plpgsql security definer set search_path='' as $$
declare r record; a record;
begin
 if p_report is null or p_owner is null or p_tl is null or
  p_nonce is null or p_source_digest !~ '^[a-f0-9]{64}$' or
  p_owner=p_tl then raise exception 'AB7G_INVALID_OWNER_RELEASE';end if;
 select id,staff_id,team_id,city_id,reviewer_id,source_count,source_digest,
  state,published into r from public.vox_ab7f_four_source_eod_candidate_v1
  where id=p_report for update;
 if not found or r.staff_id in (p_owner,p_tl) or
  r.reviewer_id<>p_tl or r.source_count<>4 or
  r.source_digest<>p_source_digest or r.published is distinct from false or
  r.state<>'TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE'
 then raise exception 'AB7G_UNREVIEWED_EOD_REPORT';end if;
 if not exists(select 1 from public.profiles p where p.id=p_owner
  and p.role='admin' and p.is_active=true) then
  raise exception 'AB7G_CURRENT_OWNER_REQUIRED';end if;
 if not exists(select 1 from public.vox_staff_memberships_v1 m
  join public.profiles p on p.id=m.auth_user_id
  where m.auth_user_id=p_tl and m.team_id=r.team_id and m.is_active=true
  and m.staff_role='team_leader' and m.revoked_at is null and
  m.expires_at>clock_timestamp() and p.is_active=true and p.role is null)
 then raise exception 'AB7G_CURRENT_INDEPENDENT_TL_REQUIRED';end if;
 select owner_id,team_leader_id,digest,verified_signature_digest,
  expires_at into a from public.vox_ab7g_eod_owner_approvals_candidate_v1
  where report_id=p_report for update;
 if not found or a.owner_id<>p_owner or a.team_leader_id<>p_tl or
  a.digest<>p_source_digest or a.expires_at<=clock_timestamp() or
  a.verified_signature_digest !~ '^[a-f0-9]{64}$' then
  raise exception 'AB7G_VERIFIED_APPROVAL_ATTESTATION_MISSING';end if;
 insert into public.vox_ab7g_eod_official_publications_candidate_v1(
 report_id,nonce,owner_id,team_leader_id,source_digest)
 values(p_report,p_nonce,p_owner,p_tl,p_source_digest);
 return query select p_report,p_nonce,
  'OFFICIALLY_RELEASED_BY_OWNER'::text,p_source_digest;
end;
$$;
revoke all on function public.qf_vox_ab7g_official_eod_publish_candidate_v1(
 uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.qf_vox_ab7g_official_eod_publish_candidate_v1(
 uuid,uuid,uuid,uuid,text) to service_role;
commit;
