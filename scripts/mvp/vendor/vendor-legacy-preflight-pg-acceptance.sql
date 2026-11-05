-- QF Batch 10 acceptance after running the baseline preflight in a fresh
-- LEGACY-ONLY database. No private case schema exists here.
do $$
begin
 if to_regclass('qf_vendor_private.verification_cases') is not null
   then raise exception 'B10_PRIVATE_SCHEMA_WAS_PREINSTALLED';end if;
 if to_regclass('supabase_migrations.schema_migrations') is not null
   then raise exception 'B10_MANAGED_SCHEMA_WAS_PREINSTALLED';end if;
 if (select count(*) from public.vendors)<>4
   then raise exception 'B10_BASELINE_VENDOR_COUNT_CHANGED';end if;
 if (select count(*) from public.vendors
      where is_active is true or accepting_leads is true
        or public_visibility is true)<>2
   then raise exception 'B10_LEGACY_ACTIVE_INVENTORY_WRONG';end if;
 if (select count(*) from public.vendors
      where phone is null or phone !~ '^[6-9][0-9]{9}$')<>1
   then raise exception 'B10_NONCANONICAL_PHONE_NOT_FLAGGED';end if;
 if (select count(*) from (
      select phone from public.vendors where phone ~ '^[6-9][0-9]{9}$'
      group by phone having count(*)>1) d)<>1
   then raise exception 'B10_DUPLICATE_PHONE_GROUP_NOT_FLAGGED';end if;
 if (select count(distinct v.id) from public.vendors v
      join public.vendor_dashboard_users m on m.vendor_id=v.id
      where m.role='owner' and m.status='active'
        and v.user_id is distinct from m.user_id)<>1
   then raise exception 'B10_OWNER_MISMATCH_NOT_FLAGGED';end if;
 if (select count(distinct v.id) from public.vendors v
      join public.client_accounts c on c.user_id=v.user_id
      where v.user_id is not null)<>1
   then raise exception 'B10_CROSS_PRINCIPAL_NOT_FLAGGED';end if;
 if (select count(*) from public.vendors
      where status='Pending' and (is_active is true
        or accepting_leads is true or public_visibility is true))<>1
   then raise exception 'B10_PENDING_ACTIVATION_NOT_FLAGGED';end if;
 if (select count(distinct vendor_id) from public.lead_assignments
      where lifecycle_status in ('assigned','delivered','accepted'))<>1
   then raise exception 'B10_HISTORICAL_ASSIGNMENT_NOT_FLAGGED';end if;
 raise notice 'PASS B10 fresh legacy-only Core preflight: all deliberate risk counts preserved, private schema absent';
end;
$$;
