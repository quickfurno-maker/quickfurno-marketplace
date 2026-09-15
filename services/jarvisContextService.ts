import type { JarvisContextDataSource, JarvisContextResult } from "../lib/jarvis/contextRead";
import { readJarvisSanitizedContextFromSource } from "../lib/jarvis/contextRead";
import type { QfjContextReadRequestV1 } from "../lib/jarvis/contextContract";
import type { QfJarvisRuntimePolicy } from "../lib/jarvis/runtimePolicy";

async function productionDb() { const { adminClient } = await import("../lib/supabase"); return adminClient(); }
const productionSource: JarvisContextDataSource = Object.freeze({
  async readLead(id: string) { const db=await productionDb(); const {data,error}=await db.from("leads").select("id, city, service_required, budget, property_type, timeline, status, verification_status, is_duplicate").eq("id",id).maybeSingle(); if(error) throw error; return (data as Record<string,unknown>|null) ?? null; },
  async readVendor(id: string) { const db=await productionDb(); const {data,error}=await db.from("vendors").select("id, city, service_categories, status, remaining_credits, is_active, public_visibility, paid_status, package_status").eq("id",id).maybeSingle(); if(error) throw error; return (data as Record<string,unknown>|null) ?? null; },
});
export async function readJarvisSanitizedContext(args:{ readonly request:QfjContextReadRequestV1; readonly policy:QfJarvisRuntimePolicy }):Promise<JarvisContextResult> { return readJarvisSanitizedContextFromSource({ ...args, source:productionSource }); }