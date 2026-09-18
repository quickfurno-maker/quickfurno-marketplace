import fs from "node:fs";
import {
  parseQfjServiceAvailabilityRequest,
  parseQfjServiceAvailabilitySnapshot,
  QFJ_SERVICE_AVAILABILITY_PATH,
  QFJ_SERVICE_AVAILABILITY_SIGNING_DOMAIN,
} from "../../../lib/jarvis/serviceAvailabilityContract.ts";
import { resolveQfJarvisRuntimePolicy } from "../../../lib/jarvis/runtimePolicy.ts";

let passed=0;
const check=(label,ok)=>{ if(!ok) throw new Error(`FAIL ${label}`); passed++; console.log(`PASS ${String(passed).padStart(2,"0")} ${label}`); };
const now="2026-09-15T12:00:00.000Z";
const req={protocol:"qfj.core.service-availability.read",version:1,caller:"qf-jarvis",audience:"quickfurno-core",requestId:"sa.req.1",issuedAt:now,tenantId:"quickfurno"};
check("canonical request parses", !!parseQfjServiceAvailabilityRequest(req));
check("path is private internal route", QFJ_SERVICE_AVAILABILITY_PATH === "/api/internal/jarvis/service-availability");
check("signing domain is versioned and distinct", QFJ_SERVICE_AVAILABILITY_SIGNING_DOMAIN === "qfj.core.service-availability.http.sig.v1");
check("unknown request key refused", !parseQfjServiceAvailabilityRequest({...req,admin:true}));
check("wrong caller refused", !parseQfjServiceAvailabilityRequest({...req,caller:"browser"}));
check("wrong audience refused", !parseQfjServiceAvailabilityRequest({...req,audience:"jarvis"}));
check("invalid tenant refused", !parseQfjServiceAvailabilityRequest({...req,tenantId:"bad tenant"}));
const snapshot={version:1,snapshotRef:"qf-sa-v7",taxonomyVersion:7,cities:[{ref:"11111111-1111-4111-8111-111111111111",displayName:"Pune"}],services:[{ref:"22222222-2222-4222-8222-222222222222",displayName:"Interior Design"}],availability:[{serviceRef:"22222222-2222-4222-8222-222222222222",cityRefs:["11111111-1111-4111-8111-111111111111"]}]};
check("canonical JARVIS-compatible snapshot parses", !!parseQfjServiceAvailabilitySnapshot(snapshot));
check("taxonomy version above JARVIS bound refused", !parseQfjServiceAvailabilitySnapshot({...snapshot,taxonomyVersion:1_000_001}));
check("label above 64 chars refused", !parseQfjServiceAvailabilitySnapshot({...snapshot,cities:[{...snapshot.cities[0],displayName:"A".repeat(65)}]}));
check("phone-shaped label refused", !parseQfjServiceAvailabilitySnapshot({...snapshot,cities:[{...snapshot.cities[0],displayName:"Pune 9876543210"}]}));
check("unknown city pair refused", !parseQfjServiceAvailabilitySnapshot({...snapshot,availability:[{...snapshot.availability[0],cityRefs:["city.unknown"]}]}));
check("missing service row refused", !parseQfjServiceAvailabilitySnapshot({...snapshot,availability:[]}));
const tooMany=Array.from({length:65},(_,i)=>({ref:`city.${i}`,displayName:`City ${i}`}));
check("more than 64 cities refused", !parseQfjServiceAvailabilitySnapshot({...snapshot,cities:tooMany}));
const off=resolveQfJarvisRuntimePolicy({});
check("availability defaults off", off.mode === "off" && off.serviceAvailabilityEnabled === false);
const shadow=resolveQfJarvisRuntimePolicy({QF_JARVIS_MODE:"shadow",QF_JARVIS_SERVICE_AVAILABILITY_ENABLED:"true"});
check("shadow can enable read without active authority", shadow.mode === "shadow" && shadow.serviceAvailabilityEnabled === true && shadow.actionProposalEnabled === false);
const migration=fs.readFileSync("supabase/migrations/20260915120000_qf_jarvis_service_availability.sql","utf8");
check("migration creates explicit pair registry", /jarvis_service_availability_pairs/.test(migration));
check("pair registry references Core city", /city_id uuid not null references public\.cities\(id\)/.test(migration));
check("pair registry references Core service", /service_category_id uuid not null references public\.service_categories\(id\)/.test(migration));
check("migration seeds no inferred pairs", !/insert into public\.jarvis_service_availability_pairs/i.test(migration));
check("taxonomy version is JARVIS bounded", /taxonomy_version between 1 and 1000000/.test(migration));
check("catalogue and pair mutations bump taxonomy", /trg_jarvis_availability_cities/.test(migration) && /trg_jarvis_availability_services/.test(migration) && /trg_jarvis_availability_pairs/.test(migration));
check("public roles revoked", /revoke all on public\.jarvis_service_availability_pairs from anon, authenticated/.test(migration));
const svc=fs.readFileSync("services/jarvisServiceAvailabilityService.ts","utf8");
check("service reads active Core cities", /from\("cities"\).*eq\("is_active", true\)/s.test(svc));
check("service reads active Core services", /from\("service_categories"\).*eq\("is_active", true\)/s.test(svc));
check("service reads only explicit active pairs", /from\("jarvis_service_availability_pairs"\).*eq\("is_active", true\)/s.test(svc));
check("service detects node and pair overflow instead of truncating truth", /MAX_NODES \+ 1/.test(svc) && /MAX_PAIRS \+ 1/.test(svc) && /availability-bound-exceeded/.test(svc));
check("service proves snapshot through boundary parser", /parseQfjServiceAvailabilitySnapshot/.test(svc));
check("service emits row for every service", /services\.map/.test(svc) && /cityRefs/.test(svc));
check("service has no vendor inference", !/from\("vendors"\)/.test(svc));
check("service has no lead or contact data", !/leads|phone|email|price|package/i.test(svc));
const route=fs.readFileSync("app/api/internal/jarvis/service-availability/route.ts","utf8");
check("route uses signed-request verifier", /verifyQfjSignedRequestSignature/.test(route));
check("route checks configured tenant", /QF_JARVIS_TENANT_ID/.test(route));
check("route requires integration not off", /policy\.mode === "off"/.test(route));
check("route caps request body", /4096/.test(route));
check("route returns no-store", /cache-control/.test(route) && /no-store/.test(route));
check("route contains no DB write verb", !/insert\(|update\(|delete\(|upsert\(|rpc\(/.test(route));
check("route has no provider or retired executor path", !/groq|nara|n8n|whatsapp/i.test(route));
console.log(`QF-MVP-60-AVAILABILITY: ${passed}/${passed} PASS`);
