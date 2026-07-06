import type { JsonRecord } from "./workflowPersistenceTypes";
import type { OutboxCommandRequest, WorkflowHandlerResult, WorkflowTaskRequest } from "./workflowTypes";

export function validateHandlerResult(result: WorkflowHandlerResult): { ok: true } | { ok: false; message: string } {
  if (!result || typeof result !== "object") return { ok: false, message: "INVALID_HANDLER_RESULT" };
  if (typeof result.nextState !== "string" || !result.nextState.trim()) {
    return { ok: false, message: "HANDLER_NEXT_STATE_REQUIRED" };
  }
  if (result.metadata !== undefined && !isPlainObject(result.metadata)) {
    return { ok: false, message: "HANDLER_METADATA_MUST_BE_OBJECT" };
  }
  for (const task of result.tasks ?? []) {
    const taskValidation = validateTaskRequest(task);
    if (!taskValidation.ok) return taskValidation;
  }
  for (const command of result.outboxCommands ?? []) {
    const commandValidation = validateOutboxCommand(command);
    if (!commandValidation.ok) return commandValidation;
  }
  return { ok: true };
}

function validateTaskRequest(task: WorkflowTaskRequest): { ok: true } | { ok: false; message: string } {
  if (typeof task.taskType !== "string" || !task.taskType.trim()) {
    return { ok: false, message: "TASK_TYPE_REQUIRED" };
  }
  if (task.payload !== undefined && !isPlainObject(task.payload)) {
    return { ok: false, message: "TASK_PAYLOAD_MUST_BE_OBJECT" };
  }
  return { ok: true };
}

function validateOutboxCommand(command: OutboxCommandRequest): { ok: true } | { ok: false; message: string } {
  if (typeof command.commandType !== "string" || !command.commandType.trim()) {
    return { ok: false, message: "OUTBOX_COMMAND_TYPE_REQUIRED" };
  }
  if (typeof command.idempotencyKey !== "string" || !command.idempotencyKey.trim()) {
    return { ok: false, message: "OUTBOX_IDEMPOTENCY_KEY_REQUIRED" };
  }
  if (command.payload !== undefined && !isPlainObject(command.payload)) {
    return { ok: false, message: "OUTBOX_PAYLOAD_MUST_BE_OBJECT" };
  }
  return { ok: true };
}

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

