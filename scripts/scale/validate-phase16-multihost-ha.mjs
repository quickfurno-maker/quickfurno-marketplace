#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const read = (p) => readFile(new URL(p, root), "utf8");

const [topologyText, compose, haproxy, replicaStarter, tofu, cloudInit, docs] = await Promise.all([
  read("contracts/qfj-phase16-topology-v1.json"),
  read("ops/container/compose.production.yml"),
  read("ops/phase16/haproxy-certification.cfg"),
  read("ops/phase16/start-certification-replicas.sh"),
  read("ops/phase16/tofu/main.tf"),
  read("ops/phase16/tofu/cloud-init.tftpl"),
  read("docs/operations/phase16-multihost-ha.md"),
]);

const topology = JSON.parse(topologyText);
const checks = [];
const add = (name, ok) => checks.push([name, Boolean(ok)]);

add("canonical Phase16 topology contract version", topology.contract === "qfj.topology.phase16.v1");
add("QuickFurno is physically isolated on a dedicated VPS now",
  topology.currentPhysicalPlacement.quickfurno.placement === "DEDICATED_VPS");
add("Jarvis and AGNI are colocated initially on the larger VPS",
  topology.currentPhysicalPlacement.jarvisAgni.placement === "SHARED_LARGER_VPS");
add("AGNI unrestricted Docker socket is forbidden",
  topology.logicalIsolation.agniUnrestrictedDockerSocketForbidden === true);
add("PostgreSQL/Supabase remains business truth",
  topology.authority.businessTruth === "POSTGRESQL_SUPABASE");
add("Redis/Valkey remains coordination-only",
  topology.authority.redisValkey === "COORDINATION_ONLY");
add("host-local business state is forbidden",
  topology.authority.hostLocalBusinessStateForbidden === true);
add("QuickFurno HA target requires at least two hosts",
  topology.quickfurnoHaTarget.minimumHosts >= 2);
add("production target requires an external redundant load balancer",
  topology.quickfurnoHaTarget.externalRedundantLoadBalancer === true);
add("health removal uses /readyz and liveness stays /livez",
  topology.quickfurnoHaTarget.healthRemovalEndpoint === "/readyz" &&
  topology.quickfurnoHaTarget.livenessEndpoint === "/livez");
add("session affinity is not required",
  topology.quickfurnoHaTarget.sessionAffinityRequired === false);
add("critical replicas require host anti-affinity",
  topology.quickfurnoHaTarget.criticalReplicaAntiAffinityByHost === true);
add("multi-host mode requires shared Redis/Valkey",
  topology.quickfurnoHaTarget.sharedRedisValkeyRequired === true &&
  topology.quickfurnoHaTarget.loopbackRedisForbiddenInMultiHost === true);
add("workers use PostgreSQL lease fencing across hosts",
  topology.workerSafety.durableClaims === "POSTGRESQL_LEASE_FENCE" &&
  topology.workerSafety.expiredClaimsReclaimable === true &&
  topology.workerSafety.staleOwnerEffectsRejected === true);
add("Redis wakeups are non-authoritative",
  topology.workerSafety.redisWakeupsAuthoritative === false);
add("AGNI stays portable and non-critical to QuickFurno correctness",
  topology.agni.portableToDedicatedHost === true &&
  topology.agni.mustNotBeCorrectnessDependencyForQuickfurno === true);
add("Phase16 explicitly forbids production traffic cutover",
  topology.phase16Safety.productionTrafficCutover === false &&
  topology.phase16Safety.newProductionAuthority === false &&
  topology.phase16Safety.productionDatabaseMigration === false);

add("production compose remains exact-image-ref driven",
  compose.includes("QF_IMAGE_REF") &&
  !compose.includes("image: quickfurno:latest"));
add("HAProxy certification config health-checks /readyz",
  haproxy.includes("option httpchk GET /readyz") &&
  haproxy.includes("qf_host_a") &&
  haproxy.includes("qf_host_b") &&
  haproxy.includes("option redispatch"));
add("certification replicas satisfy the fail-closed production entrypoint",
  replicaStarter.includes("QF_RUNTIME_ENV=production") &&
  replicaStarter.includes("QF_CONFIG_SCHEMA_VERSION=1") &&
  replicaStarter.includes("QF_SERVICE_ID=quickfurno.web") &&
  replicaStarter.includes("HOSTNAME=0.0.0.0") &&
  replicaStarter.includes("phase16-runtime.invalid"));
add("OpenTofu host inventory enforces two hosts",
  tofu.includes("length(var.quickfurno_hosts) >= 2"));
add("OpenTofu rejects loopback shared Redis",
  tofu.includes("127\\\\.0\\\\.0\\\\.1") &&
  tofu.includes("Multi-host QuickFurno cannot use host-local Redis/Valkey."));
add("provider-neutral cloud-init carries replaceable host identity",
  cloudInit.includes("QF_HOST_ID=") &&
  cloudInit.includes("AGNI_OTLP_GATEWAY_ENDPOINT="));
add("runbook records no immediate second VPS or production cutover",
  docs.includes("No production traffic cutover") &&
  docs.includes("does not require buying a second QuickFurno VPS immediately"));

for (const [name, ok] of checks) console.log((ok ? "PASS" : "FAIL") + " " + name);
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("QuickFurno Phase16 contract failed: " + failed.length + " check(s)");
  process.exit(1);
}
console.log("QuickFurno Phase16 contract PASS (" + checks.length + "/" + checks.length + ")");
