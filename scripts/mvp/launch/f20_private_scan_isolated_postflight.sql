-- F20 isolated PostgreSQL postflight. NEVER run against managed Staging.
-- Appended only to the disposable F15 offline restore, after ten applied SQL migrations.
-- Every query checks existing schema/permissions/readiness without modifying rows.
begin;
do $f20$
declare
  ready_sql text;
  decision_sql text;
  trigger_sql text;
  probe_vendor uuid := gen_random_uuid();
  clean_scan_count integer;
begin
  if to_regclass('qf_vendor_private.verification_scan_receipts') is null then
    raise exception 'F20_MISSING_IMMUTABLE_SCAN_LEDGER';
  end if;
  if (select not relrowsecurity from pg_class where oid='qf_vendor_private.verification_scan_receipts'::regclass) then
    raise exception 'F20_SCAN_LEDGER_RLS_DISABLED';
  end if;
  if has_table_privilege('anon','qf_vendor_private.verification_scan_receipts','SELECT')
    or has_table_privilege('authenticated','qf_vendor_private.verification_scan_receipts','SELECT')
    or has_table_privilege('anon','qf_vendor_private.verification_scan_receipts','INSERT')
    or has_table_privilege('authenticated','qf_vendor_private.verification_scan_receipts','INSERT') then
    raise exception 'F20_BROWSER_CAN_TOUCH_SCAN_LEDGER';
  end if;
  if has_function_privilege('anon','public.qf_vendor_private_scan_queue()','EXECUTE')
    or has_function_privilege('authenticated','public.qf_vendor_private_scan_queue()','EXECUTE')
    or has_function_privilege('anon','public.qf_vendor_record_private_scan(uuid,text,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.qf_vendor_record_private_scan(uuid,text,text,text)','EXECUTE') then
    raise exception 'F20_BROWSER_CAN_FORGE_CLEAN_SCAN';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid='qf_vendor_private.verification_scan_receipts'::regclass
      and tgname='verification_scan_receipts_immutable' and not tgisinternal
      and (tgtype & 2)<>0 and (tgtype & 16)<>0 and (tgtype & 8)<>0
  ) then
    raise exception 'F20_SCAN_RECEIPT_IMMUTABILITY_TRIGGER_MISSING';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.lead_assignments'::regclass
      and tgname='trg_qf_vendor_new_assignment_verification' and not tgisinternal
  ) then
    raise exception 'F20_VENDOR_ASSIGNMENT_GATE_TRIGGER_MISSING';
  end if;
  ready_sql:=pg_get_functiondef('public.qf_vendor_verification_case_ready(uuid)'::regprocedure);
  if position('verification_scan_receipts' in ready_sql)=0
    or position('scan.content_sha256=office_doc.content_sha256' in ready_sql)=0
    or position('scan.scanner_engine=' in ready_sql)=0
    or position('scan.verdict=' in ready_sql)=0 then
    raise exception 'F20_OFFICE_APPROVAL_LACKS_IMMUTABLE_CLEAN_SCAN_RECEIPT';
  end if;
  decision_sql:=pg_get_functiondef(
    'public.qf_owner_record_vendor_verification_decision(uuid,uuid,integer,text,text)'::regprocedure);
  if position('QF_OWNER_REVIEW_EVIDENCE_CHANGED' in decision_sql)=0
    or position('qf_vendor_verification_case_ready(p_vendor_id)' in decision_sql)=0 then
    raise exception 'F20_OWNER_APPROVAL_DOES_NOT_RECHECK_CLEAN_SCAN';
  end if;
  if public.qf_vendor_verification_case_ready(probe_vendor) is distinct from false then
    raise exception 'F20_UNVERIFIED_RANDOM_VENDOR_EVER_READY';
  end if;
  if public.qf_vendor_record_private_scan(gen_random_uuid(),repeat('0',64),'clean','f20_local') <> 'denied' then
    raise exception 'F20_SCAN_RECORD_ACCEPTED_NONEXISTENT_EVIDENCE';
  end if;
  select count(*) into clean_scan_count from qf_vendor_private.verification_scan_receipts;
  raise notice 'F20_PRIVATE_SCAN_POSTFLIGHT_PASS unique_scan_receipts=% (count only)',clean_scan_count;
end
$f20$;
rollback;
