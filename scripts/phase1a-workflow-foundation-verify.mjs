import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  "supabase/migrations/20260706000146_create_qf_workflow_kernel_foundation.sql",
);
const persistenceTypesPath = resolve("lib/aos/workflow/workflowPersistenceTypes.ts");

const sql = readFileSync(migrationPath, "utf8");
const persistenceTypes = existsSync(persistenceTypesPath)
  ? readFileSync(persistenceTypesPath, "utf8")
  : "";
const normalized = sql.toLowerCase().replace(/\s+/g, " ");
const normalizedTypes = persistenceTypes.toLowerCase().replace(/\s+/g, " ");

const checks = [];

function addCheck(name, predicate) {
  checks.push({ name, ok: Boolean(predicate()) });
}

function has(pattern) {
  return pattern.test(sql);
}

function hasNormalized(fragment) {
  return normalized.includes(fragment.toLowerCase().replace(/\s+/g, " "));
}

function tableBlock(tableName) {
  const start = normalized.indexOf(`create table if not exists public.${tableName}`);
  if (start < 0) return "";
  const next = normalized.indexOf("create table if not exists public.", start + 1);
  return normalized.slice(start, next < 0 ? normalized.length : next);
}

function statementStartingWith(fragment) {
  const start = normalized.indexOf(fragment.toLowerCase().replace(/\s+/g, " "));
  if (start < 0) return "";
  const end = normalized.indexOf(";", start);
  return normalized.slice(start, end < 0 ? normalized.length : end + 1);
}

const requiredTables = [
  "workflow_instances",
  "workflow_tasks",
  "domain_events",
  "outbox_events",
  "workflow_failures",
  "idempotency_records",
  "workflow_transition_history",
];

for (const table of requiredTables) {
  addCheck(`creates ${table}`, () => hasNormalized(`create table if not exists public.${table}`));
  addCheck(`enables RLS on ${table}`, () => hasNormalized(`alter table public.${table} enable row level security`));
  addCheck(`revokes anon on ${table}`, () => hasNormalized(`revoke all on public.${table} from anon`));
  addCheck(`revokes authenticated on ${table}`, () => hasNormalized(`revoke all on public.${table} from authenticated`));
  addCheck(`grants service_role on ${table}`, () => hasNormalized(`grant select, insert, update, delete on public.${table} to service_role`));
}

addCheck("workflow duplicate protection is partial unique for active/paused only", () =>
  statementStartingWith("create unique index if not exists uq_workflow_instances_active_entity")
    .includes("on public.workflow_instances(workflow_type, entity_type, entity_id)") &&
  statementStartingWith("create unique index if not exists uq_workflow_instances_active_entity")
    .includes("where status in ('active', 'paused')") &&
  !statementStartingWith("create unique index if not exists uq_workflow_instances_active_entity")
    .includes("completed"),
);

addCheck("workflow_tasks idempotency key is unique only when non-null", () =>
  hasNormalized("create unique index if not exists uq_workflow_tasks_idempotency_key") &&
  hasNormalized("on public.workflow_tasks(idempotency_key)") &&
  hasNormalized("where idempotency_key is not null"),
);

addCheck("domain_events idempotency key is unique only when non-null", () =>
  hasNormalized("create unique index if not exists uq_domain_events_idempotency_key") &&
  hasNormalized("on public.domain_events(idempotency_key)") &&
  hasNormalized("where idempotency_key is not null"),
);

addCheck("outbox_events idempotency key is required and unique", () =>
  tableBlock("outbox_events").includes("idempotency_key text not null") &&
  hasNormalized("create unique index if not exists uq_outbox_events_idempotency_key on public.outbox_events(idempotency_key)"),
);

addCheck("idempotency_records has unique idempotency_key", () =>
  tableBlock("idempotency_records").includes("idempotency_key text unique not null"),
);

addCheck("idempotency RPC uses separate insert-first conflict-aware strategy", () =>
  hasNormalized("create or replace function public.qf_begin_idempotent_operation") &&
  hasNormalized("on conflict (idempotency_key) do nothing") &&
  hasNormalized("returning * into v_record") &&
  hasNormalized("true;") &&
  hasNormalized("false;") &&
  !hasNormalized("with inserted as") &&
  !hasNormalized("select * from inserted") &&
  !hasNormalized("union all"),
);

addCheck("idempotency RPC returns existing duplicate record after conflict", () =>
  hasNormalized("select existing.* into v_record") &&
  hasNormalized("where existing.idempotency_key = v_key") &&
  hasNormalized("false;"),
);

addCheck("idempotency RPC protects scope mismatch", () =>
  hasNormalized("IDEMPOTENCY_KEY_SCOPE_MISMATCH") &&
  hasNormalized("v_record.operation_type is distinct from v_operation_type") &&
  hasNormalized("v_record.entity_type is distinct from v_entity_type") &&
  hasNormalized("v_record.entity_id is distinct from v_entity_id"),
);

