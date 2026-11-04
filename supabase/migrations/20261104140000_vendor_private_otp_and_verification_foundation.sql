-- QuickFurno vendor mobile OTP purpose and private verification evidence.
-- SOURCE-ONLY / DRAFT PR 484. NO REMOTE APPLY OR PRODUCTION AUTHORIZATION.
-- Must pass schema/role/DDL review and isolated PostgreSQL rehearsal before Staging.
begin;

create schema if not exists qf_vendor_private;
revoke all on schema qf_vendor_private from public, anon, authenticated;
grant usage on schema qf_vendor_private to service_role;

-- Shared collision authority for CLIENT and VENDOR requests through ONE Supabase
-- Send SMS Auth Hook. Phone is represented only as a server HMAC-SHA256 digest;
-- browser code must NEVER be allowed to select or forge a purpose.
create table if not exists qf_vendor_private.auth_otp_purpose_reservations (
  phone_digest text primary key check (phone_digest ~ '^[0-9a-f]{64}$'),
  purpose text not null check (purpose in ('client_login','vendor_login')),
  reservation_id uuid not null unique,
  state text not null default 'reserved'
    check (state in ('reserved','claimed')),
  auth_user_id uuid references auth.users(id) on delete set null,
  verified_webhook_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint auth_otp_purpose_expiry_order check (expires_at > created_at),
  constraint auth_otp_claim_binding check (
    (state='reserved' and auth_user_id is null and verified_webhook_id is null)
    or (state='claimed' and auth_user_id is not null and nullif(verified_webhook_id,'') is not null)
  )
);
create index if not exists idx_auth_otp_purpose_expiry
  on qf_vendor_private.auth_otp_purpose_reservations(expires_at);

-- Atomic lease/reservation: only one active purpose can own a phone digest.
-- The existing client request flow MUST enroll before the hook can route vendors.
create or replace function public.qf_reserve_auth_otp_purpose(
  p_phone_digest text, p_purpose text, p_reservation_id uuid, p_ttl_seconds integer
) returns boolean language plpgsql security definer set search_path=pg_catalog
as $$
declare v_created timestamptz := now();
        v_accepted boolean;
begin
  if p_phone_digest !~ '^[0-9a-f]{64}$'
     or p_purpose not in ('client_login','vendor_login')
     or p_reservation_id is null
     or p_ttl_seconds not between 30 and 300 then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_phone_digest, 7123001));
  insert into qf_vendor_private.auth_otp_purpose_reservations as r
    (phone_digest,purpose,reservation_id,state,auth_user_id,
     verified_webhook_id,created_at,expires_at)
    values (p_phone_digest,p_purpose,p_reservation_id,'reserved',null,null,
            v_created,v_created+make_interval(secs => p_ttl_seconds))
  on conflict (phone_digest) do update
    set purpose=excluded.purpose,
        reservation_id=excluded.reservation_id,
        state='reserved',
        auth_user_id=null,
        verified_webhook_id=null,
        created_at=excluded.created_at,
        expires_at=excluded.expires_at
    where r.expires_at <= v_created
  returning true into v_accepted;
  return coalesce(v_accepted,false);
exception
  when unique_violation then return false;
end;
$$;

-- Claimed only after the Standard Webhooks signature has been verified.
-- A duplicate signed webhook id is idempotent. A different webhook id cannot
-- steal the same reservation, including after an uncertain delivery.
create or replace function public.qf_claim_auth_otp_purpose(
  p_phone_digest text, p_auth_user_id uuid, p_verified_webhook_id text
) returns text language plpgsql security definer set search_path=pg_catalog
as $$
declare v_record qf_vendor_private.auth_otp_purpose_reservations%rowtype;
begin
  if p_phone_digest !~ '^[0-9a-f]{64}$' or p_auth_user_id is null
     or nullif(p_verified_webhook_id,'') is null
     or length(p_verified_webhook_id)>200 then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_phone_digest,7123001));
  select * into v_record
    from qf_vendor_private.auth_otp_purpose_reservations
   where phone_digest=p_phone_digest for update;
  if not found or v_record.expires_at <= now() then return null; end if;
  if v_record.state='claimed' then
    if v_record.auth_user_id=p_auth_user_id
       and v_record.verified_webhook_id=p_verified_webhook_id then
      return v_record.purpose;
    end if;
    return null;
  end if;
  update qf_vendor_private.auth_otp_purpose_reservations
     set state='claimed',auth_user_id=p_auth_user_id,
         verified_webhook_id=p_verified_webhook_id
   where phone_digest=p_phone_digest and state='reserved';
  return v_record.purpose;
