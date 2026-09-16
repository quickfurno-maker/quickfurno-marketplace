import type { QfjCoreDecisionCommandV2, QfjCoreDecisionResponseV2 } from "@/lib/jarvis/coreDecisionContract";
import { decideJarvisCoreCommand, type JarvisCoreAuthorizer } from "./jarvisCoreDecisionService";
import type { QfJarvisRuntimePolicy } from "@/lib/jarvis/runtimePolicy";

const TABLE = "jarvis_core_decision_receipts";

type DbClient = ReturnType<typeof import("../lib/supabase")["adminClient"]>;

type ReceiptRow = {
  command_id: string;
  idempotency_key: string;
  proposal_id: string;
  proposal_version: number;
  conversation_id: string;
  expected_revision: number;
  proposal_digest: string;
  state: "processing" | "completed";
  response: QfjCoreDecisionResponseV2 | null;
};

async function productionDb(): Promise<DbClient> {
  const { adminClient } = await import("../lib/supabase");
  return adminClient();
}

function sameCommand(row: ReceiptRow, command: QfjCoreDecisionCommandV2): boolean {
  return row.command_id === command.commandId && row.idempotency_key === command.idempotencyKey &&
    row.proposal_id === command.proposalId && row.proposal_version === command.proposalVersion &&
    row.conversation_id === command.conversationId && row.expected_revision === command.expectedRevision &&
    row.proposal_digest === command.proposalDigest;
}

async function readExisting(db: DbClient, command: QfjCoreDecisionCommandV2): Promise<ReceiptRow | null> {
  const byCommand = await db.from(TABLE).select("*").eq("command_id", command.commandId).maybeSingle();
  if (byCommand.error) throw byCommand.error;
  if (byCommand.data) return byCommand.data as ReceiptRow;
  const byIdempotency = await db.from(TABLE).select("*").eq("idempotency_key", command.idempotencyKey).maybeSingle();
  if (byIdempotency.error) throw byIdempotency.error;
  return (byIdempotency.data as ReceiptRow | null) ?? null;
}

export type JarvisReplayDecisionResult =
  | { readonly ok: true; readonly response: QfjCoreDecisionResponseV2; readonly replayed: boolean }
  | { readonly ok: false; readonly reason: "conflict" | "unavailable" };

export async function decideJarvisCoreCommandWithReplay(args: {
  readonly command: QfjCoreDecisionCommandV2;
  readonly policy: QfJarvisRuntimePolicy;
  readonly decidedAt: string;
  readonly authorizer: JarvisCoreAuthorizer;
  readonly db?: DbClient;
}): Promise<JarvisReplayDecisionResult> {
  const db = args.db ?? await productionDb();
  const existing = await readExisting(db, args.command);
  if (existing) {
    if (!sameCommand(existing, args.command)) return { ok: false, reason: "conflict" };
    if (existing.state === "completed" && existing.response) {
      return { ok: true, response: existing.response, replayed: true };
    }
    return { ok: false, reason: "unavailable" };
  }

  const insert = await db.from(TABLE).insert({
    command_id: args.command.commandId,
    idempotency_key: args.command.idempotencyKey,
    proposal_id: args.command.proposalId,
    proposal_version: args.command.proposalVersion,
    conversation_id: args.command.conversationId,
    expected_revision: args.command.expectedRevision,
    proposal_digest: args.command.proposalDigest,
    state: "processing",
  });
  if (insert.error) {
    const raced = await readExisting(db, args.command);
    if (!raced || !sameCommand(raced, args.command)) return { ok: false, reason: "conflict" };
    if (raced.state === "completed" && raced.response) {
      return { ok: true, response: raced.response, replayed: true };
    }
    return { ok: false, reason: "unavailable" };
  }

  const response = await decideJarvisCoreCommand({
    command: args.command,
    policy: args.policy,
    decidedAt: args.decidedAt,
    authorizer: args.authorizer,
  });
  const completed = await db.from(TABLE).update({
    state: "completed",
    outcome: response.outcome,
    reason: response.reason,
    response,
    completed_at: args.decidedAt,
  }).eq("command_id", args.command.commandId).eq("state", "processing");
  if (completed.error) return { ok: false, reason: "unavailable" };
  return { ok: true, response, replayed: false };
}
