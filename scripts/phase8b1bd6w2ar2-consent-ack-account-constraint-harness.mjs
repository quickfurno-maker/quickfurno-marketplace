import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

/**
 * Phase 8B-1B-D6 WAVE 2A-R2 — consent-ack provider-account CHECK harness.
 *
 * INVARIANT:
 *
 *   Every communication_consent_ack_intents row must carry a non-NULL provider_account_id,
 *   enforced by the database boundary.
 *
 * DEFAULT EXECUTION is offline and read-only. Behavioural PostgreSQL probes are mandatory for
 * merge approval but opt-in here: they run only against a disposable LOOPBACK database named by
 * QF_D6W2AR2_TEST_DATABASE_URL. A skipped database proof is printed as SKIPPED, never PASS.
 */
const MIGRATION =
  "supabase/migrations/20260721000100_communication_consent_ack_intent_provider_account_required.sql";
const R1_HARNESS =
  "scripts/phase8b1bd6w2ar1-consent-ack-null-parent-account-guard-harness.mjs";
const D3B_HARNESS = "scripts/phase5f-d3b-outbound-consent-enforcement-harness.mjs";
const RESPONSE_SERVICE = "services/consentCommandResponseService.ts";
const WORKER_SERVICE = "services/consentAckWorkerService.ts";
const D4C_MIGRATION =
  "supabase/migrations/20260713000100_communication_consent_ack_intents.sql";
const BINDING_MIGRATION =
  "supabase/migrations/20260716000100_communication_provider_account_binding.sql";
const WAVE1_MIGRATION =
  "supabase/migrations/20260720000100_communication_delivery_event_provider_account_required.sql";

const TARGET_TABLE = "communication_consent_ack_intents";
const CONSTRAINT_NAME =
  "communication_consent_ack_intents_provider_account_req_check";
const COLUMN = "provider_account_id";
const EXPECTED_BASE = "86255583798fc25c58468fdf6ba657243e37d5be";

const FORBIDDEN_TABLES = Object.freeze([
  "communication_messages",
  "communication_delivery_events",
  "communication_inbound_messages",
  "communication_webhook_receipts",
  "communication_provider_accounts",
]);

function stripSqlNonCode(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const j = sql.indexOf("\n", i);
      i = j < 0 ? sql.length : j;
    } else if (sql.startsWith("/*", i)) {
      const j = sql.indexOf("*/", i);
      i = j < 0 ? sql.length : j + 2;
    } else if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      out += "''";
      i = j + 1;
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
}

function stripSourceNonCode(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("//", i)) {
      const j = src.indexOf("\n", i);
      i = j < 0 ? src.length : j;
    } else if (src.startsWith("/*", i)) {
      const j = src.indexOf("*/", i);
      i = j < 0 ? src.length : j + 2;
    } else if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
      const quote = src[i];
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === quote) break;
        j += 1;
      }
      out += quote + quote;
      i = j + 1;
    } else {
      out += src[i];
      i += 1;
    }
  }
  return out;
}

const normalize = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
const statements = (sql) =>
  stripSqlNonCode(sql)
    .split(";")
    .map((s) => normalize(s))
    .filter(Boolean);

