// ============================================================================
// QF-MVP-30.3C — deterministic segment query PLANNER (PURE).
//
// Compiles a canonical segment AST into an execution plan:
//   1. a bounded list of CRM PRE-RESOLUTIONS (each becomes ONE batched query
//      returning a vendor-id set — never a per-vendor lookup), and
//   2. a single PostgREST logic expression over `vendors`.
//
// PURE: no DB, no `server-only`, no secret — so the planner is executed directly
// by the offline validator, exactly like the rule engine it consumes.
//
// LOCKED PROPERTIES
//  * every column name comes from the closed field registry — never from input;
//  * every literal is enum-bound, a uuid, an integer, or an ISO instant this
//    module generated; open-vocabulary tokens are charset-restricted upstream
//    (segmentRuleValidation) AND double-quoted here — two independent defences;
//  * the expression is structurally fixed: predicate count and shape derive from
//    the AST, which is itself bounded (<=3 groups, <=24 predicates);
//  * NULL never matches except via is_null — "unknown" excludes;
//  * membership is NEVER persisted; a plan is evaluated and discarded.
// ============================================================================

import {
  SEGMENT_FIELDS, type SegmentDefinition, type SegmentPredicate,
} from "./segmentRuleContracts";
import { resolveWindowBoundary } from "./segmentRuleValidation";

/** Hard cap on how many vendor ids a single CRM pre-resolution may contribute. */
export const SEGMENT_PRERESOLVE_MAX = 2000;
/** Hard cap on the preview page. */
export const SEGMENT_PREVIEW_MAX_PAGE_SIZE = 100;
export const SEGMENT_PREVIEW_DEFAULT_PAGE_SIZE = 25;

export class SegmentPlanError extends Error {
  readonly code = "SEGMENT_PLAN";
  constructor(message: string) {
    super(message);
    this.name = "SegmentPlanError";
  }
}

/** One batched CRM lookup. The service turns this into exactly one query. */
export interface SegmentPreResolution {
  /** Stable key so identical predicates are resolved once, not repeatedly. */
  readonly key: string;
  readonly relation: string;
  readonly column: string;
  /** How the rows are filtered before collecting their vendor_id. */
  readonly mode:
    | "eq" | "in" | "not_null" | "is_null"
    | "active_tag" | "open_task" | "overdue_task" | "active_primary_contact"
    | "lt" | "lte" | "gt" | "gte" | "between" | "before" | "after";
  readonly value?: string | number | boolean | readonly (string | number)[];
  /** When true the matching set is NEGATED (`id.not.in.(...)`). */
  readonly negate: boolean;
}

export interface SegmentPlan {
  readonly preResolutions: readonly SegmentPreResolution[];
  /** Builds the final PostgREST expression once id-sets are known. */
  readonly buildExpression: (resolved: ReadonlyMap<string, readonly string[]>) => string;
  readonly predicateCount: number;
}

const quote = (v: string) => `"${v}"`;