addCheck("workflow transition history does not cascade delete", () =>
  tableBlock("workflow_transition_history").includes("references public.workflow_instances(id) on delete restrict") &&
  !tableBlock("workflow_transition_history").includes("on delete cascade"),
);

addCheck("claim RPCs validate worker id", () =>
  hasNormalized("if p_worker_id is null or length(trim(p_worker_id)) = 0 then") &&
  (sql.match(/WORKER_ID_REQUIRED/g) ?? []).length >= 2,
);

addCheck("claim RPCs validate positive stale-lock interval", () =>
  hasNormalized("if p_stale_lock_after is null or p_stale_lock_after <= interval '0 seconds' then") &&
  (sql.match(/INVALID_STALE_LOCK_INTERVAL/g) ?? []).length >= 2,
);

addCheck("task claim function uses atomic UPDATE with FOR UPDATE SKIP LOCKED", () =>
  hasNormalized("create or replace function public.qf_claim_due_workflow_task") &&
  hasNormalized("update public.workflow_tasks") &&
  hasNormalized("for update skip locked") &&
  hasNormalized("returning * into v_task") &&
  hasNormalized("order by wt.priority desc, wt.due_at asc, wt.created_at asc"),
);

addCheck("outbox claim function uses atomic UPDATE with FOR UPDATE SKIP LOCKED", () =>
  hasNormalized("create or replace function public.qf_claim_due_outbox_event") &&
  hasNormalized("update public.outbox_events") &&
  hasNormalized("for update skip locked") &&
  hasNormalized("returning * into v_event"),
);

const statusChecks = [
  ["workflow_instances", "active", "paused", "completed", "failed", "cancelled"],
  ["workflow_tasks", "pending", "processing", "completed", "retry_scheduled", "failed", "dead_letter", "cancelled"],
  ["domain_events", "pending", "processing", "processed", "failed", "dead_letter"],
  ["outbox_events", "pending", "processing", "sent", "completed", "retry_scheduled", "failed", "dead_letter", "cancelled"],
  ["workflow_failures", "open", "retry_scheduled", "resolved", "dead_letter"],
  ["idempotency_records", "started", "completed", "failed"],
];

for (const [table, ...statuses] of statusChecks) {
  const block = tableBlock(table);
  addCheck(`${table} has status check constraint`, () =>
    statuses.every((status) => block.includes(`'${status}'`)),
  );
}

addCheck("no anon/authenticated grants are created", () =>
  !/\bgrant\b[\s\S]*\bto\s+(anon|authenticated)\b/i.test(sql),
);

addCheck("no public policies are created", () =>
  !/\bcreate\s+policy\b/i.test(sql),
);

addCheck("no SECURITY DEFINER functions are created", () =>
  !/\bsecurity\s+definer\b/i.test(sql),
);

addCheck("service-role RPC execute grants only", () =>
  ["qf_claim_due_workflow_task", "qf_claim_due_outbox_event", "qf_begin_idempotent_operation"].every((fn) =>
    hasNormalized(`grant execute on function public.${fn}`) &&
    has(new RegExp(`revoke all on function public\\.${fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")),
  ),
);

addCheck("no destructive table drops", () =>
  !/\bdrop\s+table\b/i.test(sql),
);

addCheck("no existing lead/matching/credit tables are altered", () =>
  !/\balter\s+table\b(?!\s+public\.(workflow_instances|workflow_tasks|domain_events|outbox_events|workflow_failures|idempotency_records|workflow_transition_history)\b)/i.test(sql),
);

addCheck("workflowPersistenceTypes.ts exists", () =>
  existsSync(persistenceTypesPath),
);

const expectedStatusUnions = [
  "WorkflowStatus",
  "WorkflowTaskStatus",
  "DomainEventStatus",
  "OutboxStatus",
  "WorkflowFailureStatus",
  "IdempotencyStatus",
];

for (const typeName of expectedStatusUnions) {
  addCheck(`persistence type union exists: ${typeName}`, () =>
    normalizedTypes.includes(`export type ${typeName}`.toLowerCase()),
  );
}

const expectedRecordInterfaces = [
  "WorkflowInstanceRecord",
  "WorkflowTaskRecord",
  "DomainEventRecord",
  "OutboxEventRecord",
  "WorkflowFailureRecord",
  "IdempotencyRecord",
  "WorkflowTransitionRecord",
];

for (const interfaceName of expectedRecordInterfaces) {
  addCheck(`persistence record interface exists: ${interfaceName}`, () =>
    normalizedTypes.includes(`export interface ${interfaceName}`.toLowerCase()),
  );
}

const failures = checks.filter((check) => !check.ok);

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} Phase 1A verification check(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} Phase 1A static SQL and source validation checks passed.`);
