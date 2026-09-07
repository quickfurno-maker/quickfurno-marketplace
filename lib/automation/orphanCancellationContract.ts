// ============================================================================
// QuickFurno — lib/automation/orphanCancellationContract.ts   (PURE)
//
// QF-MVP-50.6 — the decision half of orphan automation-job cancellation.
//
// WHAT AN ORPHAN IS
//   A job whose authoritative business entity no longer exists. The lead was
//   deleted, the assignment was removed, the certification identity never
//   existed — but the job is still `pending` or `retry_scheduled` and still due,
//   so the ordinary claim and recovery lanes would hand it to an executor that
//   then tries to resolve a recipient for something that is gone.
//
// WHY THE RULES LIVE HERE
//   The database owns the transaction; this module owns the RULES, so they can
//   be executed by a validator rather than read out of SQL. Both sides state the
//   same closed vocabulary, and the gate proves they agree.
//
// FAIL CLOSED IS THE POINT
//   Three outcomes, and only one of them cancels. An entity type outside the
//   closed map is `unmapped` — Core concludes NOTHING and the job stays queued
//   for a human to look at. Cancelling on an unrecognised type would mean
//   terminalizing live work because Core did not recognise a name.
//
// PURE. No database, no client, no network, no provider, no send.
// ============================================================================

/**
 * The closed set of entity types this lane can reason about, and the
 * authoritative table each one resolves against. Adding a type here is a
 * deliberate, reviewed act — and it must be added to the SQL map in the same
 * change, which the gate enforces by comparing the two.
 */
export const AUTOMATION_ORPHAN_ENTITY_TABLES = Object.freeze({
  lead: "public.leads",
  lead_assignment: "public.lead_assignments",
  vendor: "public.vendors",
  communication_intent: "public.communication_intents",
} as const);

export const AUTOMATION_ORPHAN_ENTITY_TYPES = Object.freeze(
  Object.keys(AUTOMATION_ORPHAN_ENTITY_TABLES).sort() as ReadonlyArray<
    keyof typeof AUTOMATION_ORPHAN_ENTITY_TABLES
  >,
);

export type AutomationOrphanEntityType = (typeof AUTOMATION_ORPHAN_ENTITY_TYPES)[number];

/**
 * The three possible verdicts about an entity. Closed on purpose: there is no
 * "probably gone".
 *
 *   present  — the authoritative row exists. The job is live work.
 *   missing  — the type is mapped AND no row can exist for that id.
 *   unmapped — this contract does not know the type. Conclude nothing.
 */
export const AutomationEntityState = Object.freeze({
  PRESENT: "present",
  MISSING: "missing",
  UNMAPPED: "unmapped",
} as const);

export type AutomationEntityStateValue =
  (typeof AutomationEntityState)[keyof typeof AutomationEntityState];

/** The job statuses this lane may act on. Never `processing`, never terminal. */
export const AUTOMATION_ORPHAN_CANCELLABLE_STATUSES = Object.freeze([
  "pending",
  "retry_scheduled",
] as const);

/**
 * The FIXED, repository-owned reason. It is never supplied by a caller, never
 * chosen per job, and never interpolated — an orchestrator cannot invent a
 * reason for a cancellation it did not decide.
 */
export const AUTOMATION_ORPHAN_SAFE_CODE = "QF_AUTOMATION_ORPHAN_ENTITY_MISSING" as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Classifies one entity from the facts the database can supply.
 *
 * `rowExists` is what the authoritative table said. It is only consulted for a
 * mapped type with a well-formed uuid, because those are the only inputs for
 * which the question is even meaningful.
 *
 * A NON-UUID id against a uuid-keyed table is `missing`, not an error and not
 * `unmapped`. A uuid primary key cannot hold that value, so no row exists or
 * ever will — that is a proof about the schema rather than a guess about the
 * data, and it is what makes the certification-queue identities safely
 * cancellable while an unrecognised entity type stays untouchable.
 */
export function classifyAutomationEntityState(input: {
  readonly entityType: string | null | undefined;
  readonly entityId: string | null | undefined;
  readonly rowExists: boolean | null | undefined;
}): AutomationEntityStateValue {
  const type = input?.entityType;
  const id = input?.entityId;

  if (typeof type !== "string" || typeof id !== "string" || id === "") {
    return AutomationEntityState.UNMAPPED;
  }
  if (!(type in AUTOMATION_ORPHAN_ENTITY_TABLES)) {
    return AutomationEntityState.UNMAPPED;
  }
  if (!UUID_RE.test(id)) {
    return AutomationEntityState.MISSING;
  }
  if (input?.rowExists !== true && input?.rowExists !== false) {
    // The row was never looked up, so nothing is known. Refuse to conclude.
    return AutomationEntityState.UNMAPPED;
  }
  return input.rowExists ? AutomationEntityState.PRESENT : AutomationEntityState.MISSING;
}

