-- NOT EXECUTED by the author. DISPOSABLE PG17 ONLY, after the 30 candidate DDLs
-- and the AB7K overlay, with Supabase-style roles (anon, authenticated, service_role)
-- and auth.uid()/auth.jwt() available. Never run against a managed database.
-- Everything is rolled back; any failed assertion raises and aborts.
begin;
do $$
declare t text; f text; hit boolean;
begin
 foreach f in array array[
  'public.qf_vox_ab7g_official_eod_publish_candidate_v1(uuid,uuid,uuid,uuid,text)',
  'public.qf_vox_ab7h_signed_operator_atomic_candidate_v1(uuid,text,uuid,bigint,text,text)',
  'public.qf_vox_ab7f_conversation_atomic_operator_candidate_v1(uuid,bigint,uuid,uuid,text)']
 loop
  if has_function_privilege('service_role',f,'execute')
   or has_function_privilege('anon',f,'execute')
   or has_function_privilege('authenticated',f,'execute') then
   raise exception 'VERIFY_FAIL execute still granted: %',f;end if;
 end loop;
 foreach t in array array[
  'vox_ab7f_staff_suspend_receipts_candidate_v1','vox_ab7f_four_source_eod_candidate_v1',
  'vox_ab7f_conversation_operator_receipts_candidate_v1','vox_ab7g_eod_owner_approvals_candidate_v1',
  'vox_ab7g_eod_official_publications_candidate_v1','vox_ab7h_operator_review_candidate_v1',
  'vox_ab7h_operator_atomic_receipts_candidate_v1','vox_ab7i_staff_suspend_approvals_candidate_v1',
  'vox_ab7j_staff_suspend_intents_candidate_v1']
 loop
  foreach f in array array['service_role','anon','authenticated'] loop
   if has_table_privilege(f,'public.'||t,'insert') or has_table_privilege(f,'public.'||t,'update')
    or has_table_privilege(f,'public.'||t,'delete') or has_table_privilege(f,'public.'||t,'truncate') then
    raise exception 'VERIFY_FAIL % can write %',f,t;end if;
  end loop;
 end loop;
 -- Write guard fires even for the connecting (privileged) role.
 foreach t in array array['vox_ab7g_eod_owner_approvals_candidate_v1','vox_ab7h_operator_review_candidate_v1']
 loop
  hit:=false;
  begin
   execute format('insert into public.%I default values',t);
  exception when others then hit:=sqlerrm like '%AB7K_VERIFIED_ATTESTATION_WRITER_NOT_INSTALLED%';
  end;
  if not hit then raise exception 'VERIFY_FAIL write guard did not fire on %',t;end if;
 end loop;
 -- AB7J must deny a JWT that has NO aal claim and a service_role (no auth.uid) caller.
 perform set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 hit:=false;
 begin
  perform public.qf_vox_ab7j_tl_approve_staff_suspend_v1(gen_random_uuid(),repeat('a',64));
 exception when others then hit:=sqlerrm like '%AB7J_TL_AAL2_REQUIRED%';
 end;
 if not hit then raise exception 'VERIFY_FAIL missing aal claim was not denied';end if;
end;
$$;
rollback;