function staticChecks(sql) {
  const results = [];
  const add = (name, ok, detail = "") =>
    results.push({ name, ok: ok === true, detail });
  const stmts = statements(sql);
  const code = normalize(stripSqlNonCode(sql));
  const only = stmts[0] ?? "";

  add("S1 exactly one executable SQL statement", stmts.length === 1);
  add(
    "S2 statement alters only the consent-ack intent table",
    only.startsWith(`alter table public.${TARGET_TABLE} `)
  );
  add(
    "S3 no other communication table appears in executable SQL",
    FORBIDDEN_TABLES.every((t) => !code.includes(t))
  );

  const match = only.match(/check\s*\(\s*(.+?)\s*\)\s*$/);
  const predicate = match?.[1]?.trim() ?? null;
  add("S4 a CHECK predicate exists", predicate !== null);
  add(
    "S5 predicate is exactly provider_account_id IS NOT NULL",
    predicate === `${COLUMN} is not null`,
    `predicate=${predicate}`
  );
  add(
    "S6 exact stable constraint name",
    only.includes(`add constraint ${CONSTRAINT_NAME} `)
  );

  add("S7 no OR widening", predicate !== null && !predicate.includes(" or "));
  add("S8 no tautology", predicate !== null && !/\btrue\b|1\s*=\s*1/.test(predicate));
  add("S9 no created_at/timestamp exemption", !/created_at|timestamptz|current_timestamp|now\(\)/.test(code));
  add("S10 no status, command or acknowledgement-type exemption",
    !/\bstatus\b|\bcommand\b|ack_type|authoritative_disposition/.test(code));

  add("S11 no DML/backfill",
    !/\binsert\b|\bupdate\b|\bdelete\b|\bmerge\b|\btruncate\b|\bcopy\b/.test(code));
  add("S12 no default or column nullability rewrite",
    !/set\s+default|drop\s+default|alter\s+column|set\s+not\s+null|drop\s+not\s+null/.test(code));
  add("S13 no trigger/function/procedure/DO block",
    !/create\s+(or\s+replace\s+)?(trigger|function|procedure)|\bdo\s*\$\$/.test(code));
  add("S14 no index or uniqueness change",
    !/create\s+(unique\s+)?index|drop\s+index|\bunique\s*\(/.test(code));
  add("S15 no RLS or privilege change",
    !/\bgrant\b|\brevoke\b|row level security|create policy|drop policy/.test(code));

  add("S16 no IF NOT EXISTS silent skip", !/if\s+not\s+exists/.test(code));
  add("S17 no IF EXISTS silent skip", !/if\s+exists/.test(code));
  add("S18 constraint is immediately VALIDATED", !/not\s+valid/.test(code));
  add("S19 no exception swallowing", !/\bexception\b|\bwhen\s+others\b/.test(code));
  add("S20 no provider-readiness logic",
    !/readiness_status|configuration_status|webhook_status|health_status|provider_ready|disabled/.test(code));
  add("S21 no UUID literal/default-account substitution",
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(code));

  return results;
}

function lineageChecks() {
  const results = [];
  const add = (name, ok, detail = "") =>
    results.push({ name, ok: ok === true, detail });

  const response = readFileSync(resolve(RESPONSE_SERVICE), "utf8");
  const responseCode = stripSourceNonCode(response);
  const worker = readFileSync(resolve(WORKER_SERVICE), "utf8");
  const workerCode = stripSourceNonCode(worker);
  const d4c = readFileSync(resolve(D4C_MIGRATION), "utf8");
  const d4cCode = normalize(stripSqlNonCode(d4c));
  const binding = readFileSync(resolve(BINDING_MIGRATION), "utf8");
  const bindingCode = normalize(stripSqlNonCode(binding));

  add("L1 insert-row type keeps provider_account_id non-nullable",
    responseCode.includes("readonly provider_account_id: string;"));
  add("L2 enqueueOne account parameter stays non-nullable",
    responseCode.includes("providerAccountId: string,"));
  add("L3 INSERT binds the exact inherited account",
    responseCode.includes("provider_account_id: providerAccountId,"));
  add("L4 unbound parent still fails closed",
    response.includes('return { kind: "missing" };') &&
      response.includes("provider_account_context_missing"));
  add("L5 response service has no generic UPDATE path",
    !/\.update\s*\(/.test(responseCode));
  add("L6 response service has no null/default/fallback account substitution",
    !/providerAccountId\s*(?:\?\?|\|\|)/.test(responseCode) &&
      !/(DEFAULT|FALLBACK)_[A-Z_]*ACCOUNT/.test(responseCode));

  add("L7 worker does not read or write provider_account_id",
    !/\bprovider_account_id\b/.test(workerCode));
  add("L8 worker has no generic table UPDATE path",
    !/\.update\s*\(/.test(workerCode));

  for (const fn of [
    "qf_claim_consent_ack_intents",
    "qf_reserve_consent_ack_provider_attempt",
    "qf_terminalize_consent_ack_intent",
    "qf_expire_consent_ack_intents",
    "qf_recover_stale_dispatching_consent_ack_intents",
  ]) {
    add(`L9 lifecycle RPC remains present: ${fn}`, d4cCode.includes(fn));
  }
  add("L10 original D4-C lifecycle SQL never assigns provider_account_id",
    !/\bprovider_account_id\b/.test(d4cCode));

  add("L11 binding migration added the nullable provider-account FK",
    bindingCode.includes(
      "alter table public.communication_consent_ack_intents add column provider_account_id uuid references public.communication_provider_accounts(id) on delete restrict"
    ));
  add("L12 binding migration retained a provider-account lookup index",
    bindingCode.includes(
      "create index idx_comm_ack_intent_provider_account on public.communication_consent_ack_intents(provider_account_id) where provider_account_id is not null"
    ));
  add("L13 original business idempotency authority remains exact",
    d4cCode.includes(
      "constraint uq_consent_ack_intent_idempotency unique (idempotency_key)"
    ));
  add("L14 provider binding did not account-scope or replace that idempotency authority",
    !bindingCode.includes("uq_consent_ack_intent_idempotency"));

  return results;
}

function scopeChecks() {
  const results = [];
  const add = (name, ok, detail = "") =>
    results.push({ name, ok: ok === true, detail });

  add("G1 R2 migration exists at the approved path", existsSync(resolve(MIGRATION)));
  add("G2 Wave 1 predecessor migration remains present", existsSync(resolve(WAVE1_MIGRATION)));
  add("G3 R1 predecessor harness remains present", existsSync(resolve(R1_HARNESS)));

  const listed = readdirSync(resolve("supabase/migrations")).filter((f) => f.endsWith(".sql"));
  const r2 = listed.filter((f) =>
    /consent_ack_intent.*provider_account|provider_account.*consent_ack_intent/i.test(f));
  add("G4 exactly one consent-ack provider-account constraint migration exists",
    r2.length === 1 && `supabase/migrations/${r2[0]}` === MIGRATION, r2.join(", "));

  const laterWave = listed.filter((f) =>
    /(inbound_message|webhook_receipt).*(provider_account|required|constraint)|(?:provider_account|required|constraint).*(inbound_message|webhook_receipt)/i.test(f));
  add("G5 no Wave 2B or Wave 3 constraint migration exists yet",
    laterWave.length === 0, laterWave.join(", "));

  let changed = [];
  try {
    changed = execFileSync(
      "git",
      ["diff", "--name-only", `${EXPECTED_BASE}..HEAD`],
      { encoding: "utf8" }
    ).split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    add("G6 fixed-base diff is available", false);
    return results;
  }

  const allowed = new Set([MIGRATION, R1_HARNESS,
    "scripts/phase8b1bd6w2ar2-consent-ack-account-constraint-harness.mjs",
    D3B_HARNESS]);
  add("G6 every changed file belongs to the reviewed R2 implementation/governance set",
    changed.every((f) => allowed.has(f)), changed.join(", "));
  for (const required of [MIGRATION, R1_HARNESS,
    "scripts/phase8b1bd6w2ar2-consent-ack-account-constraint-harness.mjs"]) {
    add(`G7 required R2 implementation file is in the fixed-base range: ${required}`,
      changed.includes(required));
  }
  add("G8 no app/lib/service/package/environment runtime change",
    !changed.some((f) =>
      f.startsWith("app/") || f.startsWith("lib/") || f.startsWith("services/") ||
      /^package(-lock)?\.json$/.test(f) || /\.env/.test(f)));

  let mergeBase = "";
  try {
    mergeBase = execFileSync("git", ["merge-base", "HEAD", EXPECTED_BASE], {
      encoding: "utf8",
    }).trim();
  } catch { /* reported below */ }
  add("G9 branch is forward-only from the deployed R1 authority",
    mergeBase === EXPECTED_BASE, `merge-base=${mergeBase}`);

  const r1 = readFileSync(resolve(R1_HARNESS), "utf8");
  add("G10 R1 scope proof was re-derived, not bypassed",
    r1.includes(`const r2 = "${MIGRATION}";`) &&
      r1.includes("exactly one approved Wave 2A-R2") &&
      !r1.includes("NO Wave 2A-R2 ack-intent constraint migration exists yet"));
  add("G11 no stray Supabase CLI state", !existsSync(resolve("supabase/.temp")));

  return results;
}

const DB_VAR = "QF_D6W2AR2_TEST_DATABASE_URL";
const LEGACY_VARS = ["D6W2AR2_TEST_DATABASE_URL"];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const FORBIDDEN_DB_NAME = /quickfurno|prod|production|live/i;

function resolveTarget() {
  for (const name of LEGACY_VARS) {
    if (process.env[name]) {
      throw new Error(
        `${name} is retired. Use only ${DB_VAR}; supporting two names could let a stale DSN choose the DDL target.`
      );
    }
  }
  for (const other of ["QF_D6W1_TEST_DATABASE_URL", "QF_WORKFLOW_TEST_DATABASE_URL"]) {
    if (process.env[other] && !process.env[DB_VAR]) {
      throw new Error(
        `${other} is set but ${DB_VAR} is not. R2 never reuses another phase's database.`
      );
    }
  }

  const raw = process.env[DB_VAR] ?? null;
  if (raw === null) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${DB_VAR} is not a valid URL.`);
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new Error(`${DB_VAR} must be a postgres:// URL.`);
  }

  const host = url.hostname.toLowerCase();
  const dbName = url.pathname.replace(/^\//, "");
  if (/supabase\.co|supabase\.in|pooler\.supabase/.test(host)) {
    throw new Error("REFUSING: R2 probes may never target managed Supabase.");
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`REFUSING: "${host}" is not loopback.`);
  }
  if (!dbName || FORBIDDEN_DB_NAME.test(dbName) || FORBIDDEN_DB_NAME.test(host)) {
    throw new Error(`REFUSING: database "${dbName}" is empty or resembles production.`);
  }

  return {
    raw,
    host,
    port: url.port || "5432",
    dbName,
    user: url.username,
  };
}

function psql(target, sql, { file = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "qf-d6w2ar2-"));
  const path = join(dir, "query.sql");
  writeFileSync(path, file ? readFileSync(file, "utf8") : sql, "utf8");

  const args = [
    "-X", "-q", "-t", "-A",
    "-h", target.host,
    "-p", target.port,
    "-d", target.dbName,
    "-v", "ON_ERROR_STOP=1",
    "-v", "VERBOSITY=verbose",
    "--no-psqlrc",
    "-f", path,
  ];
  if (target.user) args.splice(10, 0, "-U", target.user);

  const run = spawnSync("psql", args, { encoding: "utf8", shell: true });
  rmSync(dirname(path), { recursive: true, force: true });

  const combined = `${run.stderr || ""}${run.stdout || ""}`;
  const sqlstate = (combined.match(/ERROR:\s+([0-9A-Z]{5}):/) || [])[1] ?? null;
  const constraint =
    (combined.match(/CONSTRAINT NAME:\s*(\S+)/i) ||
      combined.match(/violates \w+ constraint "([^"]+)"/i) ||
      combined.match(/constraint "([^"]+)" .*already exists/i) ||
      [])[1] ?? null;

  return {
    status: run.status,
    stdout: run.stdout || "",
    stderr: run.stderr || "",
    sqlstate,
    constraint,
  };
}