/** Closed refusal vocabulary for a candidate that must not be cancelled. */
export const AutomationOrphanRefusal = Object.freeze({
  ENTITY_PRESENT: "ENTITY_PRESENT",
  ENTITY_TYPE_UNMAPPED: "ENTITY_TYPE_UNMAPPED",
  JOB_STATUS_NOT_CANCELLABLE: "JOB_STATUS_NOT_CANCELLABLE",
  ALREADY_CANCELLED_ONCE: "ALREADY_CANCELLED_ONCE",
} as const);

export type AutomationOrphanRefusalValue =
  (typeof AutomationOrphanRefusal)[keyof typeof AutomationOrphanRefusal];

export interface AutomationOrphanVerdict {
  readonly cancellable: boolean;
  readonly reason: AutomationOrphanRefusalValue | null;
  readonly entityState: AutomationEntityStateValue;
  /** Present only when the verdict actually cancels. */
  readonly safeCode: typeof AUTOMATION_ORPHAN_SAFE_CODE | null;
}

/**
 * The single eligibility decision, mirroring the SQL selector exactly.
 *
 * Status is checked BEFORE entity state so a `processing` job is refused for the
 * right reason: it belongs to execution and reconciliation, and whether its
 * entity happens to be gone is not this lane's business.
 */
export function decideAutomationOrphanCancellation(input: {
  readonly jobStatus: string | null | undefined;
  readonly entityType: string | null | undefined;
  readonly entityId: string | null | undefined;
  readonly rowExists: boolean | null | undefined;
  readonly alreadyCancelledOnce?: boolean;
}): AutomationOrphanVerdict {
  const entityState = classifyAutomationEntityState(input);
  const refuse = (reason: AutomationOrphanRefusalValue): AutomationOrphanVerdict => ({
    cancellable: false,
    reason,
    entityState,
    safeCode: null,
  });

  const statuses = AUTOMATION_ORPHAN_CANCELLABLE_STATUSES as readonly string[];
  if (typeof input?.jobStatus !== "string" || !statuses.includes(input.jobStatus)) {
    return refuse(AutomationOrphanRefusal.JOB_STATUS_NOT_CANCELLABLE);
  }
  if (input?.alreadyCancelledOnce === true) {
    return refuse(AutomationOrphanRefusal.ALREADY_CANCELLED_ONCE);
  }
  if (entityState === AutomationEntityState.UNMAPPED) {
    return refuse(AutomationOrphanRefusal.ENTITY_TYPE_UNMAPPED);
  }
  if (entityState === AutomationEntityState.PRESENT) {
    return refuse(AutomationOrphanRefusal.ENTITY_PRESENT);
  }

  return {
    cancellable: true,
    reason: null,
    entityState,
    safeCode: AUTOMATION_ORPHAN_SAFE_CODE,
  };
}

/**
 * The exact row shape a cancelled job must hold. Stated once, here, so the gate
 * can assert it rather than paraphrase it.
 *
 * `attemptCount` and `maxAttempts` are deliberately absent: cancellation does
 * not touch them, and the job update guard independently rejects any attempt to.
 */
export const AUTOMATION_ORPHAN_CANCELLED_JOB_SHAPE = Object.freeze({
  status: "cancelled",
  completedAtRequired: true,
  lockedAt: null,
  lockedBy: null,
  nextRetryAt: null,
  lastResultClassification: null,
  lastSafeCode: AUTOMATION_ORPHAN_SAFE_CODE,
} as const);

// ---------------------------------------------------------------------------
// Transport request / response
// ---------------------------------------------------------------------------

/**
 * The COMPLETE set of body keys, sorted. There is deliberately no jobId,
 * entityId, entityType, reason, safeCode, status or force field — refusing to
 * parse them is stronger than accepting and ignoring them, because a reader can
 * see that Core could not have been told which job to cancel.
 */
export const N8N_CANCEL_ORPHAN_REQUEST_KEYS = Object.freeze([
  "requestId",
  "transportVersion",
  "workerId",
] as const);

export interface AutomationCancelOrphanRequestBody {
  readonly transportVersion: 1;
  readonly requestId: string;
  readonly workerId: string;
}

