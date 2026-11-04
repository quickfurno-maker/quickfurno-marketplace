-- Batch 7 isolated PostgreSQL 17 Owner vendor review queue acceptance.
-- Assumes synthetic Bootstrap -> Consent -> Private OTP -> Atomic -> Owner
-- decisions -> Private intake -> new Owner queue migration. No real DB writes.
do $$
declare
 items jsonb;
 item jsonb;
 owner_vendor uuid:='10000000-0000-4000-8000-000000000006';
 actor_vendor uuid;
 seen_ids uuid[]:=array[]::uuid[];
begin
 items:=public.qf_vox_owner_vendor_review_queue();
 if jsonb_typeof(items)<>'array' then raise exception 'B7_QUEUE_NOT_ARRAY';end if;
 if jsonb_array_length(items)>20 then raise exception 'B7_QUEUE_UNBOUNDED';end if;
 if not exists(select 1 from jsonb_array_elements(items) item
               where item->>'vendorId'=owner_vendor::text
                 and item->>'caseVersion'='1'
                 and item->>'consentValid'='false'
                 and item->>'pendingScanCount'='1')
 then raise exception 'B7_REVOKED_CONSENT_QUEUE_OMITTED';end if;
 select v.id into actor_vendor from public.vendors v
  where v.user_id='00000000-0000-4000-8000-000000000001';
 if actor_vendor is null or not exists (
   select 1 from jsonb_array_elements(items) item
   where item->>'vendorId'=actor_vendor::text
     and item->>'caseVersion'='2'
     and item->>'caseState'='pending')
 then raise exception 'B7_LATEST_PENDING_CASE_NOT_QUEUED';end if;

 for item in select value from jsonb_array_elements(items) loop
   if item ? 'caseId' or item ? 'private_storage_key' or item ? 'email'
      or item ? 'phone' or item ? 'aadhaar'
      or item ? 'gst' or item ? 'providerReference'
      or item ? 'businessName' or item ? 'ownerName'
   then raise exception 'B7_PRIVATE_DETAILS_LEAKED';end if;
   if (select count(*) from jsonb_object_keys(item))<>12
   then raise exception 'B7_QUEUE_KEY_DRIFT';end if;
   if (item->>'vendorId')::uuid=any(seen_ids)
   then raise exception 'B7_DUPLICATE_VENDOR_ENTRY';end if;
   seen_ids:=array_append(seen_ids,(item->>'vendorId')::uuid);
 end loop;
 raise notice 'PASS Owner vendor review: current case only, pending evidence counts, privacy projection';
end $$;

do $$
declare items jsonb;
begin
 -- Synthetic 22 additional cases older than current ones ensure hard cap,
 -- deterministic oldest-first selection, and no unbounded response.
 with added as (
   insert into public.vendors
      (id,business_name,phone,city,status,is_active,accepting_leads,public_visibility)
   select gen_random_uuid(),'B7 Synthetic Queue Vendor '||n::text,
          (9000000100+n)::text,'Pune','Pending',false,false,false
     from generate_series(1,22) n
   returning id,business_name
 )
 insert into qf_vendor_private.verification_cases
  (vendor_id,case_version,state,created_at)
 select a.id,1,'pending',now()-interval '4 days'+
   ((split_part(a.business_name,' ',5)::integer) * interval '1 minute')
 from added a;
 items:=public.qf_vox_owner_vendor_review_queue();
 if jsonb_array_length(items)<>20 then raise exception 'B7_QUEUE_LIMIT_20_BROKEN';end if;
 if (items->0->>'caseState')<>'pending' then
  raise exception 'B7_QUEUE_FIRST_NOT_PENDING';end if;
 if exists (
  select 1 from jsonb_array_elements(items) item
  where item->>'caseVersion'<>'1'
 ) then raise exception 'B7_OLD_CASES_FAILED_TO_SORT_FIRST';end if;
 raise notice 'PASS owner queue hard 20-row cap and oldest-first current-case sorting';
end $$;

do $$
begin
 if has_function_privilege('anon','public.qf_vox_owner_vendor_review_queue()','EXECUTE')
    or has_function_privilege('authenticated','public.qf_vox_owner_vendor_review_queue()','EXECUTE')
    or not has_function_privilege('service_role',
      'public.qf_vox_owner_vendor_review_queue()','EXECUTE')
 then raise exception 'B7_QUEUE_RPC_EXPOSED_TO_BROWSER';end if;
 raise notice 'PASS Owner queue service-role-only RPC boundary';
end $$;
