import { adminClient } from "../lib/supabase";
import {
  parseQfjServiceAvailabilitySnapshot,
  type QfjServiceAvailabilitySnapshotV1,
} from "../lib/jarvis/serviceAvailabilityContract";

const MAX_NODES = 64;
const MAX_PAIRS = MAX_NODES * MAX_NODES;
function node(row: Record<string, unknown>): Readonly<{ref:string;displayName:string}> {
  return Object.freeze({
    ref: typeof row.id === "string" ? row.id : "",
    displayName: typeof row.name === "string" ? row.name.trim() : "",
  });
}

export async function readJarvisServiceAvailabilitySnapshot(): Promise<QfjServiceAvailabilitySnapshotV1> {
  const db = adminClient();
  const [metaResult, cityResult, serviceResult, pairResult] = await Promise.all([
    db.from("jarvis_service_availability_taxonomy").select("taxonomy_version").eq("singleton", true).maybeSingle(),
    db.from("cities").select("id, name").eq("is_active", true).order("id", { ascending:true }).limit(MAX_NODES + 1),
    db.from("service_categories").select("id, name").eq("is_active", true).order("id", { ascending:true }).limit(MAX_NODES + 1),
    db.from("jarvis_service_availability_pairs").select("city_id, service_category_id").eq("is_active", true).limit(MAX_PAIRS + 1),
  ]);
  for (const result of [metaResult, cityResult, serviceResult, pairResult]) if (result.error) throw result.error;
  if ((cityResult.data?.length ?? 0) > MAX_NODES || (serviceResult.data?.length ?? 0) > MAX_NODES || (pairResult.data?.length ?? 0) > MAX_PAIRS) {
    throw new Error("availability-bound-exceeded");
  }
  const taxonomyVersion = Number((metaResult.data as {taxonomy_version?:unknown}|null)?.taxonomy_version);
  if (!Number.isInteger(taxonomyVersion) || taxonomyVersion < 1 || taxonomyVersion > 1_000_000) throw new Error("availability-taxonomy-invalid");
  const cities = (cityResult.data ?? []).map((r) => node(r as Record<string,unknown>));
  const services = (serviceResult.data ?? []).map((r) => node(r as Record<string,unknown>));
  const citySet = new Set(cities.map((v) => v.ref));
  const serviceSet = new Set(services.map((v) => v.ref));
  const byService = new Map<string,string[]>();
  for (const service of services) byService.set(service.ref, []);
  for (const raw of pairResult.data ?? []) {
    const row = raw as Record<string,unknown>;
    const city = typeof row.city_id === "string" ? row.city_id : "";
    const service = typeof row.service_category_id === "string" ? row.service_category_id : "";
    if (!citySet.has(city) || !serviceSet.has(service)) continue;
    byService.get(service)?.push(city);
  }
  const availability = services.map((service) => ({ serviceRef:service.ref, cityRefs:[...(byService.get(service.ref) ?? [])].sort() }));
  const snapshot = parseQfjServiceAvailabilitySnapshot({ version:1, snapshotRef:`qf-sa-v${taxonomyVersion}`, taxonomyVersion, cities, services, availability });
  if (!snapshot) throw new Error("availability-snapshot-invalid");
  return snapshot;
}
