-- F8: insert the independently Meta-verified CLIENT/Riya WABA as an INACTIVE Staging provider.
-- Never alter the existing vendor sender, enable messaging, or declare webhook/billing ready.
DO $qf_f8$
DECLARE inserted_count integer;
BEGIN
  IF (SELECT count(*) FROM public.communication_provider_accounts
      WHERE provider_key='meta_whatsapp_cloud' AND channel='whatsapp'
        AND business_account_reference='1569174604351612'
        AND phone_number_reference='1088396637681784'
        AND readiness_status='disabled') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.communication_provider_runtime_policies
       WHERE provider_key='meta_whatsapp_cloud' AND channel='whatsapp'
         AND activation_status='disabled'
         AND outbound_enabled=false AND webhook_processing_enabled=false
     )
     OR EXISTS (
       SELECT 1 FROM public.communication_provider_accounts
       WHERE (provider_key='meta_whatsapp_cloud' AND channel='whatsapp'
          AND (phone_number_reference='1333595106493545' OR
               business_account_reference='27861262223494153'))
         AND NOT (phone_number_reference='1333595106493545' AND
                  business_account_reference='27861262223494153')
     )
  THEN
    RAISE EXCEPTION 'F8_BLOCKED_PROVIDER_PRESTATE_NOT_SAFE';
  END IF;

  INSERT INTO public.communication_provider_accounts (
    provider_key, channel, display_name, business_account_reference,
    phone_number_reference, readiness_status, configuration_status,
    business_verification_status, phone_number_status, webhook_status,
    billing_status, health_status, account_alias, account_role,
    jarvis_access_mode, is_default_for_role, metadata
  )
  SELECT
    'meta_whatsapp_cloud','whatsapp','QuickFurno Riya Client WhatsApp',
    '27861262223494153','1333595106493545',
    'disabled','pending','unknown','connected','pending',
    'unknown','unknown','riya_client','conversational',
    'denied',false,
    '{"qf_lane":"client","qf_agent":"riya","status":"staging_identity_inventory_only"}'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.communication_provider_accounts
    WHERE provider_key='meta_whatsapp_cloud' AND channel='whatsapp'
      AND phone_number_reference='1333595106493545'
      AND business_account_reference='27861262223494153'
  );
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count NOT IN (0,1) THEN
    RAISE EXCEPTION 'F8_UNEXPECTED_INSERT_COUNT';
  END IF;

  IF (SELECT count(*) FROM public.communication_provider_accounts
      WHERE provider_key='meta_whatsapp_cloud' AND channel='whatsapp'
        AND phone_number_reference IN ('1333595106493545','1088396637681784')) <> 2
     OR NOT EXISTS (
       SELECT 1 FROM public.communication_provider_accounts
       WHERE provider_key='meta_whatsapp_cloud' AND channel='whatsapp'
         AND business_account_reference='27861262223494153'
         AND phone_number_reference='1333595106493545'
         AND account_alias='riya_client'
         AND account_role='conversational'
         AND readiness_status='disabled'
         AND configuration_status='pending'
         AND webhook_status='pending'
         AND jarvis_access_mode='denied'
         AND is_default_for_role=false
     )
     OR EXISTS (
       SELECT 1 FROM public.communication_provider_runtime_policies
       WHERE provider_key='meta_whatsapp_cloud' AND channel='whatsapp'
         AND (outbound_enabled OR webhook_processing_enabled OR activation_status<>'disabled')
     )
     OR EXISTS (
       SELECT 1 FROM public.communication_automation_catalog
       WHERE automation_key IN ('client_login_otp','vendor_login_otp')
         AND is_operationally_enabled=true
     )
     OR EXISTS (
       SELECT 1 FROM public.communication_provider_template_mappings
       WHERE template_key IN ('client_login_otp','vendor_login_otp') AND is_active=true
     )
  THEN
    RAISE EXCEPTION 'F8_STAGING_ACCOUNT_INVENTORY_POSTSTATE_FAILED';
  END IF;
END $qf_f8$;