/** A PostgREST value literal. Enum/uuid/ISO values are always double-quoted. */
function literal(v: string | number | boolean): string {
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  // Upstream validation guarantees no " or \ can reach here; quoting makes the
  // expression structurally fixed even if that ever loosened.
  if (/["\\(),]/.test(v)) throw new SegmentPlanError("value contains reserved filter grammar");
  return quote(v);
}

/** Stable identity for a predicate, so duplicates resolve once. */
function preKey(p: SegmentPredicate): string {
  return `${p.field}|${p.op}|${JSON.stringify(p.value ?? null)}`;
}

/** Core predicate -> a PostgREST term on `vendors`. */
function coreTerm(p: SegmentPredicate, evaluatedAt: Date): string {
  const spec = SEGMENT_FIELDS[p.field];
  const col = spec.column;
  const v = p.value;
  switch (p.op) {
    case "eq": return `${col}.eq.${literal(v as string | number)}`;
    case "neq": return `${col}.neq.${literal(v as string | number)}`;
    case "in": return `${col}.in.(${(v as string[]).map(literal).join(",")})`;
    case "not_in": return `not.${col}.in.(${(v as string[]).map(literal).join(",")})`;
    case "lt": return `${col}.lt.${Number(v)}`;
    case "lte": return `${col}.lte.${Number(v)}`;
    case "gt": return `${col}.gt.${Number(v)}`;
    case "gte": return `${col}.gte.${Number(v)}`;
    case "between": {
      const [lo, hi] = v as number[];
      return `and(${col}.gte.${lo},${col}.lte.${hi})`;
    }
    case "is_null": return `${col}.is.null`;
    case "is_not_null": return `not.${col}.is.null`;
    case "is_true": return `${col}.is.true`;
    case "is_false": return `${col}.is.false`;
    case "array_contains_any": return `${col}.ov.{${(v as string[]).map(quote).join(",")}}`;
    case "array_contains_all": return `${col}.cs.{${(v as string[]).map(quote).join(",")}}`;
    case "within_last_days":
      return `${col}.gte.${literal(resolveWindowBoundary(evaluatedAt, Number(v)))}`;
    case "older_than_days":
      return `${col}.lt.${literal(resolveWindowBoundary(evaluatedAt, Number(v)))}`;
    default:
      throw new SegmentPlanError(`unsupported core operator ${p.op}`);
  }
}

/** CRM predicate -> a batched pre-resolution descriptor. */
function crmPreResolution(p: SegmentPredicate, evaluatedAt: Date): SegmentPreResolution {
  const spec = SEGMENT_FIELDS[p.field];
  const base = { key: preKey(p), relation: spec.relation, column: spec.column };
  const v = p.value;
  switch (p.op) {
    case "eq": return { ...base, mode: "eq", value: v as string, negate: false };
    case "neq": return { ...base, mode: "eq", value: v as string, negate: true };
    case "in": return { ...base, mode: "in", value: v as string[], negate: false };
    case "not_in": return { ...base, mode: "in", value: v as string[], negate: true };
    case "is_null": return { ...base, mode: "not_null", negate: true };
    case "is_not_null": return { ...base, mode: "not_null", negate: false };
    case "lt": return { ...base, mode: "lt", value: Number(v), negate: false };
    case "lte": return { ...base, mode: "lte", value: Number(v), negate: false };
    case "gt": return { ...base, mode: "gt", value: Number(v), negate: false };
    case "gte": return { ...base, mode: "gte", value: Number(v), negate: false };
    case "between": return { ...base, mode: "between", value: v as number[], negate: false };
    case "within_last_days":
      return { ...base, mode: "after", value: resolveWindowBoundary(evaluatedAt, Number(v)), negate: false };
    case "older_than_days":
      return { ...base, mode: "before", value: resolveWindowBoundary(evaluatedAt, Number(v)), negate: false };
    case "is_true":
    case "is_false": {
      // Explicit map, fail-closed. An earlier draft fell through to "active_tag",
      // which would have silently mis-resolved any boolean CRM field added later.
      const BOOLEAN_MODES: Record<string, SegmentPreResolution["mode"]> = {
        "crm.has_open_task": "open_task",
        "crm.has_overdue_task": "overdue_task",
        "crm.has_active_primary_contact": "active_primary_contact",
      };
      const mode = BOOLEAN_MODES[p.field];
      if (!mode) throw new SegmentPlanError(`no boolean resolution is defined for ${p.field}`);
      return { ...base, mode, negate: p.op === "is_false" };
    }
    default:
      throw new SegmentPlanError(`unsupported CRM operator ${p.op}`);
  }
}

/** `crm.tag_id` predicates always resolve through ACTIVE assignments. */
function isTagField(field: string): boolean {
  return field === "crm.tag_id";
}

/**
 * Compile a canonical definition into a plan.
 * `evaluatedAt` is captured ONCE by the caller and threaded through every
 * relative window, so one preview is internally consistent and reproducible.
 */
export function planSegmentQuery(definition: SegmentDefinition, evaluatedAt: Date): SegmentPlan {
  if (!(evaluatedAt instanceof Date) || Number.isNaN(evaluatedAt.getTime())) {
    throw new SegmentPlanError("evaluatedAt must be a valid Date");
  }

  const preByKey = new Map<string, SegmentPreResolution>();
  let predicateCount = 0;

  // First pass: collect every distinct CRM pre-resolution.
  for (const g of definition.groups) {
    for (const p of g.predicates) {
      predicateCount++;
      const spec = SEGMENT_FIELDS[p.field];
      if (!spec) throw new SegmentPlanError(`unknown field ${p.field}`);
      if (spec.source === "crm") {
        const pre = isTagField(p.field)
          ? { ...crmPreResolution(p, evaluatedAt), mode: "active_tag" as const }
          : crmPreResolution(p, evaluatedAt);
        if (!preByKey.has(pre.key)) preByKey.set(pre.key, pre);
      }
    }
  }
  const preResolutions = [...preByKey.values()];

  const buildExpression = (resolved: ReadonlyMap<string, readonly string[]>): string => {
    const groupTerms = definition.groups.map((g) => {
      const terms = g.predicates.map((p) => {
        const spec = SEGMENT_FIELDS[p.field];
        if (spec.source === "core") return coreTerm(p, evaluatedAt);

        const pre = preByKey.get(preKey(p));
        if (!pre) throw new SegmentPlanError("plan is missing a CRM pre-resolution");
        const ids = resolved.get(pre.key);
        if (!ids) throw new SegmentPlanError("CRM pre-resolution was not executed");
        if (ids.length > SEGMENT_PRERESOLVE_MAX) {
          throw new SegmentPlanError("segment matches too many vendors to evaluate safely");
        }
        // An empty positive set matches nobody; an empty negated set matches all.
        if (ids.length === 0) return pre.negate ? "id.not.is.null" : "id.is.null";
        const list = `(${ids.map(quote).join(",")})`;
        return pre.negate ? `not.id.in.${list}` : `id.in.${list}`;
      });
      const joiner = g.combinator === "AND" ? "and" : "or";
      return terms.length === 1 ? terms[0] : `${joiner}(${terms.join(",")})`;
    });

    return groupTerms.length === 1
      ? groupTerms[0]
      : `${definition.combinator === "AND" ? "and" : "or"}(${groupTerms.join(",")})`;
  };

  return { preResolutions, buildExpression, predicateCount };
}

/** Clamp a requested preview page into the locked bounds. */
export function boundPreviewPaging(page: unknown, pageSize: unknown): { page: number; pageSize: number } {
  const p = Number(page);
  const s = Number(pageSize);
  return {
    page: Number.isInteger(p) && p >= 1 ? p : 1,
    pageSize: Number.isInteger(s) && s >= 1
      ? Math.min(s, SEGMENT_PREVIEW_MAX_PAGE_SIZE)
      : SEGMENT_PREVIEW_DEFAULT_PAGE_SIZE,
  };
}
