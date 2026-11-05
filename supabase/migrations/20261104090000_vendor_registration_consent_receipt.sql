-- Vendor registration consent evidence, additive, no historical backfill.
-- REVIEW BEFORE MANAGED STAGING DEPLOY. Apply migration before shipping dependent Core.
begin;

alter table public.vendors
  add column if not exists registration_consent_version text,
  add column if not exists registration_consent_accepted_at timestamptz;

comment on column public.vendors.registration_consent_version is
  'Version of the vendor registration privacy/verification notice explicitly accepted before new signup. No Aadhaar credentials stored.';
comment on column public.vendors.registration_consent_accepted_at is
  'Server-assigned time of affirmative registration notice consent; separate Aadhaar/alternative identity verification consent required later.';

-- Preserve prior vendor rows without inventing retrospective consent.
-- No general INSERT/UPDATE/SELECT grants are added; existing RLS remains enabled.
do $$
begin
 if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
               where n.nspname='public' and c.relname='vendors' and c.relrowsecurity) then
   raise exception 'QF_VENDOR_CONSENT_RLS_REQUIRED';
 end if;
end $$;
commit;
