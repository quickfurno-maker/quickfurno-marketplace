#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const rawUrl =
  process.env.DATABASE_URL ??
  "postgresql://qf_phase12:qf_phase12_ci_only@127.0.0.1:5432/qf_phase12";
const parsedUrl = new URL(rawUrl);
if (
  !["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname) ||
  !/(phase12|test)/iu.test(parsedUrl.pathname)
) {
  throw new Error(
    "Phase 12 certification refuses non-loopback or non-test database",
  );
}

const schema = `phase12_cert_${process.pid}`;
const pool = new Pool({ connectionString: rawUrl, max: 40 });

function extractFunction(sql, name) {
  const marker = `create or replace function public.${name}(`;
  const start = sql.toLowerCase().indexOf(marker);
  if (start < 0) throw new Error(`missing function ${name}`);
  const tail = sql.slice(start);
  const tagMatch = tail.match(/\bas\s+(\$[A-Za-z0-9_]*\$)/i);
  if (!tagMatch) throw new Error(`missing body tag for ${name}`);
  const tag = tagMatch[1];
  const bodyStart = tagMatch.index + tagMatch[0].length;
  const end = tail.indexOf(tag, bodyStart);
  const semicolon = tail.indexOf(";", end + tag.length);
  if (end < 0 || semicolon < 0)
    throw new Error(`unterminated function ${name}`);
  return tail.slice(0, semicolon + 1);
}

const scoped = (sql) =>
  sql
    .replaceAll("public.", `${schema}.`)
    .replace(
      "set search_path = pg_catalog, public",
      `set search_path = pg_catalog, ${schema}`,
    );

function uuid(prefix, value) {
  return `${prefix}0000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

try {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20261005160000_scale_phase12_horizontal_worker_claims.sql",
      import.meta.url,
    ),
    "utf8",
  );

  await pool.query(`create schema ${schema}`);
  await pool.query(`
    create table ${schema}.communication_conversation_outbox (
      id uuid primary key,
      conversation_id uuid not null,
      status text not null,
      claimed_at timestamptz,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
    create table ${schema}.communication_jarvis_turn_outbox (
      id uuid primary key,
      conversation_id uuid not null,
      status text not null,
      turn_purpose text not null,
      next_retry_at timestamptz,
      claimed_at timestamptz,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
  `);
  await pool.query(
    `create unique index c_outbox_claim_uidx
       on ${schema}.communication_conversation_outbox(conversation_id)
       where status='claimed'`,
  );
  await pool.query(
    `create unique index j_outbox_claim_uidx
       on ${schema}.communication_jarvis_turn_outbox(conversation_id)
       where status='claimed'`,
  );
  await pool.query(
    scoped(extractFunction(migration, "qf_claim_conversation_outbox_v1")),
  );
  await pool.query(
    scoped(extractFunction(migration, "qf_claim_jarvis_turn_outbox_v1")),
  );

  for (
    let conversationIndex = 1;
    conversationIndex <= 20;
    conversationIndex += 1
  ) {
    const conversationId = uuid("1", conversationIndex);
    for (let turnIndex = 1; turnIndex <= 2; turnIndex += 1) {
      const id = uuid("2", conversationIndex * 100 + turnIndex);
      const createdAt = new Date(
        Date.UTC(2026, 9, 5, 10, conversationIndex, turnIndex),
      ).toISOString();
      await pool.query(
        `insert into ${schema}.communication_conversation_outbox
          (id,conversation_id,status,created_at,updated_at)
         values($1,$2,'pending',$3,$3)`,
        [id, conversationId, createdAt],
      );
    }
  }

  const firstWave = await Promise.all(
    Array.from({ length: 32 }, () =>
      pool.query(
        `select id,conversation_id from ${schema}.qf_claim_conversation_outbox_v1()`,
      ),
    ),
  );
  const firstClaims = firstWave.flatMap((result) => result.rows);
  assert.equal(
    firstClaims.length,
    20,
    "one head turn should claim per conversation",
  );
  assert.equal(
    new Set(firstClaims.map((row) => row.conversation_id)).size,
    20,
    "no conversation may be claimed twice across replicas",
  );

  await pool.query(
    `update ${schema}.communication_conversation_outbox
        set status='accepted', updated_at=clock_timestamp()
      where status='claimed'`,
  );

  const secondWave = await Promise.all(
    Array.from({ length: 32 }, () =>
      pool.query(
        `select id,conversation_id from ${schema}.qf_claim_conversation_outbox_v1()`,
      ),
    ),
  );
  const secondClaims = secondWave.flatMap((result) => result.rows);
  assert.equal(secondClaims.length, 20);
  assert.equal(
    new Set(secondClaims.map((row) => row.conversation_id)).size,
    20,
  );

  const turnConversation = uuid("3", 1);
  await pool.query(
    `insert into ${schema}.communication_jarvis_turn_outbox
      (id,conversation_id,status,turn_purpose,next_retry_at,created_at,updated_at)
     values
      ($1,$3,'pending','lead_qualification',null,'2026-10-05T10:00:00Z',clock_timestamp()),
      ($2,$3,'pending','conversation',null,'2026-10-05T10:00:01Z',clock_timestamp())`,
    [uuid("4", 1), uuid("4", 2), turnConversation],
  );

  const overtaking = await pool.query(
    `select * from ${schema}.qf_claim_jarvis_turn_outbox_v1(true,false)`,
  );
  assert.equal(
    overtaking.rowCount,
    0,
    "dedicated conversation lane must not overtake qualification",
  );

  const qualification = await pool.query(
    `select * from ${schema}.qf_claim_jarvis_turn_outbox_v1(false,true)`,
  );
  assert.equal(qualification.rows[0]?.id, uuid("4", 1));
  await pool.query(
    `update ${schema}.communication_jarvis_turn_outbox
        set status='accepted', updated_at=clock_timestamp()
      where id=$1`,
    [uuid("4", 1)],
  );
  const conversationTurn = await pool.query(
    `select * from ${schema}.qf_claim_jarvis_turn_outbox_v1(true,false)`,
  );
  assert.equal(conversationTurn.rows[0]?.id, uuid("4", 2));

  console.log("PHASE12_HORIZONTAL_MESSAGE_CERT_COMPLETE");
  console.log(
    JSON.stringify(
      {
        concurrentReplicas: 32,
        conversations: 20,
        firstWaveClaims: firstClaims.length,
        secondWaveClaims: secondClaims.length,
        perConversationOrdering: "PASS",
        crossAgentLaneOrdering: "PASS",
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