const PRE_R2_SCHEMA = `
drop schema if exists public cascade;
create schema public;

create table public.communication_provider_accounts (
  id uuid primary key
);

create table public.communication_consent_command_receipts (
  id uuid primary key
);

create table public.communication_inbound_messages (
  id uuid primary key
);

create table public.communication_consent_ack_intents (
  id uuid primary key,
  idempotency_key text not null,
  consent_command_receipt_id uuid
    references public.communication_consent_command_receipts(id) on delete restrict,
  inbound_message_id uuid not null
    references public.communication_inbound_messages(id) on delete restrict,
  provider_account_id uuid
    references public.communication_provider_accounts(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending','claimed','dispatching','sent','suppressed','expired','failed','uncertain')),
  sealed_destination_ciphertext text,
  sealed_destination_nonce text,
  sealed_destination_auth_tag text,
  encryption_key_id text,
  received_at timestamptz not null,
  expires_at timestamptz not null,
  locked_by text,
  locked_at timestamptz,
  claim_count integer not null default 0,
  provider_attempt_count integer not null default 0 check (provider_attempt_count in (0,1)),
  terminal_code text,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint uq_consent_ack_intent_idempotency unique (idempotency_key)
);

create function public.qf_claim_consent_ack_intents(
  p_worker_id text, p_limit integer default 25, p_stale_lease interval default interval '2 minutes'
)
returns setof public.communication_consent_ack_intents
language plpgsql as $$
begin
  return query
  update public.communication_consent_ack_intents t
     set status='claimed', locked_by=trim(p_worker_id), locked_at=now(),
         claim_count=t.claim_count+1, updated_at=now()
   where t.id in (
     select c.id from public.communication_consent_ack_intents c
      where c.expires_at > now()
        and c.provider_attempt_count = 0
        and (c.status='pending'
          or (c.status='claimed' and c.locked_at < now()-p_stale_lease))
      order by c.received_at
      limit least(greatest(coalesce(p_limit,25),1),25)
      for update skip locked
   )
  returning t.*;
end $$;

create function public.qf_reserve_consent_ack_provider_attempt(
  p_intent_id text, p_worker_id text
)
returns boolean language plpgsql as $$
declare n integer;
begin
  update public.communication_consent_ack_intents
     set status='dispatching', provider_attempt_count=1, updated_at=now()
   where id=p_intent_id::uuid and status='claimed'
     and locked_by=trim(p_worker_id) and provider_attempt_count=0 and expires_at>now();
  get diagnostics n=row_count;
  return n=1;
end $$;

create function public.qf_terminalize_consent_ack_intent(
  p_intent_id text, p_status text, p_terminal_code text default null
)
returns boolean language plpgsql as $$
declare n integer;
begin
  update public.communication_consent_ack_intents
     set status=p_status, terminal_code=coalesce(p_terminal_code,p_status),
         sealed_destination_ciphertext=null, sealed_destination_nonce=null,
         sealed_destination_auth_tag=null, encryption_key_id=null,
         locked_by=null, locked_at=null, completed_at=now(), updated_at=now()
   where id=p_intent_id::uuid and status in ('pending','claimed','dispatching');
  get diagnostics n=row_count;
  return n=1;
end $$;

create function public.qf_expire_consent_ack_intents(p_limit integer default 100)
returns integer language plpgsql as $$
declare n integer;
begin
  with due as (
    select id from public.communication_consent_ack_intents
     where status in ('pending','claimed') and expires_at<=now()
     order by expires_at
     limit least(greatest(coalesce(p_limit,100),1),500)
     for update skip locked
  )
  update public.communication_consent_ack_intents t
     set status='expired', terminal_code='expired',
         sealed_destination_ciphertext=null, sealed_destination_nonce=null,
         sealed_destination_auth_tag=null, encryption_key_id=null,
         locked_by=null, locked_at=null, completed_at=now(), updated_at=now()
    from due where t.id=due.id;
  get diagnostics n=row_count;
  return n;
end $$;

create function public.qf_recover_stale_dispatching_consent_ack_intents(
  p_stale_after interval default interval '180 seconds', p_limit integer default 100
)
returns integer language plpgsql as $$
declare n integer;
begin
  with stuck as (
    select id from public.communication_consent_ack_intents
     where status='dispatching' and provider_attempt_count=1
       and locked_at < now()-p_stale_after
     order by locked_at
     limit least(greatest(coalesce(p_limit,100),1),500)
     for update skip locked
  )
  update public.communication_consent_ack_intents t
     set status='uncertain', terminal_code='worker_crashed_after_attempt_reserved',
         sealed_destination_ciphertext=null, sealed_destination_nonce=null,
         sealed_destination_auth_tag=null, encryption_key_id=null,
         locked_by=null, locked_at=null, completed_at=now(), updated_at=now()
    from stuck where t.id=stuck.id;
  get diagnostics n=row_count;
  return n;
end $$;
`;

