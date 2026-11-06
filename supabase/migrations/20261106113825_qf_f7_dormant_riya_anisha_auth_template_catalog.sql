
-- F7 Staging foundation: Meta-approved auth templates, but NO outbound activation.
-- Riya/client WABA 27861262223494153 / phone 1333595106493545
-- Anisha/vendor WABA 1569174604351612 / phone 1088396637681784
-- The account WABA repair was independently completed under a separate guarded
-- staging update. This migration only seeds DISABLED communication catalog rows.
-- Variable bindings need controlled certification before any future activation.
DO $qf_f7$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.communication_templates
    WHERE template_key IN ('client_login_otp','vendor_login_otp') AND is_active = true
  ) OR EXISTS (
    SELECT 1 FROM public.communication_automation_catalog
    WHERE automation_key IN ('client_login_otp','vendor_login_otp') AND is_operationally_enabled = true
  ) OR EXISTS (
    SELECT 1 FROM public.communication_provider_template_mappings
    WHERE template_key IN ('client_login_otp','vendor_login_otp') AND is_active = true
  ) THEN
    RAISE EXCEPTION 'F7_DENIED_EXISTING_ACTIVE_OTP_CONFIG';
  END IF;

  INSERT INTO public.communication_templates
    (template_key,channel,category,description,language,version,
     provider_template_name,provider_template_id,readiness_status,is_active)
  VALUES
    ('client_login_otp','whatsapp','authentication','Riya client-only Meta authentication OTP; integration held','en','1.0.0',
      'qf_client_auth_otp','1793889608370870','provider_mapping_required',false),
    ('vendor_login_otp','whatsapp','authentication','Anisha vendor-only Meta authentication OTP; quality RED and integration held','en','1.0.0',
      'qf_vendor_auth_otp','1640977640737783','provider_mapping_required',false)
  ON CONFLICT (template_key) DO NOTHING;

  INSERT INTO public.communication_automation_catalog
    (automation_key,category,description,lane,channel,readiness_status,
     provider_required,template_key,is_operationally_enabled)
  VALUES
    ('client_login_otp','otp','Riya client-only signed Supabase WhatsApp OTP; disabled','authentication','whatsapp','provider_mapping_required',
      'meta_whatsapp_cloud','client_login_otp',false),
    ('vendor_login_otp','otp','Anisha vendor-only signed Supabase WhatsApp OTP; disabled','authentication','whatsapp','provider_mapping_required',
      'meta_whatsapp_cloud','vendor_login_otp',false)
  ON CONFLICT (automation_key) DO NOTHING;

  INSERT INTO public.communication_provider_template_mappings
    (template_key,channel,provider_key,language,provider_template_name,
     provider_template_id,provider_category,approval_status,quality_status,
     version,variables_schema,is_active)
  SELECT x.template_key,'whatsapp','meta_whatsapp_cloud','en',
         x.provider_template_name,x.provider_template_id,'authentication','approved',
         'unknown','1.0',
         '{"bindingVersion":1,"bindings":[]}'::jsonb,false
  FROM (VALUES
    ('client_login_otp','qf_client_auth_otp','1793889608370870'),
    ('vendor_login_otp','qf_vendor_auth_otp','1640977640737783')
  ) AS x(template_key,provider_template_name,provider_template_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.communication_provider_template_mappings m
    WHERE m.template_key=x.template_key AND m.channel='whatsapp'
      AND m.provider_key='meta_whatsapp_cloud' AND m.language='en'
  );

  IF (
    SELECT count(*) FROM public.communication_templates t
    WHERE (t.template_key='client_login_otp' AND t.provider_template_id='1793889608370870')
       OR (t.template_key='vendor_login_otp' AND t.provider_template_id='1640977640737783')
  ) <> 2 OR (
    SELECT count(*) FROM public.communication_automation_catalog a
    WHERE a.automation_key IN ('client_login_otp','vendor_login_otp')
      AND a.provider_required='meta_whatsapp_cloud'
      AND a.lane='authentication' AND a.channel='whatsapp'
      AND a.is_operationally_enabled=false
  ) <> 2 OR (
    SELECT count(*) FROM public.communication_provider_template_mappings m
    WHERE (m.template_key='client_login_otp' AND m.provider_template_id='1793889608370870'
       AND m.provider_template_name='qf_client_auth_otp' AND m.is_active=false)
       OR (m.template_key='vendor_login_otp' AND m.provider_template_id='1640977640737783'
       AND m.provider_template_name='qf_vendor_auth_otp' AND m.is_active=false)
  ) <> 2 OR EXISTS (
    SELECT 1 FROM public.communication_templates t
    WHERE t.template_key IN ('client_login_otp','vendor_login_otp') AND t.is_active=true
  ) THEN
    RAISE EXCEPTION 'F7_INACTIVE_AUTH_CATALOG_INCOMPLETE_OR_MISMATCH';
  END IF;
END $qf_f7$;