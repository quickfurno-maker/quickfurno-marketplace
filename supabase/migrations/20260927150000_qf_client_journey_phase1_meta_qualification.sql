-- QuickFurno Client Journey V2 Phase 1 — governed Meta qualification mapping.
-- Environment-neutral migration: seed APPROVED + INACTIVE, activate only through
-- one SECURITY DEFINER RPC after local runtime/account/queue truth is re-proven.

begin;

do $catalogue$
declare
  v_row public.communication_templates%rowtype;
begin
  select * into v_row
  from public.communication_templates
  where template_key = 'clarification_request';

  if v_row.template_key is null then
    insert into public.communication_templates (
      template_key, channel, category, description, language, version,
      readiness_status, is_active
    ) values (
      'clarification_request', 'whatsapp', 'business',
      'Client Journey V2 requirement clarification request and reminder',
      'en', '1.0', 'provider_mapping_required', true
    );
  elsif v_row.channel <> 'whatsapp'
     or v_row.category <> 'business'
     or v_row.language <> 'en'
     or v_row.version <> '1.0'
     or v_row.is_active is not true then
    raise exception 'QF_CJ_META_TEMPLATE_CATALOGUE_DRIFT' using errcode = 'P0001';
  end if;
end
$catalogue$;
do $seed$
declare
  v_row public.communication_provider_template_mappings%rowtype;
  v_count integer;
  c_schema constant jsonb := '{
    "bindingVersion": 1,
    "bindings": [
      {"component":"body","position":1,"sourceKey":"client_name","parameterType":"text"},
      {"component":"body","position":2,"sourceKey":"outstanding_item","parameterType":"text"}
    ]
  }'::jsonb;
begin
  select count(*)::integer into v_count
  from public.communication_provider_template_mappings
  where template_key = 'clarification_request'
    and channel = 'whatsapp'
    and provider_key = 'meta_whatsapp_cloud'
    and language = 'en'
    and version = '1.0';

  if v_count > 1 then
    raise exception 'QF_CJ_META_MAPPING_AMBIGUOUS' using errcode = 'P0001';
  end if;

  if v_count = 0 then
    insert into public.communication_provider_template_mappings (
      template_key, channel, provider_key, language, version,
      provider_template_name, provider_template_id, provider_category,
      approval_status, quality_status, variables_schema, is_active
    ) values (
      'clarification_request', 'whatsapp', 'meta_whatsapp_cloud', 'en', '1.0',
      'qf_clarification_request_v2', '1374658884649762', 'utility',
      'approved', 'unknown', c_schema, false
    );
  else
    select * into v_row
    from public.communication_provider_template_mappings
    where template_key = 'clarification_request'
      and channel = 'whatsapp'
      and provider_key = 'meta_whatsapp_cloud'
      and language = 'en'
      and version = '1.0';

    if v_row.provider_template_name is distinct from 'qf_clarification_request_v2'
       or v_row.provider_template_id is distinct from '1374658884649762'
       or v_row.provider_category is distinct from 'utility'
       or v_row.approval_status is distinct from 'approved'
       or v_row.variables_schema is distinct from c_schema
       or v_row.is_active is not false then
      raise exception 'QF_CJ_META_MAPPING_DRIFT' using errcode = 'P0001';
    end if;
  end if;
end
$seed$;

create or replace function public.qf_activate_meta_client_qualification_v1(
  p_activation_evidence_digest text
)
returns table (
  activated_template_key text,
  activated_provider_template_name text,
  activated_provider_template_id text,
  active_mapping_count integer,
  account_ready boolean,
  policy_active boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  c_schema constant jsonb := '{
    "bindingVersion": 1,
    "bindings": [
      {"component":"body","position":1,"sourceKey":"client_name","parameterType":"text"},
      {"component":"body","position":2,"sourceKey":"outstanding_item","parameterType":"text"}
    ]
  }'::jsonb;
  c_existing_active constant text[] := array[
    'lead_assignment_alert',
    'lead_received',
    'client_lead_status_update',
    'client_matching_update',
    'vendor_onboarding_reminder'
  ];
  c_after_active constant text[] := array[
    'lead_assignment_alert',
    'lead_received',
    'client_lead_status_update',
    'client_matching_update',
    'vendor_onboarding_reminder',
    'clarification_request'
  ];
  v_account public.communication_provider_accounts%rowtype;
  v_policy public.communication_provider_runtime_policies%rowtype;
  v_mapping public.communication_provider_template_mappings%rowtype;
  v_count integer;
