-- Verifies the RC4 approval ledger in a DISPOSABLE PG17 database (name qf_disposable_*).
-- Run as the database owner after 20261030020000_vox_rc4_approval_nonce_ledger_disposable.sql.
-- NEVER executed by the author. Rolls back everything it does.
begin;
-- This synthetic role exists only inside the rolled-back disposable verification.
create role qf_rc4_untrusted_verify nologin;
do $$
declare a text:=repeat('a',64);b text:=repeat('b',64);c text:=repeat('c',64);
 d text:=repeat('d',64);e text:=repeat('e',64);ok boolean;
begin
 if current_database() !~ '^qf_disposable_' then
  raise exception 'VERIFY_DISPOSABLE_DATABASE_ONLY';end if;
 -- first claim succeeds
 perform public.qf_vox_rc4_claim_approval_keys_v1(array[a,b],c,clock_timestamp()+interval '5 minutes');
 -- replayed nonce with fresh subject is denied, and claims NOTHING (atomic)
 ok:=false;
 begin perform public.qf_vox_rc4_claim_approval_keys_v1(array[d,a],e,clock_timestamp()+interval '5 minutes');
 exception when others then ok:=sqlerrm='RC4_REPLAY_DENIED';end;
 if not ok then raise exception 'VERIFY_NONCE_REPLAY_NOT_DENIED';end if;
 if exists(select 1 from public.vox_rc4_approval_ledger_v1 where key_hash in (d,e)) then
  raise exception 'VERIFY_PARTIAL_CLAIM_LEAKED';end if;
 -- subject replay with fresh nonces is denied
 ok:=false;
 begin perform public.qf_vox_rc4_claim_approval_keys_v1(array[d,e],c,clock_timestamp()+interval '5 minutes');
 exception when others then ok:=sqlerrm='RC4_REPLAY_DENIED';end;
 if not ok then raise exception 'VERIFY_SUBJECT_REPLAY_NOT_DENIED';end if;
 -- expired and over-long lifetimes are denied
 ok:=false;
 begin perform public.qf_vox_rc4_claim_approval_keys_v1(array[d,e],repeat('f',64),clock_timestamp()-interval '1 second');
 exception when others then ok:=sqlerrm='RC4_SIGNATURE_EXPIRED';end;
 if not ok then raise exception 'VERIFY_EXPIRY_NOT_DENIED';end if;
 ok:=false;
 begin perform public.qf_vox_rc4_claim_approval_keys_v1(array[d,e],repeat('f',64),clock_timestamp()+interval '1 hour');
 exception when others then ok:=sqlerrm='RC4_SIGNATURE_LIFETIME_DENIED';end;
 if not ok then raise exception 'VERIFY_LIFETIME_NOT_DENIED';end if;
 -- append-only
 ok:=false;
 begin delete from public.vox_rc4_approval_ledger_v1;
 exception when others then ok:=sqlerrm='RC4_LEDGER_APPEND_ONLY';end;
 if not ok then raise exception 'VERIFY_DELETE_NOT_BLOCKED';end if;
 ok:=false;
 begin truncate public.vox_rc4_approval_ledger_v1;
 exception when others then ok:=sqlerrm='RC4_LEDGER_APPEND_ONLY';end;
 if not ok then raise exception 'VERIFY_TRUNCATE_NOT_BLOCKED';end if;
 -- revocation
 insert into public.vox_rc4_key_revocations_v1(key_id,reason) values('owner-key-01','verify');
 if not public.qf_vox_rc4_is_revoked_v1('owner-key-01',null) then
  raise exception 'VERIFY_REVOCATION_NOT_VISIBLE';end if;
 if public.qf_vox_rc4_is_revoked_v1('other-key-01',null) then
  raise exception 'VERIFY_REVOCATION_OVERBROAD';end if;
 -- Both security-sensitive public tables must enforce FORCE RLS even if a
 -- future schema default grant accidentally exposes them to authenticated.
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('vox_rc4_approval_ledger_v1','vox_rc4_key_revocations_v1')
    and c.relrowsecurity and c.relforcerowsecurity) <> 2 then
  raise exception 'VERIFY_FORCE_RLS_MISSING';end if;
 if has_table_privilege('qf_rc4_untrusted_verify','public.vox_rc4_approval_ledger_v1','SELECT')
  or has_table_privilege('qf_rc4_untrusted_verify','public.vox_rc4_key_revocations_v1','INSERT')
  or has_function_privilege('qf_rc4_untrusted_verify',
   'public.qf_vox_rc4_claim_approval_keys_v1(text[],text,timestamptz)','EXECUTE') then
  raise exception 'VERIFY_UNTRUSTED_ROLE_PRIVILEGE';end if;
 -- no non-owner role may execute or touch the ledger
 -- (grantee 0 = PUBLIC; a NULL ACL means default privileges, i.e. PUBLIC execute)
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'qf\_vox\_rc4\_%'
   and (p.proacl is null or exists(select 1 from aclexplode(p.proacl) x where x.grantee<>p.proowner)))
  or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname like 'vox\_rc4\_%' and c.relkind='r'
   and exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
    where x.grantee<>c.relowner)) then
  raise exception 'VERIFY_NON_OWNER_PRIVILEGE_LEAK';end if;
 raise notice 'RC4_LEDGER_VERIFY_PASSED_DISPOSABLE_ONLY';
end;
$$;
rollback;
