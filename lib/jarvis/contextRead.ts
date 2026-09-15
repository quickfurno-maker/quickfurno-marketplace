import type { QfjContextActor, QfjContextReadRequestV1, QfjSanitizedContext } from "./contextContract";
import type { QfJarvisRuntimePolicy } from "./runtimePolicy";

export interface JarvisContextDataSource {
  readLead(id: string): Promise<Record<string, unknown> | null>;
  readVendor(id: string): Promise<Record<string, unknown> | null>;
}
export type JarvisContextResult = { readonly ok: true; readonly context: QfjSanitizedContext } | { readonly ok: false; readonly reason: "disabled" | "not_found" | "scope_refused" | "unavailable" };
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : null; }
function bool(value: unknown): boolean { return value === true; }
function categories(value: unknown): readonly string[] { return Object.freeze((Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 16)); }
function actorEnabled(policy: QfJarvisRuntimePolicy, actor: QfjContextActor): boolean { if (actor === "RIYA") return policy.riyaEnabled; if (actor === "ANISHA") return policy.anishaEnabled; return true; }
function packageBand(row: Record<string, unknown>): "UNKNOWN" | "NOT_ACTIVE" | "NO_PACKAGE" | "LOW_CREDITS" | "READY" {
  if (!bool(row.is_active) || (text(row.status)?.toLowerCase() ?? "") !== "approved") return "NOT_ACTIVE";
  const status = text(row.package_status)?.toLowerCase(); if (!status) return "UNKNOWN";
  if (status !== "active" && status !== "trial") return "NO_PACKAGE";
  const credits = Number(row.remaining_credits); if (!Number.isFinite(credits)) return "UNKNOWN";
  return credits <= 3 ? "LOW_CREDITS" : "READY";
}
export async function readJarvisSanitizedContextFromSource(args: { readonly request: QfjContextReadRequestV1; readonly policy: QfJarvisRuntimePolicy; readonly source: JarvisContextDataSource }): Promise<JarvisContextResult> {
  const { request, policy, source } = args;
  if (policy.mode === "off" || !policy.contextReadEnabled || !actorEnabled(policy, request.actor)) return { ok:false, reason:"disabled" };
  if ((request.actor === "RIYA" && request.entityType !== "lead") || (request.actor === "ANISHA" && request.entityType !== "vendor")) return { ok:false, reason:"scope_refused" };
  try {
    if (request.entityType === "lead") {
      const row = await source.readLead(request.entityId); if (!row) return { ok:false, reason:"not_found" };
      return { ok:true, context:Object.freeze({ kind:"client_lead", leadId:request.entityId, city:text(row.city), serviceRequired:text(row.service_required), budgetBand:text(row.budget), propertyType:text(row.property_type), timeline:text(row.timeline), leadStatus:text(row.status), verificationStatus:text(row.verification_status), isDuplicate:bool(row.is_duplicate) }) };
    }
    const row = await source.readVendor(request.entityId); if (!row) return { ok:false, reason:"not_found" };
    return { ok:true, context:Object.freeze({ kind:"vendor_profile", vendorId:request.entityId, city:text(row.city), serviceCategories:categories(row.service_categories), vendorStatus:text(row.status), isActive:bool(row.is_active), publicVisibility:bool(row.public_visibility), paidStatus:text(row.paid_status), packageReadinessBand:packageBand(row) }) };
  } catch { return { ok:false, reason:"unavailable" }; }
}