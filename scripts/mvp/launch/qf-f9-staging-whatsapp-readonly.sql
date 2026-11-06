-- QuickFurno F9: read-only two-number Staging certification inventory.
-- Must run against Supabase STAGING uckafzuochmbvtiodmcl, never Production.
-- No passwords, credentials, OTPs, contact numbers, identity documents or writes.
-- A returned pass proves ONLY dormant configuration, not Auth Hook E2E readiness.
WITH
accounts AS (
 SELECT
   count(*) FILTER (WHERE provider_key='meta_whatsapp_cloud' AND channel='whatsapp'
     AND business_account_reference='27861262223494153'
     AND phone_number_reference='1333595106493545'
     AND account_alias='riya_client' AND readiness_status='disabled') AS client_exact_disabled,
   count(*) FILTER (WHERE provider_key='meta_whatsapp_cloud' AND channel='whatsapp'
     AND business_account_reference='1569174604351612'
     AND phone_number_reference='1088396637681784'
     AND readiness_status='disabled') AS vendor_exact_disabled,
   count(*) FILTER (WHERE provider_key='meta_whatsapp_cloud' AND channel='whatsapp'
     AND phone_number_reference IN ('1333595106493545','1088396637681784')) AS total_sender_records
 FROM public.communication_provider_accounts
),
policy AS (
 SELECT count(*) FILTER (WHERE activation_status='disabled'
   AND outbound_enabled=false AND webhook_processing_enabled=false) AS fully_disabled,
   count(*) AS policy_rows
 FROM public.communication_provider_runtime_policies
 WHERE provider_key='meta_whatsapp_cloud' AND channel='whatsapp'
),
mappings AS (
 SELECT
 count(*) FILTER (WHERE template_key IN ('client_login_otp','vendor_login_otp')
   AND is_active) AS active_mappings,
 count(*) FILTER (WHERE template_key='client_login_otp' AND provider_key='meta_whatsapp_cloud'
   AND provider_template_id='1793889608370870' AND provider_template_name='qf_client_auth_otp'
   AND approval_status='approved' AND NOT is_active) AS dormant_correct_client_mapping,
 count(*) FILTER (WHERE template_key='vendor_login_otp' AND provider_key='meta_whatsapp_cloud'
   AND provider_template_id='1640977640737783' AND provider_template_name='qf_vendor_auth_otp'
   AND approval_status='approved' AND NOT is_active) AS dormant_correct_vendor_mapping
 FROM public.communication_provider_template_mappings
),
automations AS (
 SELECT count(*) FILTER (WHERE automation_key IN ('client_login_otp','vendor_login_otp')
   AND is_operationally_enabled) AS active_automations,
 count(*) FILTER (WHERE automation_key='client_login_otp'
   AND NOT is_operationally_enabled) AS dormant_client_automation,
 count(*) FILTER (WHERE automation_key='vendor_login_otp'
   AND NOT is_operationally_enabled) AS dormant_vendor_automation
 FROM public.communication_automation_catalog
),
templates AS (
 SELECT count(*) FILTER (WHERE template_key IN ('client_login_otp','vendor_login_otp')
   AND is_active) AS active_templates
 FROM public.communication_templates
),
messages AS (
 SELECT count(*) AS otp_messages FROM public.communication_messages
 WHERE message_type IN ('client_login_otp','vendor_login_otp')
),
security AS (
 SELECT count(*) AS verified_service_only_functions
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN (
   'qf_claim_auth_otp_purpose','qf_read_claimed_vendor_auth_otp_purpose',
   'qf_release_auth_otp_purpose','qf_reserve_auth_otp_purpose')
 AND p.prosecdef
 AND has_function_privilege('service_role',p.oid,'EXECUTE')
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
 AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
),
migration AS (
 SELECT count(*) AS f7_f8_migrations_applied
 FROM supabase_migrations.schema_migrations
 WHERE version IN ('20261106113825','20261106114301','20261106120124')
)
SELECT 'qf.f9.whatsapp.staging-no-send.v1' AS evidence_schema,
 a.client_exact_disabled,a.vendor_exact_disabled,a.total_sender_records,
 p.fully_disabled,p.policy_rows,
 m.active_mappings,m.dormant_correct_client_mapping,m.dormant_correct_vendor_mapping,
 c.active_automations,c.dormant_client_automation,c.dormant_vendor_automation,
 t.active_templates,ms.otp_messages,s.verified_service_only_functions,
 mig.f7_f8_migrations_applied,
 (a.client_exact_disabled=1 AND a.vendor_exact_disabled=1 AND a.total_sender_records=2
   AND p.fully_disabled=1 AND p.policy_rows=1
   AND m.active_mappings=0 AND m.dormant_correct_client_mapping=1
   AND m.dormant_correct_vendor_mapping=1
   AND c.active_automations=0 AND c.dormant_client_automation=1
   AND c.dormant_vendor_automation=1 AND t.active_templates=0
   AND ms.otp_messages=0 AND s.verified_service_only_functions=4
   AND mig.f7_f8_migrations_applied=3) AS dormant_preflight_pass,
 FALSE AS actual_live_otp_e2e_certified,
 FALSE AS meta_vendor_quality_green_independently_verified,
 FALSE AS owner_production_go
FROM accounts a CROSS JOIN policy p CROSS JOIN mappings m CROSS JOIN automations c
 CROSS JOIN templates t CROSS JOIN messages ms CROSS JOIN security s CROSS JOIN migration mig;
