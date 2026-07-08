// ============================================================================
// QuickFurno — lib/communication/dbErrors.ts
//
// Postgres error classification for the communication core.
//
// The database unique constraints are the FINAL authority on idempotency and
// webhook de-duplication — an application-level "SELECT then INSERT" is always
// racy. These helpers let the service treat a unique violation as a normal,
// expected outcome rather than an error to surface to the caller.
// ============================================================================

/** Postgres `unique_violation`. */
export const PG_UNIQUE_VIOLATION = "23505";
/** Postgres `foreign_key_violation`. */
export const PG_FOREIGN_KEY_VIOLATION = "23503";

interface PostgresErrorShape {
  readonly code?: string;
  readonly message?: string;
  readonly details?: string;
  readonly constraint?: string;
}

function asPgError(err: unknown): PostgresErrorShape | null {
  if (!err || typeof err !== "object") return null;
  return err as PostgresErrorShape;
}

/** True when the error is a unique-constraint violation (23505). */
export function isUniqueViolationError(err: unknown): boolean {
  const e = asPgError(err);
  if (!e) return false;
  if (e.code === PG_UNIQUE_VIOLATION) return true;
  return /duplicate key value violates unique constraint/i.test(e.message ?? "");
}

/** True when the error is a foreign-key violation (23503). */
export function isForeignKeyViolationError(err: unknown): boolean {
  const e = asPgError(err);
  if (!e) return false;
  if (e.code === PG_FOREIGN_KEY_VIOLATION) return true;
  return /violates foreign key constraint/i.test(e.message ?? "");
}

/**
 * Best-effort name of the constraint a unique violation fired on. PostgREST
 * surfaces it in `constraint`, `details` or the message text depending on
 * version, so all three are inspected.
 */
export function uniqueViolationConstraint(err: unknown): string | null {
  const e = asPgError(err);
  if (!e) return null;
  if (e.constraint) return e.constraint;
  const haystack = `${e.message ?? ""} ${e.details ?? ""}`;
  const match = haystack.match(/unique constraint "([^"]+)"/i);
  return match ? match[1] : null;
}

/**
 * True when the error is a unique violation whose constraint name contains
 * `fragment`. Use this to distinguish (for example) an idempotency-key conflict
 * from an unrelated unique conflict on the same insert.
 */
export function isUniqueViolationOn(err: unknown, fragment: string): boolean {
  if (!isUniqueViolationError(err)) return false;
  const constraint = uniqueViolationConstraint(err);
  if (!constraint) return true; // constraint name unavailable — assume it is ours
  return constraint.toLowerCase().includes(fragment.toLowerCase());
}
