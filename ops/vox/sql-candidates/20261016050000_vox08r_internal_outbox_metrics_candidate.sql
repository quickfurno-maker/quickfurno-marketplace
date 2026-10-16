-- VOX-08R. UNAPPROVED SOURCE CANDIDATE; deliberately outside migrations.
-- Requires 08N outbox candidate and independently audited DBA grant owners.
-- Read-only service-role aggregate. No Staff, provider, client or job IDs.
begin;
create function public.qf_vox_staff_notification_outbox_metrics_v1()
returns jsonb language plpgsql security definer set search_path='' as $$
declare snap record;
 v_age integer;
begin
 select
  count(*) filter (where state='PENDING')::bigint as pending,
  count(*) filter (where state='LEASED')::bigint as leased,
  count(*) filter (where state='DONE')::bigint as completed,
  count(*) filter (where state='DEAD_LETTER')::bigint as dead_letter,
  max(attempts)::integer as max_attempt,
  min(created_at) filter (where state='PENDING') as oldest_created
 into snap
 from public.vox_staff_notification_outbox_candidate_v1;

 -- Metric projection intentionally bounded: fail closed rather than emit
 -- false precision/overflow. Any huge queue requires human diagnosis.
 if snap.pending>1000000 or snap.leased>1000000 or
    snap.completed>1000000 or snap.dead_letter>1000000
 then raise exception 'VOX_OUTBOX_METRIC_WINDOW_OVERFLOW';end if;
 if snap.pending>0 then
  v_age:=greatest(0,least(86400,
   floor(extract(epoch from clock_timestamp()-snap.oldest_created))::integer));
 else
  v_age:=null;
 end if;
 return jsonb_build_object(
  'schema','qf.vox.internal-notification-outbox.metrics.v1',
  'source','QUICKFURNO_CORE',
  'observedAt',to_char(clock_timestamp() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'collectionId',gen_random_uuid()::text,
  'pending',snap.pending::integer,
  'leased',snap.leased::integer,
  'completed',snap.completed::integer,
  'deadLetter',snap.dead_letter::integer,
  'oldestPendingAgeSeconds',v_age,
  'maxAttemptsObserved',coalesce(snap.max_attempt,0),
  'totalKnown',false,
  'includesExternalProviderDelivery',false
 );
end;
$$;
revoke all on function public.qf_vox_staff_notification_outbox_metrics_v1()
 from public,anon,authenticated;
grant execute on function public.qf_vox_staff_notification_outbox_metrics_v1()
 to service_role;
commit;