begin
  if p_activation_evidence_digest is null
     or p_activation_evidence_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'QF_CJ_META_EVIDENCE_DIGEST_INVALID' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_count
  from public.communication_provider_accounts
  where provider_key = 'meta_whatsapp_cloud'
    and channel = 'whatsapp'
    and account_alias = 'core'
    and account_role = 'transactional'
    and is_default_for_role is true;

  if v_count <> 1 then
    raise exception 'QF_CJ_META_CORE_ACCOUNT_NOT_EXACTLY_ONE' using errcode = 'P0001';
  end if;

  select * into v_account
  from public.communication_provider_accounts
  where provider_key = 'meta_whatsapp_cloud'
    and channel = 'whatsapp'
    and account_alias = 'core'
    and account_role = 'transactional'
    and is_default_for_role is true
  for update;

  if v_account.readiness_status <> 'provider_ready'
     or v_account.configuration_status <> 'complete'
     or v_account.business_verification_status <> 'verified'
     or v_account.phone_number_status <> 'connected'
     or v_account.webhook_status <> 'verified'
     or v_account.billing_status <> 'active'
     or v_account.health_status <> 'healthy' then
    raise exception 'QF_CJ_META_CORE_ACCOUNT_NOT_READY' using errcode = 'P0001';
  end if;

  select * into v_policy
  from public.communication_provider_runtime_policies
  where provider_key = 'meta_whatsapp_cloud'
    and channel = 'whatsapp'
  for update;

  if v_policy.id is null
     or v_policy.activation_status <> 'active'
     or v_policy.outbound_enabled is not true
     or v_policy.webhook_processing_enabled is not true
     or v_policy.health_check_enabled is not true then
    raise exception 'QF_CJ_META_RUNTIME_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_count
  from public.communication_provider_canary_destinations
  where provider_key = 'meta_whatsapp_cloud'
    and channel = 'whatsapp'
    and is_active;
  if v_count <> 0 then
    raise exception 'QF_CJ_META_ACTIVE_CANARY_PRESENT' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_count
  from public.automation_jobs
  where status in ('pending','processing','retry_scheduled','uncertain');
  if v_count <> 0 then
    raise exception 'QF_CJ_META_NONTERMINAL_JOBS_PRESENT' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_count
  from public.automation_execution_attempts
  where status = 'started';
  if v_count <> 0 then
    raise exception 'QF_CJ_META_NONTERMINAL_ATTEMPTS_PRESENT' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_count
  from public.communication_provider_template_mappings
  where provider_key = 'meta_whatsapp_cloud'
    and channel = 'whatsapp'
    and is_active;

  if v_count <> 5
     or exists (
       select 1
       from public.communication_provider_template_mappings
       where provider_key = 'meta_whatsapp_cloud'
         and channel = 'whatsapp'
         and is_active
         and not (template_key = any(c_existing_active))
     )
     or exists (
       select 1
       from unnest(c_existing_active) k(template_key)
       where not exists (
         select 1
         from public.communication_provider_template_mappings m
         where m.provider_key = 'meta_whatsapp_cloud'
           and m.channel = 'whatsapp'
           and m.template_key = k.template_key
           and m.is_active
       )
     ) then
    raise exception 'QF_CJ_META_EXISTING_ACTIVE_SET_DRIFT' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_count
  from public.communication_provider_template_mappings
  where template_key = 'clarification_request'
    and channel = 'whatsapp'
    and provider_key = 'meta_whatsapp_cloud'
    and language = 'en'
    and version = '1.0';

  if v_count <> 1 then
    raise exception 'QF_CJ_META_MAPPING_NOT_EXACTLY_ONE' using errcode = 'P0001';
  end if;

  select * into v_mapping
  from public.communication_provider_template_mappings
  where template_key = 'clarification_request'
    and channel = 'whatsapp'
    and provider_key = 'meta_whatsapp_cloud'
    and language = 'en'
    and version = '1.0'
  for update;

  if v_mapping.provider_template_name is distinct from 'qf_clarification_request_v2'
     or v_mapping.provider_template_id is distinct from '1374658884649762'
     or v_mapping.provider_category is distinct from 'utility'
     or v_mapping.approval_status is distinct from 'approved'
     or v_mapping.variables_schema is distinct from c_schema
     or v_mapping.is_active is not false then
    raise exception 'QF_CJ_META_MAPPING_NOT_ACTIVATABLE' using errcode = 'P0001';
  end if;

  update public.communication_provider_template_mappings
  set is_active = true,
      updated_at = now()
  where id = v_mapping.id;

  select count(*)::integer into v_count
  from public.communication_provider_template_mappings
  where provider_key = 'meta_whatsapp_cloud'
    and channel = 'whatsapp'
    and is_active;

  if v_count <> 6
     or exists (
       select 1
       from public.communication_provider_template_mappings
       where provider_key = 'meta_whatsapp_cloud'
         and channel = 'whatsapp'
         and is_active
         and not (template_key = any(c_after_active))
     )
     or exists (
       select 1
       from unnest(c_after_active) k(template_key)
       where not exists (
         select 1
         from public.communication_provider_template_mappings m
         where m.provider_key = 'meta_whatsapp_cloud'
           and m.channel = 'whatsapp'
           and m.template_key = k.template_key
           and m.is_active
       )
     ) then
    raise exception 'QF_CJ_META_POST_ACTIVE_SET_DRIFT' using errcode = 'P0001';
  end if;

  return query
  select
    'clarification_request'::text,
    'qf_clarification_request_v2'::text,
    '1374658884649762'::text,
    v_count,
    true,
    true;
