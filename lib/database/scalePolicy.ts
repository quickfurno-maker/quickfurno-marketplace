/**
 * SCALE-P09 database scale policy.
 *
 * QuickFurno web/API replicas use Supabase Data API clients. They do not open a
 * direct node-postgres pool per container. This prevents horizontal web scaling
 * from multiplying PostgreSQL backend pools in application code.
 *
 * Direct PostgreSQL connections remain for controlled maintenance/migrations
 * and local/CI certification only. If a future stateless/short-lived runtime
 * needs direct SQL, it must use a reviewed pooled path (Supavisor transaction
 * mode where compatible, with prepared statements disabled). Session-state
 * workloads must use direct/session-mode connections instead.
 */
export const QUICKFURNO_DATABASE_SCALE_POLICY = Object.freeze({
  observedMaxConnections: 60,
  runtimeConnectionMode: "SUPABASE_DATA_API",
  runtimeCreatesPgPool: false,
  futureTransientSqlMode: "SUPAVISOR_TRANSACTION_WHEN_SESSION_STATE_FREE",
  migrationMode: "DIRECT_OR_SESSION",
  partitionReviewThresholdBytes: 5 * 1024 * 1024 * 1024,
} as const);

export type DatabaseReadConsistency = "PRIMARY_STRONG" | "REPLICA_EVENTUAL";

export type DatabaseReadUseCase =
  | "lead_assignment"
  | "credit_balance"
  | "payment_state"
  | "consent_state"
  | "idempotency_replay"
  | "job_claim"
  | "post_write_confirmation"
  | "analytics"
  | "historical_report"
  | "telemetry"
  | "public_catalog";

const STRONG_READS = new Set<DatabaseReadUseCase>([
  "lead_assignment",
  "credit_balance",
  "payment_state",
  "consent_state",
  "idempotency_replay",
  "job_claim",
  "post_write_confirmation",
]);

/**
 * Future read replicas are opt-in only. Any correctness-sensitive or
 * read-after-write path remains primary forever unless its business contract is
 * deliberately changed and certified.
 */
export function databaseReadConsistencyFor(
  useCase: DatabaseReadUseCase,
): DatabaseReadConsistency {
  return STRONG_READS.has(useCase) ? "PRIMARY_STRONG" : "REPLICA_EVENTUAL";
}

export const QUICKFURNO_LIFECYCLE_DEFAULTS = Object.freeze({
  maxPruneBatch: 1000,
  minimumPruneAgeHours: 24,
  autoPrunablePolicies: Object.freeze([
    "automation_transport_requests_v1",
    "communication_webhook_receipts_v1",
  ]),
  protectedEvidenceClasses: Object.freeze(["business_evidence", "audit"]),
} as const);