end;
$$;

-- A failed pre-hook request can release only its own unclaimed reservation.
create or replace function public.qf_release_auth_otp_purpose(
  p_phone_digest text, p_reservation_id uuid
) returns boolean language plpgsql security definer set search_path=pg_catalog
as $$
begin
  if p_phone_digest !~ '^[0-9a-f]{64}$' or p_reservation_id is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_phone_digest,7123001));
  delete from qf_vendor_private.auth_otp_purpose_reservations
   where phone_digest=p_phone_digest and reservation_id=p_reservation_id
     and state='reserved';
  return found;
end;
$$;

-- The private case is separate from public.vendors; no raw Aadhaar identifier,
-- OTP, scanned image or portfolio media URL belongs in a vendor row.
create table if not exists qf_vendor_private.verification_cases (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  case_version integer not null default 1 check (case_version>0),
  state text not null default 'pending'
    check (state in ('pending','documents_requested','under_review',
       'needs_correction','approved','rejected','expired')),
  contact_status text not null default 'pending'
    check (contact_status in ('pending','verified','rejected','expired')),
  identity_status text not null default 'pending'
    check (identity_status in ('pending','verified','rejected','expired')),
  office_status text not null default 'pending'
    check (office_status in ('pending','verified','rejected','expired')),
  category_status text not null default 'pending'
    check (category_status in ('pending','verified','rejected','expired')),
  zone_status text not null default 'pending'
    check (zone_status in ('pending','verified','rejected','expired')),
  reviewer_user_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vendor_id,case_version)
);
create index if not exists idx_vendor_verification_case_review
  on qf_vendor_private.verification_cases(state,created_at);

create table if not exists qf_vendor_private.verification_consents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references qf_vendor_private.verification_cases(id) on delete restrict,
  method text not null
    check (method in ('aadhaar_offline','passport','driving_licence','voter_id','other_approved')),
  purpose text not null default 'vendor_identity_review'
    check (purpose='vendor_identity_review'),
  notice_version text not null check (length(notice_version) between 1 and 80),
  consented_at timestamptz not null,
  revoked_at timestamptz,
  verifier_reference text,
  created_at timestamptz not null default now(),
  constraint verification_consent_revoked_order check
    (revoked_at is null or revoked_at>=consented_at)
);
create index if not exists idx_vendor_verification_consent_case
  on qf_vendor_private.verification_consents(case_id,consented_at desc);

create table if not exists qf_vendor_private.verification_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references qf_vendor_private.verification_cases(id) on delete restrict,
  evidence_type text not null
    check (evidence_type in ('identity_attestation','office_proof',
         'category_proof','zone_proof')),
  verification_method text,
  private_storage_key text,
  processor_reference text,
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  scan_status text not null default 'pending'
    check (scan_status in ('pending','clean','rejected','not_applicable')),
  evidence_state text not null default 'pending'
    check (evidence_state in ('pending','verified','rejected','expired')),
  uploaded_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  expires_at timestamptz,
  delete_after timestamptz,
  created_at timestamptz not null default now(),
  constraint evidence_not_public_only check (
     private_storage_key is null or
     (left(private_storage_key,1)<>'/' and
      private_storage_key not ilike 'http:%' and
      private_storage_key not ilike 'https:%')
  )
);
create index if not exists idx_vendor_evidence_case
  on qf_vendor_private.verification_evidence(case_id,evidence_type);

create table if not exists qf_vendor_private.verification_decisions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references qf_vendor_private.verification_cases(id) on delete restrict,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in
    ('request_documents','request_correction','approve','reject','expire')),
  from_state text not null,
  to_state text not null,
  reason_code text not null check (length(reason_code) between 1 and 80),
  recorded_at timestamptz not null default now()
);
create index if not exists idx_vendor_decision_case
  on qf_vendor_private.verification_decisions(case_id,recorded_at);

