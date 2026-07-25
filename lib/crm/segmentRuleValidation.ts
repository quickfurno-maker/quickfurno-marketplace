// ============================================================================
// QF-MVP-30.3 — segment rule validation, canonicalization and fingerprinting.
//
// PURE and offline: no DB, no `server-only`, no secret, no network. That is
// deliberate — it lets the rule engine be executed directly by the offline
// validator (the same reason vendorCrmValidation.ts hosts the search sanitizer).
//
// Pipeline:  validate -> normalize -> canonicalize -> fingerprint
//
// LOCKED PROPERTIES
//  * `field` and `op` are KEYS from the closed registries; a raw column name,
//    a raw PostgREST filter string or SQL can never enter the AST;
//  * no free-text/LIKE operator exists, so pattern grammar is structurally
//    impossible on the segment path (owner decision 5);
//  * package-expiry / package-order fields are refused with an explicit reason
//    (owner decision 4), as are consent/suppression/eligibility/PII/AI fields;
//  * canonical JSON has fixed key order and sorted, de-duplicated array values,
//    so semantically identical rules always produce the SAME sha256 fingerprint,
//    and any semantic change always produces a DIFFERENT one.
// ============================================================================

import { createHash } from "node:crypto";
import {
  SEGMENT_SCHEMA_VERSION, SEGMENT_TIMEZONE, SEGMENT_FIELDS, SEGMENT_PROHIBITED_FIELDS,
  SEGMENT_OPERATORS, SEGMENT_COMBINATORS, SEGMENT_MAX_GROUPS, SEGMENT_MAX_PREDICATES_PER_GROUP,
  SEGMENT_MAX_PREDICATES_TOTAL, SEGMENT_MAX_ARRAY_VALUES, SEGMENT_MAX_CANONICAL_BYTES,
  SEGMENT_MAX_NAME_LENGTH, SEGMENT_MAX_DESCRIPTION_LENGTH, SEGMENT_MIN_WINDOW_DAYS,
  SEGMENT_MAX_WINDOW_DAYS, SEGMENT_STATUSES,
  type SegmentCombinator, type SegmentDefinition, type SegmentOperator,
  type SegmentPredicate, type SegmentValueKind,
} from "./segmentRuleContracts";

export class SegmentValidationError extends Error {
  readonly code = "SEGMENT_VALIDATION";
  constructor(message: string) {
    super(message);
    this.name = "SegmentValidationError";
  }
}
const bad = (m: string): never => {
  throw new SegmentValidationError(m);
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function requireKnownKeys(input: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const k of Object.keys(input)) {
    if (!allowed.includes(k)) bad(`${label}: unknown field "${k}"`);
  }
}

function requireInteger(v: unknown, label: string): number {
  const n = typeof v === "number" ? v : Number(v);
  if (typeof v === "boolean" || v === null || v === "" || !Number.isFinite(n) || !Number.isInteger(n)) {
    bad(`${label} must be an integer`);
  }
  return n;
}

/**
 * Safe token charset for fields whose vocabulary is DATA-driven rather than a
 * frozen literal list (service categories, covered areas). Those values cannot be
 * membership-checked against a constant, so they are constrained instead:
 * Unicode letters/marks/digits, space, and & - ' . / + only.
 *
 * This is a security boundary, not cosmetics. Such a value is later embedded in
 * a PostgREST logic expression, whose grammar is delimited by , ( ) " and \ —
 * without this restriction an open-vocabulary value would be the one place raw
 * grammar could still enter the segment path.
 */
const SAFE_TOKEN_RE = /^[\p{L}\p{M}\p{N} &\-'./+]+$/u;
export const SEGMENT_MAX_TOKEN_LENGTH = 80;

function requireEnumValue(spec: { values?: readonly string[] }, v: unknown, field: string): string {
  if (typeof v !== "string") bad(`${field}: value must be a string`);
  const s = v as string;
  if (spec.values) {
    if (!spec.values.includes(s)) bad(`${field}: "${s}" is not in the closed vocabulary`);
    return s;
  }
  // open vocabulary (data-driven): constrain the charset instead of the list.
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length === 0) bad(`${field}: value must not be empty`);
  if (t.length > SEGMENT_MAX_TOKEN_LENGTH) bad(`${field}: value is too long`);
  if (!SAFE_TOKEN_RE.test(t)) bad(`${field}: value contains an unsupported character`);
  return t;
}