const ACC = "11111111-1111-4111-8111-111111111111";
const RECEIPT = "22222222-2222-4222-8222-222222222222";
const INBOUND = "33333333-3333-4333-8333-333333333333";

const IDS = Object.freeze({
  bound: "40000000-0000-4000-8000-000000000001",
  claim: "40000000-0000-4000-8000-000000000002",
  reserve: "40000000-0000-4000-8000-000000000003",
  terminal: "40000000-0000-4000-8000-000000000004",
  expire: "40000000-0000-4000-8000-000000000005",
  recover: "40000000-0000-4000-8000-000000000006",
  nullable: "40000000-0000-4000-8000-000000000007",
});

function insertIntent({
  id,
  key,
  account = `'${ACC}'`,
  inbound = `'${INBOUND}'`,
  status = "pending",
  expires = "now() + interval '1 hour'",
  lockedBy = "null",
  lockedAt = "null",
  attempt = 0,
}) {
  return `
insert into public.communication_consent_ack_intents (
  id,idempotency_key,consent_command_receipt_id,inbound_message_id,provider_account_id,
  status,sealed_destination_ciphertext,sealed_destination_nonce,sealed_destination_auth_tag,
  encryption_key_id,received_at,expires_at,locked_by,locked_at,provider_attempt_count
) values (
  '${id}','${key}','${RECEIPT}',${inbound},${account},
  '${status}','cipher','nonce','tag','key-v1',now(),${expires},${lockedBy},${lockedAt},${attempt}
);`;
}