-- Immutable decision history even if a privileged app has DELETE rights on
-- other private tables. Only an independent, approved maintenance intervention
-- may intentionally alter PostgreSQL trigger configuration.
create or replace function qf_vendor_private.block_decision_mutation()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  raise exception 'VENDOR_VERIFICATION_DECISION_IMMUTABLE' using errcode='42501';
end;
$$;
drop trigger if exists verification_decisions_immutable on qf_vendor_private.verification_decisions;
create trigger verification_decisions_immutable
  before update or delete on qf_vendor_private.verification_decisions
  for each row execute function qf_vendor_private.block_decision_mutation();

-- A read-only private evaluation helper for future Owner approval predicates;
-- it does NOT grant approval or activate lead acceptance on its own.
create or replace function public.qf_vendor_verification_case_ready(
  p_vendor_id uuid
) returns boolean language sql stable security definer set search_path=pg_catalog
as $$
  select exists(
    select 1 from qf_vendor_private.verification_cases c
    where c.vendor_id=p_vendor_id and c.state='approved'
      and c.contact_status='verified' and c.identity_status='verified'
      and c.office_status='verified' and c.category_status='verified'
      and c.zone_status='verified' and c.reviewer_user_id is not null
      and c.reviewed_at is not null
      and (c.expires_at is null or c.expires_at>now())
      and exists (
        select 1 from qf_vendor_private.verification_consents consent
        where consent.case_id=c.id and consent.revoked_at is null
      )
      -- Identity and office cannot be approved on self-declared case flags.
      and exists (
        select 1 from qf_vendor_private.verification_evidence identity_doc
        where identity_doc.case_id=c.id
          and identity_doc.evidence_type='identity_attestation'
          and identity_doc.evidence_state='verified'
          and identity_doc.scan_status in ('clean','not_applicable')
          and identity_doc.reviewed_by is not null
          and identity_doc.reviewed_at is not null
          and (identity_doc.processor_reference is not null
               or identity_doc.private_storage_key is not null)
          and (identity_doc.expires_at is null or identity_doc.expires_at>now())
      )
      and exists (
        select 1 from qf_vendor_private.verification_evidence office_doc
        where office_doc.case_id=c.id
          and office_doc.evidence_type='office_proof'
          and office_doc.evidence_state='verified'
          and office_doc.scan_status='clean'
          and office_doc.private_storage_key is not null
          and office_doc.reviewed_by is not null
          and office_doc.reviewed_at is not null
          and (office_doc.expires_at is null or office_doc.expires_at>now())
      )
      and exists (
        select 1 from qf_vendor_private.verification_decisions decision
        where decision.case_id=c.id and decision.action='approve'
          and decision.to_state='approved'
          and decision.reviewer_user_id=c.reviewer_user_id
      )
  );
$$;

-- Explicit role/security posture, no client RLS and no public document reads.
revoke all on all tables in schema qf_vendor_private from public,anon,authenticated;
revoke all on all functions in schema qf_vendor_private from public,anon,authenticated;
grant select,insert,update,delete on qf_vendor_private.auth_otp_purpose_reservations to service_role;
grant select,insert,update on qf_vendor_private.verification_cases to service_role;
grant select,insert,update,delete on qf_vendor_private.verification_consents to service_role;
grant select,insert,update,delete on qf_vendor_private.verification_evidence to service_role;
grant select,insert on qf_vendor_private.verification_decisions to service_role;

alter table qf_vendor_private.auth_otp_purpose_reservations enable row level security;
alter table qf_vendor_private.verification_cases enable row level security;
alter table qf_vendor_private.verification_consents enable row level security;
alter table qf_vendor_private.verification_evidence enable row level security;
alter table qf_vendor_private.verification_decisions enable row level security;

revoke all on function public.qf_reserve_auth_otp_purpose(text,text,uuid,integer)
  from public,anon,authenticated;
revoke all on function public.qf_claim_auth_otp_purpose(text,uuid,text)
  from public,anon,authenticated;
revoke all on function public.qf_release_auth_otp_purpose(text,uuid)
  from public,anon,authenticated;
revoke all on function public.qf_vendor_verification_case_ready(uuid)
  from public,anon,authenticated;
grant execute on function public.qf_reserve_auth_otp_purpose(text,text,uuid,integer) to service_role;
grant execute on function public.qf_claim_auth_otp_purpose(text,uuid,text) to service_role;
grant execute on function public.qf_release_auth_otp_purpose(text,uuid) to service_role;
grant execute on function public.qf_vendor_verification_case_ready(uuid) to service_role;

commit;
