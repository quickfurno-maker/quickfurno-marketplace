import { z } from "zod";

export const QFJ_OPERATOR_COMMAND_PROTOCOL = "qfj.operator.command.v1" as const;
export const QFJ_OPERATOR_COMMAND_PATH = "/api/internal/jarvis/operator-command" as const;
export const QFJ_OPERATOR_COMMAND_SIGNING_DOMAIN = "qfj.jarvis-os.operator-command.http.sig.v1" as const;
export const QFJ_OPERATOR_COMMAND_CALLER = "qf-jarvis-os" as const;
export const QFJ_OPERATOR_COMMAND_AUDIENCE = "quickfurno-core" as const;
export const QFJ_OPERATOR_COMMAND_OPERATOR_ID_HEADER = "x-qfj-operator-id" as const;
export const QFJ_OPERATOR_COMMAND_FRESHNESS_MS = 60_000;

const instant=z.string().datetime({offset:false});
const uuid=z.string().uuid();
const ref=z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const base={
  protocol:z.literal(QFJ_OPERATOR_COMMAND_PROTOCOL),
  commandId:uuid,
  issuedAt:instant,
  idempotencyKey:ref,
  clientPlatform:z.enum(["WEB","IOS","ANDROID"]),
} as const;

const approval=z.object({
  ...base,
  action:z.literal("APPROVAL_DECIDE"),
  payload:z.object({approvalId:uuid,decision:z.enum(["APPROVE","REJECT"])}).strict(),
}).strict();
const conversation=<T extends "CONVERSATION_TAKEOVER"|"CONVERSATION_RESUME_AI"|"CONVERSATION_PAUSE_AI">(action:T)=>z.object({
  ...base,
  action:z.literal(action),
  payload:z.object({conversationId:uuid,expectedRevision:z.number().int().nonnegative().max(1_000_000)}).strict(),
}).strict();

export const qfjOperatorCommandSchema=z.discriminatedUnion("action",[
  approval,
  conversation("CONVERSATION_TAKEOVER"),
  conversation("CONVERSATION_RESUME_AI"),
  conversation("CONVERSATION_PAUSE_AI"),
]);

export const qfjOperatorCommandResultSchema=z.object({
  protocol:z.literal(QFJ_OPERATOR_COMMAND_PROTOCOL),
  commandId:uuid,
  status:z.enum(["SUBMITTED_TO_AUTHORITY","APPLIED_BY_AUTHORITY","REFUSED","UNAVAILABLE","CONFLICT"]),
  jarvisAuthorized:z.literal(false),
  reasonCode:ref,
}).strict();

export type QfjOperatorCommand=z.infer<typeof qfjOperatorCommandSchema>;
export type QfjOperatorCommandResult=z.infer<typeof qfjOperatorCommandResultSchema>;

export function parseQfjOperatorCommand(value:unknown):QfjOperatorCommand|null{
  const parsed=qfjOperatorCommandSchema.safeParse(value);
  return parsed.success?parsed.data:null;
}
export function parseQfjOperatorCommandResult(value:unknown):QfjOperatorCommandResult|null{
  const parsed=qfjOperatorCommandResultSchema.safeParse(value);
  return parsed.success?parsed.data:null;
}