function databaseChecks() {
  const results = [];
  const add = (name, ok, skipped = false, detail = "") =>
    results.push({ name, ok: ok === true, skipped, detail });

  const target = resolveTarget();
  const names = [
    "A migration applies and is VALIDATED",
    "B bound INSERT is accepted",
    "C NULL provider_account_id is rejected by the R2 CHECK",
    "D invalid inbound parent is rejected by FK",
    "E invalid provider account is rejected by FK",
    "F existing idempotency uniqueness remains enforced",
    "G all five lifecycle RPCs preserve the bound account",
    "H reapplying bare DDL fails closed",
    "I dropping only R2 restores nullable behaviour with FKs/unique intact",
  ];
  if (target === null) {
    for (const name of names) {
      add(`${name} [SKIPPED — ${DB_VAR} not set]`, false, true);
    }
    return results;
  }

  const version = spawnSync("psql", ["--version"], { encoding: "utf8", shell: true });
  if (version.status !== 0) {
    throw new Error("psql is unavailable; mandatory R2 database proofs cannot run.");
  }

  const ident = psql(
    target,
    "select current_database()||'|'||coalesce(host(inet_server_addr()),'local')||'|'||inet_server_port();"
  );
  if (ident.status !== 0) {
    throw new Error(`cannot reach disposable R2 database: ${ident.stderr.slice(0, 200)}`);
  }
  const [db, host] = ident.stdout.trim().split("\n").pop().split("|");
  if (FORBIDDEN_DB_NAME.test(db) || !LOOPBACK_HOSTS.has(host)) {
    throw new Error(`REFUSING server identity db=${db} host=${host}`);
  }
  add(`D0 server identity is loopback and non-production: db=${db} host=${host}`, true);

  let r = psql(target, PRE_R2_SCHEMA);
  if (r.status !== 0) {
    throw new Error(`pre-R2 schema setup failed: ${r.stderr.slice(0, 400)}`);
  }
  r = psql(target, `
insert into public.communication_provider_accounts(id) values ('${ACC}');
insert into public.communication_consent_command_receipts(id) values ('${RECEIPT}');
insert into public.communication_inbound_messages(id) values ('${INBOUND}');
`);
  if (r.status !== 0) throw new Error(`fixture seed failed: ${r.stderr.slice(0, 300)}`);

  const a = psql(target, null, { file: resolve(MIGRATION) });
  const validated = psql(target,
    `select count(*) from pg_constraint
      where conrelid='public.${TARGET_TABLE}'::regclass
        and conname='${CONSTRAINT_NAME}' and convalidated;`);
  add(`A migration applies and ${CONSTRAINT_NAME} is VALIDATED`,
    a.status === 0 && validated.stdout.trim().split("\n").pop() === "1",
    false, a.stderr.slice(0, 160));

  const b = psql(target, insertIntent({
    id: IDS.bound, key: "ack:r2:bound", status: "sent",
  }));
  add(`B bound INSERT is accepted [exit ${b.status}]`, b.status === 0, false, b.stderr.slice(0, 160));

  const c = psql(target, insertIntent({
    id: IDS.nullable, key: "ack:r2:null", account: "null",
  }));
  add(`C NULL account rejected by ${CONSTRAINT_NAME} [SQLSTATE ${c.sqlstate}]`,
    c.status !== 0 && c.sqlstate === "23514" && c.constraint === CONSTRAINT_NAME,
    false, `constraint=${c.constraint}`);

  const d = psql(target, insertIntent({
    id: "40000000-0000-4000-8000-000000000008",
    key: "ack:r2:bad-parent",
    inbound: "'99999999-9999-4999-8999-999999999999'",
  }));
  add(`D invalid inbound parent rejected by FK [SQLSTATE ${d.sqlstate}]`,
    d.status !== 0 && d.sqlstate === "23503", false, `constraint=${d.constraint}`);

  const e = psql(target, insertIntent({
    id: "40000000-0000-4000-8000-000000000009",
    key: "ack:r2:bad-account",
    account: "'88888888-8888-4888-8888-888888888888'",
  }));
  add(`E invalid provider account rejected by FK [SQLSTATE ${e.sqlstate}]`,
    e.status !== 0 && e.sqlstate === "23503", false, `constraint=${e.constraint}`);

  const f = psql(target, insertIntent({
    id: "40000000-0000-4000-8000-000000000010",
    key: "ack:r2:bound",
    status: "sent",
  }));
  add(`F idempotency uniqueness remains enforced [SQLSTATE ${f.sqlstate}]`,
    f.status !== 0 && f.sqlstate === "23505", false, `constraint=${f.constraint}`);

  const lifecycleSeed = psql(target, [
    insertIntent({ id: IDS.claim, key: "ack:r2:claim" }),
    insertIntent({
      id: IDS.reserve, key: "ack:r2:reserve", status: "claimed",
      lockedBy: "'worker-r2'", lockedAt: "now()",
    }),
    insertIntent({ id: IDS.terminal, key: "ack:r2:terminal" }),
    insertIntent({
      id: IDS.expire, key: "ack:r2:expire",
      expires: "now() - interval '1 minute'",
    }),
    insertIntent({
      id: IDS.recover, key: "ack:r2:recover", status: "dispatching",
      lockedBy: "'worker-r2'", lockedAt: "now() - interval '10 minutes'", attempt: 1,
    }),
  ].join("\n"));
  if (lifecycleSeed.status !== 0) {
    throw new Error(`lifecycle fixture seed failed: ${lifecycleSeed.stderr.slice(0, 300)}`);
  }

  const g = psql(target, `
select count(*) from public.qf_claim_consent_ack_intents('worker-r2',25,interval '2 minutes');
select public.qf_reserve_consent_ack_provider_attempt('${IDS.reserve}','worker-r2');
select public.qf_terminalize_consent_ack_intent('${IDS.terminal}','suppressed','r2-test');
select public.qf_expire_consent_ack_intents(100);
select public.qf_recover_stale_dispatching_consent_ack_intents(interval '180 seconds',100);
select count(*) from public.communication_consent_ack_intents
 where id in ('${IDS.claim}','${IDS.reserve}','${IDS.terminal}','${IDS.expire}','${IDS.recover}')
   and provider_account_id is distinct from '${ACC}'::uuid;
`);
  const gLast = g.stdout.trim().split("\n").pop();
  add("G all five lifecycle RPCs preserve provider_account_id exactly",
    g.status === 0 && gLast === "0", false, g.stderr.slice(0, 200));

  const h = psql(target, null, { file: resolve(MIGRATION) });
  add(`H bare-DDL reapply fails closed [SQLSTATE ${h.sqlstate}]`,
    h.status !== 0 && h.sqlstate === "42710", false, `object=${h.constraint}`);

  const i1 = psql(target,
    `alter table public.${TARGET_TABLE} drop constraint ${CONSTRAINT_NAME};`);
  const i2 = psql(target, insertIntent({
    id: IDS.nullable, key: "ack:r2:null-after-rollback", account: "null",
  }));
  const i3 = psql(target, `
select
  (select count(*) from pg_constraint
    where conrelid='public.${TARGET_TABLE}'::regclass and contype='f') || '|' ||
  (select count(*) from pg_constraint
    where conrelid='public.${TARGET_TABLE}'::regclass
      and conname='uq_consent_ack_intent_idempotency');
`);
  const shape = i3.stdout.trim().split("\n").pop();
  add(`I rollback restores nullable behaviour; three FKs and idempotency unique remain [${shape}]`,
    i1.status === 0 && i2.status === 0 && shape === "3|1",
    false, `${i1.stderr}${i2.stderr}`.slice(0, 200));

  const cleanup = psql(target, "drop schema public cascade; create schema public;");
  const left = psql(target,
    "select count(*) from information_schema.tables where table_schema='public';");
  add("D9 disposable schema cleaned completely",
    cleanup.status === 0 && left.stdout.trim().split("\n").pop() === "0");

  return results;
}

