-- QuickFurno Client Journey V2 Phase 1 qualification mapping certification.
-- STAGING ONLY. Deliberately outside supabase/migrations.
-- Seeds provider evidence but grants NO send authority.
-- Do not execute against production.

begin;

do $guard$
declare
  v_policy record;
begin
  select activation_status, outbound_enabled, webhook_processing_enabled, health_check_enabled
  into v_policy
  from public.communication_provider_runtime_policies
  where provider_key = 'meta_whatsapp_cloud'
    and channel = 'whatsapp';

  if v_policy is null
     or v_policy.activation_status <> 'disabled'
     or v_policy.outbound_enabled is not false
     or v_policy.webhook_processing_enabled is not false
     or v_policy.health_check_enabled is not false then
    raise exception 'QF_PHASE1_STAGING_META_MUST_REMAIN_DISABLED';
  end if;

  if exists (
    select 1 from public.communication_provider_template_mappings
    where template_key = 'clarification_reminder'
  ) then
    raise exception 'QF_PHASE1_MARKETING_REMINDER_MAPPING_FORBIDDEN';
  end if;
end
$guard$;
insert into public.communication_templates (
  template_key, channel, category, description, language, version,
  provider_template_name, provider_template_id, readiness_status, is_active
) values (
  'clarification_request', 'whatsapp', 'business',
  'Client Journey V2 requirement clarification request and reminder',
  'en', '1.0', null, null, 'provider_mapping_required', true
)
on conflict (template_key) do nothing;

do $template_guard$
declare
  v_template record;
begin
  select * into v_template
  from public.communication_templates
  where template_key = 'clarification_request';

  if v_template is null
     or v_template.channel <> 'whatsapp'
     or v_template.category <> 'business'
     or v_template.language <> 'en'
     or v_template.version <> '1.0'
     or v_template.readiness_status <> 'provider_mapping_required'
     or v_template.is_active is not true then
    raise exception 'QF_PHASE1_CLARIFICATION_TEMPLATE_DRIFT';
  end if;
end
$template_guard$;

insert into public.communication_provider_template_mappings (
  template_key, channel, provider_key, language,
  provider_template_name, provider_template_id, provider_category,
  approval_status, quality_status, version, variables_schema,
  submission_reference, approved_at, last_synced_at, is_active
) values (
  'clarification_request', 'whatsapp', 'meta_whatsapp_cloud', 'en',
  'qf_clarification_request_v2', '1374658884649762', 'utility',
  'approved', 'unknown', '1.0',
  '{"bindingVersion":1,"bindings":[{"component":"body","position":1,"sourceKey":"client_name","parameterType":"text"},{"component":"body","position":2,"sourceKey":"outstanding_item","parameterType":"text"}]}'::jsonb,
  'meta-staging-clarification-request-v2-reconciliation',
  null, now(), false
)
on conflict (template_key, channel, provider_key, language, version) do nothing;

do $mapping_guard$
declare
  v_mapping record;
begin
  select * into v_mapping
  from public.communication_provider_template_mappings
  where template_key = 'clarification_request'
    and channel = 'whatsapp'
    and provider_key = 'meta_whatsapp_cloud'
    and language = 'en'
    and version = '1.0';

  if v_mapping is null
     or v_mapping.provider_template_name <> 'qf_clarification_request_v2'
     or v_mapping.provider_template_id <> '1374658884649762'
     or v_mapping.provider_category <> 'utility'
     or v_mapping.approval_status <> 'approved'
     or v_mapping.is_active is not false then
    raise exception 'QF_PHASE1_CLARIFICATION_MAPPING_DRIFT';
  end if;
  if v_mapping.variables_schema <> '{"bindingVersion":1,"bindings":[{"component":"body","position":1,"sourceKey":"client_name","parameterType":"text"},{"component":"body","position":2,"sourceKey":"outstanding_item","parameterType":"text"}]}'::jsonb then
    raise exception 'QF_PHASE1_CLARIFICATION_BINDING_DRIFT';
  end if;

  if exists (
    select 1 from public.communication_provider_template_mappings
    where template_key = 'clarification_request'
      and is_active is true
  ) then
    raise exception 'QF_PHASE1_CLARIFICATION_MAPPING_MUST_STAY_INACTIVE';
  end if;
end
$mapping_guard$;

do $postcondition$
begin
  if exists (
    select 1
    from public.communication_provider_runtime_policies
    where provider_key = 'meta_whatsapp_cloud'
      and channel = 'whatsapp'
      and (
        activation_status <> 'disabled'
        or outbound_enabled is true
        or webhook_processing_enabled is true
        or health_check_enabled is true
      )
  ) then
    raise exception 'QF_PHASE1_STAGING_META_WIDENED';
  end if;
end
$postcondition$;

commit;
