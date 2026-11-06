
-- F7 correct Meta AUTHENTICATION Copy Code v2 bindings.
-- Each approved template needs OTP twice: body text + URL button index 0.
-- Only inactive Staging mappings may change. NO activation, no provider calls.
DO $qf_f7$
DECLARE changed integer;
BEGIN
  IF (SELECT count(*) FROM public.communication_provider_template_mappings m
      WHERE m.is_active = false AND m.provider_key='meta_whatsapp_cloud'
        AND m.channel='whatsapp' AND m.language='en'
        AND m.approval_status='approved'
        AND m.variables_schema='{"bindingVersion":1,"bindings":[]}'::jsonb
        AND (
          (m.template_key='client_login_otp' AND
           m.provider_template_name='qf_client_auth_otp' AND
           m.provider_template_id='1793889608370870') OR
          (m.template_key='vendor_login_otp' AND
           m.provider_template_name='qf_vendor_auth_otp' AND
           m.provider_template_id='1640977640737783')
        )) <> 2 THEN
    RAISE EXCEPTION 'F7_OTP_COPY_CODE_BINDINGS_PRESTATE_MISMATCH';
  END IF;

  UPDATE public.communication_provider_template_mappings m
    SET variables_schema = '{
      "bindingVersion":2,
      "profile":"AUTH_OTP_COPY_CODE",
      "bindings":[
        {"component":"body","position":1,"sourceKey":"otp","parameterType":"text"},
        {"component":"button","position":1,"sourceKey":"otp","parameterType":"text",
         "buttonIndex":0,"buttonSubType":"url"}
      ]
    }'::jsonb,
    version='1.1',
    updated_at=now()
  WHERE m.is_active = false AND m.provider_key='meta_whatsapp_cloud'
    AND m.channel='whatsapp' AND m.language='en'
    AND m.approval_status='approved'
    AND m.variables_schema='{"bindingVersion":1,"bindings":[]}'::jsonb
    AND (
      (m.template_key='client_login_otp' AND
       m.provider_template_name='qf_client_auth_otp' AND
       m.provider_template_id='1793889608370870') OR
      (m.template_key='vendor_login_otp' AND
       m.provider_template_name='qf_vendor_auth_otp' AND
       m.provider_template_id='1640977640737783')
    );

  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 2 THEN
    RAISE EXCEPTION 'F7_OTP_COPY_CODE_BINDINGS_WRITE_COUNT_MISMATCH';
  END IF;
  IF (SELECT count(*) FROM public.communication_provider_template_mappings m
      WHERE m.template_key IN ('client_login_otp','vendor_login_otp')
        AND m.is_active=false AND m.version='1.1'
        AND m.variables_schema->>'profile'='AUTH_OTP_COPY_CODE'
        AND (m.variables_schema->>'bindingVersion')::integer=2
        AND jsonb_array_length(m.variables_schema->'bindings')=2
     ) <> 2 OR EXISTS (
      SELECT 1 FROM public.communication_automation_catalog a
      WHERE a.automation_key IN ('client_login_otp','vendor_login_otp')
        AND a.is_operationally_enabled
     ) THEN
    RAISE EXCEPTION 'F7_OTP_COPY_CODE_POSTSTATE_OR_ACTIVATION_MISMATCH';
  END IF;
END $qf_f7$;