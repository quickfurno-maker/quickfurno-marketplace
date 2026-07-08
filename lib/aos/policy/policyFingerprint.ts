import { createHash } from "node:crypto";

/**
 * QuickFurno Automation Policy Engine — deterministic config fingerprint
 * (Phase 4A).
 *
 * The fingerprint identifies WHICH configuration produced a decision. It is
 * built with a canonical projection of the semantic config fields (fixed key
 * order, order-insensitive + de-duplicated class array) so that:
 *
 *   - the SAME semantic config always yields the SAME fingerprint, and
 *   - a changed threshold, mode, or any other gate yields a DIFFERENT one.
 *
 * It never uses Math.random, Date.now, or a random UUID; a Node built-in SHA-256
 * hash provides a stable, collision-resistant identifier. The function is robust
 * to malformed input (it never throws) so it can also fingerprint an invalid
 * config that produced a fail-closed decision.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarToken(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `s:${value}`;
  if (typeof value === "number") return Number.isFinite(value) ? `n:${value}` : "n:NaN";
  if (typeof value === "boolean") return `b:${value}`;
  return `x:${String(value)}`;
}

function stringSetToken(value: unknown): string {
  if (!Array.isArray(value)) return scalarToken(value);
  const parts = value.map((entry) =>
    typeof entry === "string" ? entry : String(entry),
  );
  const canonical = Array.from(new Set(parts)).sort();
  return `[${canonical.join(",")}]`;
}

/**
 * Compute a deterministic SHA-256 fingerprint of a distribution authorization
 * config. Accepts `unknown` and canonicalizes defensively.
 */
export function computePolicyConfigFingerprint(config: unknown): string {
  const c = isRecord(config) ? config : {};
  const canonical = [
    `policyVersion=${scalarToken(c.policyVersion)}`,
    `mode=${scalarToken(c.mode)}`,
    `enabled=${scalarToken(c.enabled)}`,
    `minimumAutoAuthorizeScore=${scalarToken(c.minimumAutoAuthorizeScore)}`,
    `allowedAutoAuthorizeScoreClasses=${stringSetToken(c.allowedAutoAuthorizeScoreClasses)}`,
    `requireNoHardBlock=${scalarToken(c.requireNoHardBlock)}`,
    `requiredRecommendedAction=${scalarToken(c.requiredRecommendedAction)}`,
    `minimumRecommendationCount=${scalarToken(c.minimumRecommendationCount)}`,
    `maximumRecommendationCount=${scalarToken(c.maximumRecommendationCount)}`,
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}