end;
$$;

revoke all on function public.qf_activate_meta_client_qualification_v1(text) from public;
revoke all on function public.qf_activate_meta_client_qualification_v1(text) from anon;
revoke all on function public.qf_activate_meta_client_qualification_v1(text) from authenticated;
grant execute on function public.qf_activate_meta_client_qualification_v1(text) to service_role;

comment on function public.qf_activate_meta_client_qualification_v1(text) is
  'Client Journey V2 Phase 1. Activates only clarification_request -> qf_clarification_request_v2 after exact Core transactional account readiness, active Meta runtime, zero canaries, zero nonterminal automation work, exact five-template active pre-state, exact approved Utility provider mapping and a 64-hex audit digest. The function cannot activate any other template, account, provider, channel or marketing mapping.';

do $postcondition$
declare
  v_count integer;
begin
  select count(*)::integer into v_count
  from public.communication_provider_template_mappings
  where template_key = 'clarification_request'
    and channel = 'whatsapp'
    and provider_key = 'meta_whatsapp_cloud'
    and language = 'en'
    and version = '1.0'
    and provider_template_name = 'qf_clarification_request_v2'
    and provider_template_id = '1374658884649762'
    and provider_category = 'utility'
    and approval_status = 'approved'
    and is_active is false;

  if v_count <> 1 then
    raise exception 'QF_CJ_META_SEED_POSTCONDITION_FAILED' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.communication_provider_template_mappings
    where template_key = 'clarification_reminder'
      and provider_key = 'meta_whatsapp_cloud'
      and channel = 'whatsapp'
      and is_active
  ) then
    raise exception 'QF_CJ_META_MARKETING_REMINDER_ACTIVE_FORBIDDEN' using errcode = 'P0001';
  end if;

  if to_regprocedure('public.qf_activate_meta_client_qualification_v1(text)') is null then
    raise exception 'QF_CJ_META_ACTIVATION_RPC_MISSING' using errcode = 'P0001';
  end if;
end
$postcondition$;

commit;