export type AutomationCancelOrphanParseResult =
  | { readonly ok: true; readonly body: AutomationCancelOrphanRequestBody }
  | { readonly ok: false; readonly status: number; readonly code: string };

const SAFE_WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export function parseCancelOrphanRequestBody(
  rawBody: string,
): AutomationCancelOrphanParseResult {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_JSON_INVALID" };
  }

  if (!isRecord(value)) {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_BODY_INVALID" };
  }

  // EXACT key set. An extra field is a rejection, not a warning — that is what
  // makes "n8n cannot choose a job" a structural fact rather than a convention.
  const keys = Object.keys(value).sort();
  if (
    keys.length !== N8N_CANCEL_ORPHAN_REQUEST_KEYS.length ||
    keys.some((key, index) => key !== N8N_CANCEL_ORPHAN_REQUEST_KEYS[index])
  ) {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID" };
  }

  if (value.transportVersion !== 1) {
    return { ok: false, status: 400, code: "TRANSPORT_VERSION_INVALID" };
  }
  if (typeof value.requestId !== "string" || !UUID_RE.test(value.requestId)) {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_REQUEST_ID_INVALID" };
  }
  if (typeof value.workerId !== "string" || !SAFE_WORKER_RE.test(value.workerId)) {
    return { ok: false, status: 400, code: "AUTOMATION_TRANSPORT_WORKER_ID_INVALID" };
  }

  return {
    ok: true,
    body: {
      transportVersion: 1,
      requestId: value.requestId,
      workerId: value.workerId,
    },
  };
}

/**
 * The COMPLETE, closed set of Core-authored `cancel_orphan_v1` states.
 *
 *   cancel_orphan_empty      nothing was eligible. n8n stops.
 *   cancel_orphan_cancelled  exactly one orphan moved to the terminal cancelled
 *                            state. No attempt was opened, no message was sent,
 *                            and nothing is handed onward. n8n stops.
 *   rejected                 authentication, authorization or an invariant was
 *                            not proven. Nothing was mutated.
 *
 * Every outcome terminates the orchestration. There is no state that hands work
 * to an executor, because this lane exists to REMOVE work from the executable
 * set — never to introduce any.
 */
export const AUTOMATION_CANCEL_ORPHAN_ORCHESTRATION_STATES = Object.freeze([
  "cancel_orphan_empty",
  "cancel_orphan_cancelled",
  "rejected",
] as const);

export type AutomationCancelOrphanOrchestrationState =
  (typeof AUTOMATION_CANCEL_ORPHAN_ORCHESTRATION_STATES)[number];

/**
 * Sanitized `cancel_orphan_v1` answer.
 *
 * `entityType` is a CLOSED vocabulary word — never an id, and never the value of
 * anything. `safeCode` is the single repository-owned constant. Both are
 * observability only; n8n branches on `orchestrationState` and nothing else.
 *
 * Deliberately absent everywhere: entity id, recipient, destination, phone,
 * template key, variables, provider key, provider account, provider message id,
 * raw provider status/body/error, consent state, lead data, SQL, stack, secret,
 * environment value. A cancellation lane in particular has no business emitting
 * a business identifier, since the whole point is that the business record is
 * gone.
 */
export interface N8nCancelOrphanSuccessBody {
  readonly ok: true;
  readonly transportVersion: 1;
  readonly requestId: string;
  readonly route: "cancel_orphan_v1";
  readonly orchestrationState: Exclude<
    AutomationCancelOrphanOrchestrationState,
    "rejected"
  >;
  readonly replayed: boolean;
  /** Present ONLY on `cancel_orphan_cancelled`. */
  readonly entityType?: AutomationOrphanEntityType;
  /** Present ONLY on `cancel_orphan_cancelled`. Always the fixed constant. */
  readonly safeCode?: typeof AUTOMATION_ORPHAN_SAFE_CODE;
}

export interface N8nCancelOrphanRejectionBody {
  readonly ok: false;
  readonly transportVersion: 1;
  readonly requestId: string;
  readonly route: "cancel_orphan_v1";
  readonly orchestrationState: "rejected";
  readonly code: string;
}

export type CancelOrphanResult =
  | { ok: true; body: N8nCancelOrphanSuccessBody }
  | { ok: false; status: number; code: string };

/** Narrowing helper so the service never widens the closed entity vocabulary. */
export function isAutomationOrphanEntityType(
  value: unknown,
): value is AutomationOrphanEntityType {
  return typeof value === "string" && value in AUTOMATION_ORPHAN_ENTITY_TABLES;
}
