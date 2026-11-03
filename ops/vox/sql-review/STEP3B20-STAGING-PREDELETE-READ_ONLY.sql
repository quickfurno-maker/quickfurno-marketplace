-- STEP3B20: Staging PRE-DELETE RECHECK (SELECT ONLY; review packet, not a migration).
-- Target: QuickFurno Staging uckafzuochmbvtiodmcl. No row IDs, PII or secrets returned.
-- Run with read-only DB privileges immediately BEFORE any independently approved change.
-- Do not run on Production; do not interpret exact counts as independent release GO.
WITH
  v AS (
    SELECT id,user_id FROM public.vendors
    WHERE lower(trim(coalesce(city,''))) IN ('pune','mumbai')
  ),
  l AS (
    SELECT id FROM public.leads
    WHERE lower(trim(coalesce(city,''))) IN ('pune','mumbai')
  ),
  a AS (
    SELECT id FROM public.lead_assignments
    WHERE vendor_id IN (SELECT id FROM v) OR lead_id IN (SELECT id FROM l)
  )
SELECT now() AS inspected_at_utc,
  (SELECT count(*) FROM v) AS test_vendors,
  (SELECT count(*) FROM l) AS test_leads,
  (SELECT count(*) FROM public.vendors WHERE id NOT IN (SELECT id FROM v)) AS unrelated_vendors_to_preserve,
  (SELECT count(*) FROM auth.users) AS auth_users_to_preserve,
  (SELECT count(DISTINCT user_id) FROM v WHERE user_id IS NOT NULL) AS test_linked_auth_users,
  (SELECT count(*) FROM a) AS test_assignments,
  (SELECT count(*) FROM public.lead_assignment_events
      WHERE vendor_id IN (SELECT id FROM v) OR lead_id IN (SELECT id FROM l)) AS test_immutable_events,
  (SELECT count(*) FROM public.vendor_credit_logs WHERE vendor_id IN (SELECT id FROM v)) AS test_vendor_credit_logs,
  (SELECT count(*) FROM public.payments) AS payment_rows,
  (SELECT md5(string_agg(id::text,',' ORDER BY id::text)) FROM v) AS test_vendor_idset_drift_fingerprint,
  (SELECT md5(string_agg(id::text,',' ORDER BY id::text)) FROM l) AS test_lead_idset_drift_fingerprint;

-- A disabled protected-history trigger is a release BLOCKER, never permission to delete.
SELECT c.relname AS protected_table,t.tgname AS protected_trigger,t.tgenabled AS enabled_state
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
WHERE NOT t.tgisinternal
  AND c.relnamespace='public'::regnamespace
  AND c.relname IN (
    'lead_assignment_events','vendor_campaign_audience_members','vendor_internal_notes',
    'automation_action_requests','automation_jobs','automation_execution_attempts',
    'automation_transport_requests'
  )
  AND (t.tgname LIKE '%immutable%' OR t.tgname LIKE '%no_delete%')
ORDER BY c.relname,t.tgname;

-- Counts alone are not proof queues/workers are frozen or provider callbacks are halted.
SELECT 'automation_action_requests' AS object_name, count(*) AS total_rows
FROM public.automation_action_requests
UNION ALL SELECT 'automation_jobs',count(*) FROM public.automation_jobs
UNION ALL SELECT 'automation_transport_requests',count(*) FROM public.automation_transport_requests
UNION ALL SELECT 'communication_messages',count(*) FROM public.communication_messages
UNION ALL SELECT 'communication_intents',count(*) FROM public.communication_intents
UNION ALL SELECT 'marketplace_runtime_settings',count(*) FROM public.marketplace_runtime_settings
ORDER BY object_name;

-- Read-only operational activity snapshot. It is a diagnostic, NOT a maintenance lock.
-- Absence of heartbeat does not prove that external VPS/cron/queues/providers are stopped.
SELECT now() AS inspected_at_utc,
  (SELECT count(*) FROM public.scale_worker_heartbeats) AS registered_worker_rows,
  (SELECT count(*) FROM public.scale_worker_heartbeats WHERE accepting_work) AS workers_accepting_work,
  (SELECT coalesce(sum(in_flight),0) FROM public.scale_worker_heartbeats) AS worker_in_flight,
  (SELECT count(*) FROM public.scale_worker_heartbeats
   WHERE heartbeat_at > now()-interval '5 minutes') AS workers_recently_heartbeat,
  (SELECT count(*) FROM public.communication_conversation_outbox
   WHERE status NOT IN ('sent','failed','cancelled','dead_letter')) AS active_conversation_outbox,
  (SELECT count(*) FROM public.communication_jarvis_turn_outbox
   WHERE status NOT IN ('completed','failed','cancelled','dead_letter')) AS active_jarvis_outbox,
  (SELECT count(*) FROM public.communication_provider_runtime_policies
   WHERE outbound_enabled) AS enabled_provider_outbound_policies,
  (SELECT count(*) FROM public.communication_provider_runtime_policies
   WHERE webhook_processing_enabled) AS enabled_webhook_policies;

-- A real freeze additionally requires an independently verified stop of out-of-DB
-- workers and provider callbacks, and an operator-signed maintenance window.