/** Which value kind an (operator, field) pair expects. */
function resolveValueKind(op: SegmentOperator, field: string): SegmentValueKind {
  const spec = SEGMENT_FIELDS[field];
  const kinds = SEGMENT_OPERATORS[op].valueKinds as readonly SegmentValueKind[];
  if (kinds.length === 1) return kinds[0];
  // eq/neq/in/not_in are enum- or uuid-shaped depending on the field. The field
  // declares which explicitly (uuidValued) — never inferred from a column name.
  const uuidish = spec.uuidValued === true;
  if (kinds.includes("uuid") && uuidish) return "uuid";
  if (kinds.includes("uuid_array") && uuidish) return "uuid_array";
  if (kinds.includes("integer") && !spec.values) return "integer";
  if (kinds.includes("enum_array")) return "enum_array";
  if (kinds.includes("enum")) return "enum";
  return kinds[0];
}

function normalizeValue(kind: SegmentValueKind, raw: unknown, field: string, op: string) {
  const spec = SEGMENT_FIELDS[field];
  switch (kind) {
    case "none":
      if (raw !== undefined && raw !== null) bad(`${field}.${op} must not carry a value`);
      return undefined;
    case "enum":
      return requireEnumValue(spec, raw, field);
    case "uuid":
      if (typeof raw !== "string" || !UUID_RE.test(raw)) bad(`${field}.${op} requires a uuid`);
      return (raw as string).toLowerCase();
    case "integer":
      return requireInteger(raw, `${field}.${op}`);
    case "days": {
      const n = requireInteger(raw, `${field}.${op}`);
      if (n < SEGMENT_MIN_WINDOW_DAYS || n > SEGMENT_MAX_WINDOW_DAYS) {
        bad(`${field}.${op} must be between ${SEGMENT_MIN_WINDOW_DAYS} and ${SEGMENT_MAX_WINDOW_DAYS} days`);
      }
      return n;
    }
    case "integer_pair": {
      if (!Array.isArray(raw) || raw.length !== 2) bad(`${field}.${op} requires exactly two integers`);
      const lo = requireInteger((raw as unknown[])[0], `${field}.${op}[0]`);
      const hi = requireInteger((raw as unknown[])[1], `${field}.${op}[1]`);
      if (lo > hi) bad(`${field}.${op} requires lo <= hi`);
      return [lo, hi];
    }
    case "enum_array":
    case "uuid_array": {
      if (!Array.isArray(raw)) bad(`${field}.${op} requires a list`);
      const arr = raw as unknown[];
      if (arr.length === 0) bad(`${field}.${op} requires at least one value`);
      if (arr.length > SEGMENT_MAX_ARRAY_VALUES) {
        bad(`${field}.${op} accepts at most ${SEGMENT_MAX_ARRAY_VALUES} values`);
      }
      const vals = arr.map((x, i) =>
        kind === "uuid_array"
          ? (typeof x === "string" && UUID_RE.test(x) ? x.toLowerCase() : bad(`${field}.${op}[${i}] must be a uuid`))
          : requireEnumValue(spec, x, `${field}.${op}[${i}]`));
      // de-duplicate + sort => order-independent fingerprint.
      return Array.from(new Set(vals)).sort();
    }
    default:
      return bad(`${field}.${op}: unsupported value kind`);
  }
}

function validatePredicate(input: unknown, label: string): SegmentPredicate {
  if (!isPlainObject(input)) return bad(`${label} must be an object`);
  requireKnownKeys(input, ["field", "op", "value"], label);

  const field = input.field;
  if (typeof field !== "string") return bad(`${label}.field must be a string`);
  // explicit refusal beats a generic "unknown field" so a mistake fails loudly.
  const prohibited = SEGMENT_PROHIBITED_FIELDS[field];
  if (prohibited) return bad(`${label}: field "${field}" is not permitted — ${prohibited}`);
  if (!Object.prototype.hasOwnProperty.call(SEGMENT_FIELDS, field)) {
    return bad(`${label}: unknown field "${field}"`);
  }

  const op = input.op;
  if (typeof op !== "string" || !Object.prototype.hasOwnProperty.call(SEGMENT_OPERATORS, op)) {
    return bad(`${label}: unknown operator "${String(op)}"`);
  }
  const spec = SEGMENT_FIELDS[field];
  if (!spec.operators.includes(op as SegmentOperator)) {
    return bad(`${label}: operator "${op}" is not allowed on "${field}"`);
  }

  const kind = resolveValueKind(op as SegmentOperator, field);
  const value = normalizeValue(kind, input.value, field, op);
  return value === undefined
    ? { field, op: op as SegmentOperator }
    : { field, op: op as SegmentOperator, value: value as SegmentPredicate["value"] };
}