const DDL_ANCHOR =
  "alter table public.communication_consent_ack_intents\n" +
  "  add constraint communication_consent_ack_intents_provider_account_req_check\n" +
  "  check (provider_account_id is not null);";

const MUTATIONS = [
  { name: "M1 remove the constraint", expect: "killed",
    mutate: (s) => s.replace(DDL_ANCHOR, "") },
  { name: "M2 invert IS NOT NULL to IS NULL", expect: "killed",
    mutate: (s) => s.replace("check (provider_account_id is not null)",
      "check (provider_account_id is null)") },
  { name: "M3 target the wrong table", expect: "killed",
    mutate: (s) => s.replace(DDL_ANCHOR, DDL_ANCHOR.replace(
      "alter table public.communication_consent_ack_intents",
      "alter table public.communication_inbound_messages")) },
  { name: "M4 add a status exemption", expect: "killed",
    mutate: (s) => s.replace("check (provider_account_id is not null)",
      "check (provider_account_id is not null or status = 'expired')") },
  { name: "M5 add a created_at legacy exemption", expect: "killed",
    mutate: (s) => s.replace("check (provider_account_id is not null)",
      "check (created_at < timestamptz '2026-07-21 00:00:00+00' or provider_account_id is not null)") },
  { name: "M6 widen with OR TRUE", expect: "killed",
    mutate: (s) => s.replace("check (provider_account_id is not null)",
      "check (provider_account_id is not null or true)") },
  { name: "M7 silently skip with IF NOT EXISTS", expect: "killed",
    mutate: (s) => s.replace(`add constraint ${CONSTRAINT_NAME}`,
      `add constraint if not exists ${CONSTRAINT_NAME}`) },
  { name: "M8 stage as NOT VALID", expect: "killed",
    mutate: (s) => s.replace("check (provider_account_id is not null);",
      "check (provider_account_id is not null) not valid;") },
  { name: "M9 replace the CHECK with column NOT NULL", expect: "killed",
    mutate: (s) => s.replace(DDL_ANCHOR,
      "alter table public.communication_consent_ack_intents alter column provider_account_id set not null;") },
  { name: "M10 add a backfill", expect: "killed",
    mutate: (s) => s.replace(DDL_ANCHOR,
      "update public.communication_consent_ack_intents set provider_account_id = '11111111-1111-4111-8111-111111111111' where provider_account_id is null;\n" + DDL_ANCHOR) },
  { name: "M11 add a default account", expect: "killed",
    mutate: (s) => s.replace(DDL_ANCHOR,
      "alter table public.communication_consent_ack_intents alter column provider_account_id set default '11111111-1111-4111-8111-111111111111';\n" + DDL_ANCHOR) },
  { name: "M12 rename the constraint", expect: "killed",
    mutate: (s) => s.replace(DDL_ANCHOR, DDL_ANCHOR.replace(
      CONSTRAINT_NAME, "ack_account_required_chk")) },
  { name: "M13 account-scope the idempotency authority", expect: "killed",
    mutate: (s) => s.replace(DDL_ANCHOR,
      DDL_ANCHOR + "\ncreate unique index uq_ack_account_key on public.communication_consent_ack_intents(provider_account_id,idempotency_key);") },
  { name: "M14 add a trigger/function bypass", expect: "killed",
    mutate: (s) => s.replace(DDL_ANCHOR,
      DDL_ANCHOR + "\ncreate function public.r2_default() returns trigger language plpgsql as $$ begin return new; end $$;") },
  { name: "S1 comment-only edit must SURVIVE", expect: "survived",
    mutate: (s) => s.replace("-- ROLLBACK", "-- ROLLBACK NOTE") },
];

