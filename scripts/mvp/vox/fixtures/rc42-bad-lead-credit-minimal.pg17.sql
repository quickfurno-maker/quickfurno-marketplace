-- Disposable-only stand-in tables, not Supabase migration or managed data.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
DO $$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END$$;
CREATE TABLE auth.users(id uuid primary key,raw_app_meta_data jsonb not null);
CREATE TABLE public.profiles(id uuid primary key,role text,is_active boolean not null);
CREATE TABLE public.lead_assignments(id uuid primary key,vendor_id uuid not null,lead_id uuid not null,
 credit_deducted boolean not null,lifecycle_status text not null);
CREATE TABLE public.bad_lead_reports(id uuid primary key,vendor_id uuid not null,
 lead_assignment_id uuid not null,status text not null,reason_code text,report_type text,
 recovery_recommendation text,recovery_status text,credit_restored boolean default false,
 credit_restoration_approval_id uuid,reviewed_by uuid,reviewed_at timestamptz,
 recovery_applied_at timestamptz,updated_at timestamptz);
CREATE TABLE public.credit_restoration_approvals(
 id uuid primary key default gen_random_uuid(),original_assignment_id uuid not null,
 vendor_id uuid not null,lead_id uuid not null,evidence_type text not null,
 evidence_reference text not null,reason_code text,requested_by uuid,
 status text not null,approved_by uuid,decided_at timestamptz,idempotency_key text unique,
 restoration_ledger_id uuid);
CREATE TABLE public.credit_test_wallet(vendor_id uuid primary key,lead_credits int not null);
-- Mirror the actual canonical ledger columns so even the disposable fixture
-- cannot satisfy the wrapper using a fabricated UUID alone.
CREATE TABLE public.vendor_credit_logs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vendor_id uuid NOT NULL,
 change_type text NOT NULL,credits_before integer NOT NULL,
 credits_delta integer NOT NULL,credits_after integer NOT NULL,
 reason text,updated_by text,reference_type text,reference_id text,
 approval_reference uuid,idempotency_key text UNIQUE,actor_kind text,
 actor_id uuid,created_at timestamptz NOT NULL DEFAULT now());
-- STUB: only proves new RC42 transaction calls canonical function atomically.
-- Real authoritative qf_approve_credit_restoration_v2 must receive its OWN PG17 proof separately.
CREATE FUNCTION public.qf_approve_credit_restoration_v2(p_approval uuid,p_actor uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE rec public.credit_restoration_approvals%rowtype; v_ledger uuid:=gen_random_uuid();
 v_before integer;
BEGIN
 SELECT * INTO rec FROM public.credit_restoration_approvals WHERE id=p_approval FOR UPDATE;
 IF NOT FOUND OR rec.status<>'approved' OR rec.approved_by IS NULL THEN
 RETURN jsonb_build_object('status','rejected'); END IF;
 SELECT lead_credits INTO v_before FROM public.credit_test_wallet
  WHERE vendor_id=rec.vendor_id FOR UPDATE;
 IF v_before IS NULL THEN RETURN jsonb_build_object('status','rejected'); END IF;
 UPDATE public.credit_test_wallet SET lead_credits=v_before+1 WHERE vendor_id=rec.vendor_id;
 INSERT INTO public.vendor_credit_logs(id,vendor_id,change_type,credits_before,
  credits_delta,credits_after,reason,updated_by,reference_type,reference_id,
  approval_reference,idempotency_key,actor_kind,actor_id)
 VALUES(v_ledger,rec.vendor_id,'approved_bad_lead_restoration',
  v_before,1,v_before+1,'disposable','test_stub','credit_restoration_approval',
  rec.id::text,rec.id,'restoration:'||rec.id::text,'admin',p_actor);
 UPDATE public.credit_restoration_approvals SET status='applied',restoration_ledger_id=v_ledger WHERE id=p_approval;
 RETURN jsonb_build_object('status','applied','ledger_id',v_ledger);
END $$;
INSERT INTO auth.users VALUES ('66666666-6666-4666-8666-666666666666',
 '{"admin_role":"Superadmin"}'::jsonb);
INSERT INTO public.profiles VALUES('66666666-6666-4666-8666-666666666666','admin',true);
INSERT INTO public.lead_assignments VALUES('44444444-4444-4444-8444-444444444444',
 '22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555',true,'delivered');
INSERT INTO public.bad_lead_reports(id,vendor_id,lead_assignment_id,status,reason_code,recovery_status)
VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
 '44444444-4444-4444-8444-444444444444','Approved','invalid_wrong_phone','recommended'),
 ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',
 '44444444-4444-4444-8444-444444444444','Approved','invalid_wrong_phone','recommended');
INSERT INTO public.credit_test_wallet VALUES('22222222-2222-4222-8222-222222222222',10);
