-- RC4 Track B approval nonce/subject replay LEDGER. DISPOSABLE PG17 ONLY, UNINSTALLED.
-- Standalone: depends on no Supabase auth schema, no AB7 table. Not part of the
-- pinned AB7K fingerprint. NOT executed anywhere by the author (no DB access).
-- It stores replay keys only. It verifies NO signature, writes NO approval and
-- grants execute to NO role: a future reviewed writer must be granted explicitly.
--  * append-only ledger (row + truncate triggers, ENABLE ALWAYS)
--  * atomic claim: 2 nonce keys + 1 subject key insert in one function call, or
--    nothing (unique_violation rolls the sub-transaction back)
--  * DB-side expiry and max-lifetime check on the supplied signature expiry
--  * append-only key/signer revocation table
begin;
do $$
begin
 if current_database() !~ '^qf_disposable_' then
  raise exception 'RC4_LEDGER_DISPOSABLE_DATABASE_ONLY';end if;
 if current_setting('server_version_num')::int < 170000 then
  raise exception 'RC4_LEDGER_REQUIRES_PG17';end if;
end;
$$;

create table public.vox_rc4_approval_ledger_v1(
 key_hash text primary key check(key_hash ~ '^[a-f0-9]{64}$'),
 kind text not null check(kind in ('NONCE','SUBJECT')),
 signature_expires_at timestamptz not null,
 claimed_at timestamptz not null default clock_timestamp()
);
create table public.vox_rc4_key_revocations_v1(
 id bigint generated always as identity primary key,
 key_id text check(key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{3,63}$'),
 signer_id uuid,
 reason text not null check(length(reason) between 3 and 200),
 revoked_at timestamptz not null default clock_timestamp(),
 constraint rc4_revocation_target check(key_id is not null or signer_id is not null)
);

-- Defensive parity with Supabase's exposed public schema: even an accidental
-- future table grant must not expose ledger/revocations through the Data API.
-- The disposable PG17 superuser verification has no external application roles.
alter table public.vox_rc4_approval_ledger_v1 enable row level security;
alter table public.vox_rc4_approval_ledger_v1 force row level security;
alter table public.vox_rc4_key_revocations_v1 enable row level security;
alter table public.vox_rc4_key_revocations_v1 force row level security;

create function public.qf_vox_rc4_append_only_v1()
returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'RC4_LEDGER_APPEND_ONLY';
end;
$$;
create trigger rc4_ledger_no_mutation before update or delete
 on public.vox_rc4_approval_ledger_v1 for each row
 execute function public.qf_vox_rc4_append_only_v1();
create trigger rc4_ledger_no_truncate before truncate
 on public.vox_rc4_approval_ledger_v1 for each statement
 execute function public.qf_vox_rc4_append_only_v1();
create trigger rc4_revocation_no_mutation before update or delete
 on public.vox_rc4_key_revocations_v1 for each row
 execute function public.qf_vox_rc4_append_only_v1();
create trigger rc4_revocation_no_truncate before truncate
 on public.vox_rc4_key_revocations_v1 for each statement
 execute function public.qf_vox_rc4_append_only_v1();
alter table public.vox_rc4_approval_ledger_v1 enable always trigger rc4_ledger_no_mutation;
alter table public.vox_rc4_approval_ledger_v1 enable always trigger rc4_ledger_no_truncate;
alter table public.vox_rc4_key_revocations_v1 enable always trigger rc4_revocation_no_mutation;
alter table public.vox_rc4_key_revocations_v1 enable always trigger rc4_revocation_no_truncate;

create function public.qf_vox_rc4_claim_approval_keys_v1(
 p_nonce_keys text[],p_subject_key text,p_signature_expires_at timestamptz
) returns integer language plpgsql security definer set search_path='' as $$
declare k text;
begin
 if p_nonce_keys is null or p_subject_key is null or p_signature_expires_at is null or
  cardinality(p_nonce_keys)<>2 or p_nonce_keys[1] is null or p_nonce_keys[2] is null or
  p_nonce_keys[1]=p_nonce_keys[2] or p_subject_key in (p_nonce_keys[1],p_nonce_keys[2]) or
  p_nonce_keys[1] !~ '^[a-f0-9]{64}$' or p_nonce_keys[2] !~ '^[a-f0-9]{64}$' or
  p_subject_key !~ '^[a-f0-9]{64}$' then
  raise exception 'RC4_CLAIM_SHAPE_DENIED';end if;
 if p_signature_expires_at<=clock_timestamp() then
  raise exception 'RC4_SIGNATURE_EXPIRED';end if;
 if p_signature_expires_at>clock_timestamp()+interval '15 minutes 30 seconds' then
  raise exception 'RC4_SIGNATURE_LIFETIME_DENIED';end if;
 begin
  foreach k in array p_nonce_keys loop
   insert into public.vox_rc4_approval_ledger_v1(key_hash,kind,signature_expires_at)
   values(k,'NONCE',p_signature_expires_at);
  end loop;
  insert into public.vox_rc4_approval_ledger_v1(key_hash,kind,signature_expires_at)
  values(p_subject_key,'SUBJECT',p_signature_expires_at);
 exception when unique_violation then
  raise exception 'RC4_REPLAY_DENIED';
 end;
 return 3;
end;
$$;

create function public.qf_vox_rc4_is_revoked_v1(p_key_id text,p_signer_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.vox_rc4_key_revocations_v1 r
  where (r.key_id is not null and r.key_id=p_key_id)
  or (r.signer_id is not null and r.signer_id=p_signer_id));
$$;

revoke all on public.vox_rc4_approval_ledger_v1 from public;
revoke all on public.vox_rc4_key_revocations_v1 from public;
revoke all on function public.qf_vox_rc4_append_only_v1() from public;
revoke all on function public.qf_vox_rc4_claim_approval_keys_v1(text[],text,timestamptz) from public;
revoke all on function public.qf_vox_rc4_is_revoked_v1(text,uuid) from public;
commit;