const raw = readFileSync(resolve(MIGRATION), "utf8");
console.log("Phase 8B-1B-D6 Wave 2A-R2 — consent-ack provider-account CHECK harness\n");
console.log(`Migration under test: ${MIGRATION}\n`);

let passed = 0;
let failed = 0;
let skipped = 0;

for (const result of [
  ...staticChecks(raw),
  ...lineageChecks(),
  ...scopeChecks(),
  ...databaseChecks(),
]) {
  if (result.skipped) {
    console.log(`SKIP  ${result.name}`);
    skipped += 1;
  } else if (result.ok) {
    console.log(`PASS  ${result.name}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${result.name}${result.detail ? ` [${result.detail}]` : ""}`);
    failed += 1;
  }
}

console.log("\n--- mutation tests ---\n");
let killed = 0;
let survived = 0;
let infra = 0;

for (const mutation of MUTATIONS) {
  let status;
  try {
    const changed = mutation.mutate(raw);
    if (changed === raw) {
      status = "infra_fail";
    } else {
      status = staticChecks(changed).some((r) => !r.ok) ? "killed" : "survived";
    }
  } catch {
    status = "infra_fail";
  }

  const expected = status === mutation.expect;
  if (status === "killed") {
    console.log(`${expected ? "KILLED  " : "KILLED* "}${mutation.name}`);
    killed += 1;
  } else if (status === "survived") {
    console.log(`${expected ? "SURVIVED" : "SURVIVED*"} ${mutation.name}`);
    survived += 1;
  } else {
    console.log(`INFRA   ${mutation.name}`);
    infra += 1;
  }
  if (!expected) failed += 1;
}

const expectedKills = MUTATIONS.filter((m) => m.expect === "killed").length;
console.log(`\nchecks: ${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log(
  `mutations: ${killed} killed, ${survived} survived, ${infra} infra_fail ` +
  `(expected kills: ${expectedKills})`
);
if (skipped > 0) {
  console.log(`\nNOTE: PostgreSQL proofs are absent until ${DB_VAR} is supplied.`);
  console.log("      Merge approval requires every A-I database proof to run and pass.");
}
console.log(failed === 0 ? "\nHARNESS GREEN" : "\nHARNESS RED");
process.exit(failed > 0 ? 1 : 0);
