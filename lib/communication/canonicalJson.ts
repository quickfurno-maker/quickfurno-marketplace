// ============================================================================
// QuickFurno — lib/communication/canonicalJson.ts   (Phase 5F-B)
//
// A STABLE, DETERMINISTIC JSON serializer for fingerprinting.
//
// `JSON.stringify` emits object keys in insertion order, which for an arbitrary
// nested structure (a provider mapping's `variables_schema`, read back from jsonb)
// is NOT guaranteed to be stable across drivers, rows, or PostgreSQL versions. Two
// semantically identical schemas would then hash differently, and — far worse — a
// re-ordered clone of a MUTATED schema could hash identically to the original if we
// hashed only a subset. So this module fixes a single canonical form:
//
//   • object keys are emitted in ascending UTF-16 code-unit order (Array.sort());
//   • array order is SIGNIFICANT and preserved (it carries meaning);
//   • numbers use the JSON grammar (`-0` → `0`); non-finite → `null`, as JSON.stringify;
//   • `undefined` / function / symbol values are dropped from objects and become
//     `null` inside arrays — again matching JSON.stringify, but deterministically;
//   • `toJSON()` is deliberately NOT honoured: a value must not get to choose its
//     own fingerprint representation;
//   • a cyclic structure throws rather than looping (fail closed).
//
// This module is PURE: no I/O, no clock, no randomness. It never sees a secret —
// callers must only pass non-secret operational data.
// ============================================================================

export const CANONICAL_JSON_CYCLE_ERROR = "CANONICAL_JSON_CYCLIC_STRUCTURE";

/** Values JSON.stringify omits from an object and renders as `null` in an array. */
function isOmittedInObject(value: unknown): boolean {
  const t = typeof value;
  return t === "undefined" || t === "function" || t === "symbol";
}

function writeNumber(value: number): string {
  // `JSON.stringify` normalizes -0 → "0" and renders exponents canonically.
  return Number.isFinite(value) ? JSON.stringify(value) : "null";
}

function writeValue(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return writeNumber(value);
    case "bigint":
      // jsonb never yields a bigint; render its exact decimal digits deterministically.
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      // Only reachable inside an array — object keys holding these are dropped below.
      return "null";
    default:
      break;
  }

  const obj = value as object;
  if (seen.has(obj)) throw new Error(CANONICAL_JSON_CYCLE_ERROR);
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      return `[${obj.map((item) => writeValue(item, seen)).join(",")}]`;
    }
    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => !isOmittedInObject(record[key]))
      .sort();
    const members = keys.map((key) => `${JSON.stringify(key)}:${writeValue(record[key], seen)}`);
    return `{${members.join(",")}}`;
  } finally {
    seen.delete(obj);
  }
}

/**
 * Serialize `value` to its single canonical JSON form. Two structurally equal values
 * always produce the identical string, regardless of key insertion order.
 */
export function canonicalJsonStringify(value: unknown): string {
  return writeValue(value, new Set<object>());
}