/** Deterministic predicate identity — used to drop exact duplicates within a group. */
function predicateKey(p: SegmentPredicate): string {
  return `${p.field}|${p.op}|${JSON.stringify(p.value ?? null)}`;
}

function validateGroup(input: unknown, label: string): { combinator: SegmentCombinator; predicates: SegmentPredicate[] } {
  if (!isPlainObject(input)) return bad(`${label} must be an object`);
  requireKnownKeys(input, ["combinator", "predicates"], label);

  const combinator = input.combinator;
  if (typeof combinator !== "string" || !(SEGMENT_COMBINATORS as readonly string[]).includes(combinator)) {
    return bad(`${label}.combinator must be AND or OR`);
  }
  if (!Array.isArray(input.predicates)) return bad(`${label}.predicates must be a list`);
  const raw = input.predicates as unknown[];
  if (raw.length === 0) return bad(`${label} must contain at least one predicate`);
  if (raw.length > SEGMENT_MAX_PREDICATES_PER_GROUP) {
    return bad(`${label} accepts at most ${SEGMENT_MAX_PREDICATES_PER_GROUP} predicates`);
  }

  const seen = new Set<string>();
  const predicates: SegmentPredicate[] = [];
  raw.forEach((p, i) => {
    const parsed = validatePredicate(p, `${label}.predicates[${i}]`);
    const key = predicateKey(parsed);
    // an exact duplicate is semantically a no-op; collapse it so it cannot change
    // the fingerprint of an otherwise identical rule.
    if (!seen.has(key)) { seen.add(key); predicates.push(parsed); }
  });
  // stable order => order-independent fingerprint.
  predicates.sort((a, b) => predicateKey(a).localeCompare(predicateKey(b)));
  return { combinator: combinator as SegmentCombinator, predicates };
}

/** Validate + normalize an untrusted rule document into the canonical AST. */
export function validateSegmentDefinition(input: unknown): SegmentDefinition {
  if (!isPlainObject(input)) return bad("definition must be an object");
  requireKnownKeys(input, ["schema_version", "combinator", "groups"], "definition");

  if (input.schema_version !== SEGMENT_SCHEMA_VERSION) {
    return bad(`definition.schema_version must be ${SEGMENT_SCHEMA_VERSION}`);
  }
  const combinator = input.combinator;
  if (typeof combinator !== "string" || !(SEGMENT_COMBINATORS as readonly string[]).includes(combinator)) {
    return bad("definition.combinator must be AND or OR");
  }
  if (!Array.isArray(input.groups)) return bad("definition.groups must be a list");
  const rawGroups = input.groups as unknown[];
  if (rawGroups.length === 0) return bad("definition must contain at least one group");
  if (rawGroups.length > SEGMENT_MAX_GROUPS) {
    return bad(`definition accepts at most ${SEGMENT_MAX_GROUPS} groups`);
  }

  const groups = rawGroups.map((g, i) => validateGroup(g, `definition.groups[${i}]`));
  const total = groups.reduce((n, g) => n + g.predicates.length, 0);
  if (total > SEGMENT_MAX_PREDICATES_TOTAL) {
    return bad(`definition accepts at most ${SEGMENT_MAX_PREDICATES_TOTAL} predicates in total`);
  }

  // stable group order => order-independent fingerprint.
  const groupKey = (g: { combinator: string; predicates: SegmentPredicate[] }) =>
    `${g.combinator}|${g.predicates.map(predicateKey).join(";")}`;
  groups.sort((a, b) => groupKey(a).localeCompare(groupKey(b)));

  const definition: SegmentDefinition = {
    schema_version: SEGMENT_SCHEMA_VERSION,
    combinator: combinator as SegmentCombinator,
    groups,
  };

  const canonical = canonicalizeSegmentDefinition(definition);
  if (Buffer.byteLength(canonical, "utf8") > SEGMENT_MAX_CANONICAL_BYTES) {
    return bad(`definition exceeds ${SEGMENT_MAX_CANONICAL_BYTES} canonical bytes`);
  }
  return definition;
}

/**
 * Canonical JSON: fixed key order at every level, no incidental whitespace.
 * `JSON.stringify` preserves insertion order for string keys, so emitting the
 * keys explicitly (never spreading an input object) IS the canonical order.
 */
