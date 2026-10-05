-- SCALE-P14 / AGNI — independent supervisory reliability + security governance.
-- QuickFurno Core owns proposal approval truth and capability minting metadata.
-- AGNI owns no business authority and cannot mutate this ledger directly.

create table if not exists public.agni_action_proposals (
  id uuid primary key,
  incident_id uuid not null,
  target_system text not null check (target_system in ('QUICKFURNO','JARVIS')),
  target_service text not null,
  action_type text not null check (action_type in (
    'RUN_SYNTHETIC_TEST','RESTART_SERVICE','SCALE_SERVICE','ROLLBACK_RELEASE',
    'TEMPORARY_RATE_LIMIT','PAUSE_AI_AUTOMATION','ENTER_RESTRICTED_MODE',
    'ROTATE_SERVICE_CREDENTIAL'
  )),
  action_payload jsonb not null,
  action_fingerprint text not null,
  risk text not null check (risk in ('LOW','MEDIUM','HIGH','CRITICAL')),
  requested_approval_mode text not null check (requested_approval_mode in ('NONE','PREAUTHORIZED_POLICY','HUMAN')),
  expected_revision bigint,
  evidence_refs jsonb not null default '[]'::jsonb,
  expected_effect_code text not null,
  rollback_code text not null,
  source_trace_id text not null,
  source_correlation_id text not null,
  decision_status text not null default 'requested' check (decision_status in ('requested','authorized','rejected')),
  decision_id uuid,
  decision_at timestamptz,
  decision_actor_id text,
  decision_reason_code text,
  policy_evidence_ref text,
  critic_evidence_ref text,
  capability_id uuid unique,
  capability_nonce text unique,
  capability_issued_at timestamptz,
  capability_expires_at timestamptz,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint agni_action_proposals_fingerprint check (action_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint agni_action_proposals_target_service check (target_service ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'),
  constraint agni_action_proposals_machine_codes check (
    expected_effect_code ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'
    and rollback_code ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'
  ),
  constraint agni_action_proposals_revision check (expected_revision is null or expected_revision >= 0),
  constraint agni_action_proposals_payload_shape check (
    jsonb_typeof(action_payload)='object'
    and octet_length(action_payload::text) <= 4096
  ),
  constraint agni_action_proposals_evidence_shape check (
    jsonb_typeof(evidence_refs)='array'
    and jsonb_array_length(evidence_refs) <= 16
    and octet_length(evidence_refs::text) <= 4096
  ),
  constraint agni_action_proposals_time_window check (
    expires_at > created_at and expires_at <= created_at + interval '30 minutes'
  ),
  constraint agni_action_proposals_decision_shape check (
    (
      decision_status='requested'
      and decision_id is null
      and decision_at is null
      and decision_actor_id is null
      and decision_reason_code is null
      and capability_id is null
      and capability_nonce is null
      and capability_issued_at is null
      and capability_expires_at is null
    )
    or (
      decision_status='rejected'
      and decision_id is not null
      and decision_at is not null
      and decision_actor_id is not null
      and decision_reason_code is not null
      and capability_id is null
      and capability_nonce is null
      and capability_issued_at is null
      and capability_expires_at is null
    )
    or (
      decision_status='authorized'
      and decision_id is not null
      and decision_at is not null
      and decision_actor_id is not null
      and decision_reason_code is not null
      and policy_evidence_ref is not null
      and critic_evidence_ref is not null
      and capability_id is not null
      and capability_nonce is not null
      and capability_issued_at is not null
      and capability_expires_at is not null
      and capability_expires_at > capability_issued_at
      and capability_expires_at <= capability_issued_at + interval '10 minutes'
    )
  )
);

create index if not exists idx_agni_action_proposals_decision
  on public.agni_action_proposals(decision_status, created_at desc);

create index if not exists idx_agni_action_proposals_incident
  on public.agni_action_proposals(incident_id, created_at desc);

create or replace function public.qf_agni_proposal_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'AGNI_PROPOSAL_DELETE_FORBIDDEN';
  end if;
  if tg_op = 'UPDATE' then
    if (
      new.id,
      new.incident_id,
      new.target_system,
      new.target_service,
      new.action_type,
      new.action_payload,
      new.action_fingerprint,
      new.risk,
      new.requested_approval_mode,
      new.expected_revision,
      new.evidence_refs,
      new.expected_effect_code,
      new.rollback_code,
      new.policy_evidence_ref,
      new.critic_evidence_ref,
      new.source_trace_id,
      new.source_correlation_id,
      new.created_at,
      new.expires_at
    ) is distinct from (
      old.id,
      old.incident_id,
      old.target_system,
      old.target_service,
      old.action_type,
      old.action_payload,
      old.action_fingerprint,
      old.risk,
      old.requested_approval_mode,
      old.expected_revision,
      old.evidence_refs,
      old.expected_effect_code,
      old.rollback_code,
      old.policy_evidence_ref,
      old.critic_evidence_ref,
      old.source_trace_id,
      old.source_correlation_id,
      old.created_at,
      old.expires_at
    ) then
      raise exception 'AGNI_PROPOSAL_IMMUTABLE_FIELDS';
    end if;
    if old.decision_status <> 'requested' then
      raise exception 'AGNI_PROPOSAL_ALREADY_DECIDED';
    end if;
    if new.decision_status = 'requested' then
      raise exception 'AGNI_PROPOSAL_DECISION_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agni_action_proposals_guard on public.agni_action_proposals;
create trigger trg_agni_action_proposals_guard
before update or delete on public.agni_action_proposals
for each row execute function public.qf_agni_proposal_guard();

alter table public.agni_action_proposals enable row level security;
revoke all on public.agni_action_proposals from anon, authenticated;
grant select, insert, update on public.agni_action_proposals to service_role;

comment on table public.agni_action_proposals is
  'AGNI action proposals. QuickFurno Core owns approval and capability minting metadata; proposals are immutable after intake.';
