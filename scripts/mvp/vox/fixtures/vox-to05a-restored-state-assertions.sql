-- Run ONLY against newly restored disposable PG17 snapshot.
do $vox_to05_restore$
begin
 if (select count(*) from public.vox_staff_department_capabilities_v1
     where department='vendor_success' and revoked_at is not null)<>1
 then raise exception 'RESTORED_REVOKED_DEPARTMENT_MISSING'; end if;
 if (select count(*) from public.vox_work_items_candidate_v1
     where id='00000000-0000-4000-8000-000000000971'
     and assignee_id='00000000-0000-4000-8000-000000000002'
     and state='ASSIGNED' and revision=1)<>1
 then raise exception 'RESTORED_WORK_REVISION_INCORRECT'; end if;
 if (select count(*) from public.vox_work_events_candidate_v1
     where work_item_id='00000000-0000-4000-8000-000000000971')<>1
 then raise exception 'RESTORED_AUDIT_LEDGER_INCORRECT'; end if;
 if has_table_privilege('anon','public.vox_staff_department_capabilities_v1','SELECT')
    or has_table_privilege('authenticated','public.vox_staff_department_capabilities_v1','SELECT')
 then raise exception 'RESTORED_DEPARTMENT_TABLE_PRIVILEGE_LEAK'; end if;
 if has_function_privilege('anon',
   'public.qf_vox_work_transition_candidate_v1(uuid,uuid,integer,uuid,text,text)','EXECUTE')
    or has_function_privilege('authenticated',
   'public.qf_vox_work_transition_candidate_v1(uuid,uuid,integer,uuid,text,text)','EXECUTE')
 then raise exception 'RESTORED_WORK_RPC_PRIVILEGE_LEAK'; end if;
end $vox_to05_restore$;
select 'VOX_TO05A_DISPOSABLE_PG17_RESTORED_CONTRACT_PASS' as result;