export function canonicalizeSegmentDefinition(def: SegmentDefinition): string {
  return JSON.stringify({
    schema_version: def.schema_version,
    combinator: def.combinator,
    groups: def.groups.map((g) => ({
      combinator: g.combinator,
      predicates: g.predicates.map((p) =>
        p.value === undefined
          ? { field: p.field, op: p.op }
          : { field: p.field, op: p.op, value: p.value }),
    })),
  });
}

/** sha256 hex of the canonical JSON. Stable across key/array/predicate ordering. */
export function fingerprintSegmentDefinition(def: SegmentDefinition): string {
  return createHash("sha256").update(canonicalizeSegmentDefinition(def), "utf8").digest("hex");
}

export interface NormalizedSegmentDefinition {
  readonly definition: SegmentDefinition;
  readonly canonical: string;
  readonly fingerprint: string;
  readonly schemaVersion: typeof SEGMENT_SCHEMA_VERSION;
  readonly predicateCount: number;
}

/** The single entry point later runtime code should use. */
export function normalizeSegmentDefinition(input: unknown): NormalizedSegmentDefinition {
  const definition = validateSegmentDefinition(input);
  const canonical = canonicalizeSegmentDefinition(definition);
  return {
    definition,
    canonical,
    fingerprint: createHash("sha256").update(canonical, "utf8").digest("hex"),
    schemaVersion: SEGMENT_SCHEMA_VERSION,
    predicateCount: definition.groups.reduce((n, g) => n + g.predicates.length, 0),
  };
}

// -- segment metadata ---------------------------------------------------------
export interface SegmentMetaInput {
  readonly name: string;
  readonly description: string | null;
  readonly status: (typeof SEGMENT_STATUSES)[number];
}

/** Name/description/status validation. Actor + timestamps are NEVER taken here. */
export function validateSegmentMeta(input: Record<string, unknown>): SegmentMetaInput {
  requireKnownKeys(input, ["name", "description", "status"], "segment");
  if (typeof input.name !== "string") bad("name is required");
  const name = (input.name as string).trim().replace(/\s+/g, " ");
  if (name.length === 0) bad("name is required");
  if (name.length > SEGMENT_MAX_NAME_LENGTH) bad(`name is too long (max ${SEGMENT_MAX_NAME_LENGTH})`);

  let description: string | null = null;
  if (input.description !== undefined && input.description !== null && input.description !== "") {
    if (typeof input.description !== "string") bad("description must be text");
    const d = (input.description as string).trim();
    if (d.length > SEGMENT_MAX_DESCRIPTION_LENGTH) bad(`description is too long (max ${SEGMENT_MAX_DESCRIPTION_LENGTH})`);
    description = d.length === 0 ? null : d;
  }

  const status = input.status === undefined ? "draft" : input.status;
  if (typeof status !== "string" || !(SEGMENT_STATUSES as readonly string[]).includes(status)) {
    bad("status must be draft, active or archived");
  }
  return { name, description, status: status as SegmentMetaInput["status"] };
}

/** Case/whitespace-insensitive live-name key, mirroring uq_vendor_segments_live_name. */
export function normalizeSegmentNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Resolve a relative day window against a SINGLE evaluation instant.
 *
 * Evaluation semantics (locked):
 *  - every window in one preview resolves against the SAME `evaluatedAt`, never a
 *    per-predicate now(), so the same rule + instant + data is reproducible;
 *  - `SEGMENT_TIMEZONE` (Asia/Kolkata) is the business zone the windows are
 *    reasoned about in; the returned boundary is an absolute UTC instant, and
 *    stored timestamptz values are absolute, so the comparison is unambiguous;
 *  - a predicate over a NULL value evaluates FALSE (it never matches and never
 *    throws). Only is_null matches NULL — "unknown" excludes.
 */
export function resolveWindowBoundary(evaluatedAt: Date, days: number): string {
  if (!(evaluatedAt instanceof Date) || Number.isNaN(evaluatedAt.getTime())) {
    bad("evaluatedAt must be a valid Date");
  }
  if (!Number.isInteger(days) || days < SEGMENT_MIN_WINDOW_DAYS || days > SEGMENT_MAX_WINDOW_DAYS) {
    bad(`days must be between ${SEGMENT_MIN_WINDOW_DAYS} and ${SEGMENT_MAX_WINDOW_DAYS}`);
  }
  return new Date(evaluatedAt.getTime() - days * 86400000).toISOString();
}

export { SEGMENT_TIMEZONE };
