#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const policy = JSON.parse(read("ops/edge/policy/edge-policy.json"));
const tf = read("ops/edge/cloudflare/main.tf");
const versions = read("ops/edge/cloudflare/versions.tf");
const variables = read("ops/edge/cloudflare/variables.tf");
const compose = read("ops/container/compose.production.yml");
const limiter = read("lib/security/publicMutationRateLimit.ts");
const lead = read("services/leadService.ts");
const vendor = read("services/vendorService.ts");
const interest = read("lib/lead-assignment/freeVendorInterestService.ts");
const originCert = read("ops/edge/origin/certify-origin.sh");
const firewall = read("ops/edge/origin/ufw-phase10.sh");
const mtls = read("ops/edge/origin/nginx-mtls.conf.example");
const runbook = read("ops/edge/README.md");
const nextConfig = read("next.config.mjs");
const cspRoute = read("app/api/security/csp-report/route.ts");

function check(name, fn) {
  try {
    fn();
    console.log("PASS " + name);
  } catch (error) {
    console.error("FAIL " + name + ": " + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

check("provider-neutral policy keeps Cloudflare replaceable", () => {
  assert.equal(policy.posture.cloudflareIsReplaceable, true);
  assert.equal(policy.posture.originBusinessControlsRequired, true);
  assert.equal(policy.posture.durableAuthority, "PostgreSQL");
  assert.equal(policy.posture.ephemeralCoordination, "Redis/Valkey");
  assert.equal(policy.posture.cspActivation, "report-only-before-enforce");
  assert.equal(policy.posture.hstsActivation, "after-tls-proof");
});

check("high-risk endpoint classes have edge plus origin controls", () => {
  const ids = new Set(policy.routeClasses.map((r) => r.id));
  for (const id of ["vendor-auth", "admin-api", "payments", "whatsapp-webhook", "jarvis-internal", "public-server-actions"]) {
    assert.ok(ids.has(id), id + " missing");
  }
  for (const route of policy.routeClasses) {
    assert.ok(route.edge);
    assert.ok(Array.isArray(route.origin) && route.origin.length > 0);
  }
});

check("Cloudflare Terraform is pinned and staged fail-closed", () => {
  assert.match(versions, /version\s*=\s*"5\.26\.0"/);
  assert.match(variables, /enable_managed_waf[\s\S]*default\s*=\s*false/);
  assert.match(variables, /enable_edge_rules[\s\S]*default\s*=\s*false/);
  assert.match(runbook, /export\/import[\s\S]*reconcil|imported[\s\S]*reconcil/i);
});

check("Cloudflare rules cover WAF, endpoint limits and safe caching", () => {
  assert.match(tf, /phase\s*=\s*"http_request_firewall_managed"/);
  assert.match(tf, /efb7b8c949ac4650a09736fc376e9aee/);
  assert.match(tf, /phase\s*=\s*"http_request_firewall_custom"/);
  assert.match(tf, /phase\s*=\s*"http_ratelimit"/);
  assert.match(tf, /vendor_auth_per_ip/);
  assert.match(tf, /admin_api_per_ip/);
  assert.match(tf, /webhooks_per_ip/);
  assert.match(tf, /internal_api_per_ip/);
  assert.match(tf, /phase\s*=\s*"http_request_cache_settings"/);
  assert.match(tf, /cache_next_static/);
  assert.match(tf, /http\.request\.method eq \\"POST\\"/);
  assert.match(tf, /cache\s*=\s*false/);
});

check("CSP is telemetry-only before enforcement", () => {
  assert.match(nextConfig, /Content-Security-Policy-Report-Only/);
  assert.match(nextConfig, /report-uri \/api\/security\/csp-report/);
  assert.doesNotMatch(nextConfig, /key:\s*"Content-Security-Policy"\s*,/);
  assert.match(cspRoute, /MAX_REPORT_BYTES\s*=\s*16 \* 1024/);
  assert.match(cspRoute, /status:\s*413/);
  assert.match(tf, /csp_report_per_ip/);
});

check("application ports remain private", () => {
  assert.match(compose, /127\.0\.0\.1:\$\{QF_WEB_HOST_PORT:-3000\}:3000/);
  const published = [...compose.matchAll(/^\s*-\s*["']?([^\n"']+:[0-9]+)["']?\s*$/gm)].map((m) => m[1]);
  assert.ok(published.every((entry) => entry.startsWith("127.0.0.1:")), published.join(", "));
});

check("origin has shared Redis identity limits with a bounded local fallback", () => {
  assert.match(limiter, /createRedisCoordinationFromEnv/);
  assert.match(limiter, /shared\.rateLimit/);
  assert.match(limiter, /localFallback/);
  assert.match(limiter, /MAX_LOCAL_BUCKETS\s*=\s*4096/);
  assert.match(limiter, /pruneLocalBuckets/);
  assert.match(lead, /scope:\s*"lead-capture"/);
  assert.match(vendor, /scope:\s*"vendor-registration"/);
  assert.match(interest, /scope:\s*"free-vendor-interest"/);
});

check("origin gateway and firewall prevent direct application exposure", () => {
  assert.match(mtls, /ssl_verify_client on/);
  assert.match(mtls, /proxy_pass http:\/\/127\.0\.0\.1:3000/);
  assert.match(mtls, /client_max_body_size\s+10m/);
  assert.match(mtls, /proxy_connect_timeout\s+5s/);
  assert.match(mtls, /proxy_read_timeout\s+60s/);
  assert.match(firewall, /ufw default deny incoming/);
  assert.match(firewall, /ufw allow 443\/tcp/);
  assert.match(originCert, /unexpected public TCP listener/);
  assert.match(originCert, /direct origin request without client certificate/);
});

check("emergency bypass cannot bypass business security", () => {
  assert.match(runbook, /never a direct application\s+port/i);
  assert.match(runbook, /authentication\/authorization/);
  assert.match(runbook, /idempotency/);
});

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /cloudflare_api_token\s*=\s*"[^"]{10,}"/i,
  /SUPABASE_SERVICE_ROLE_KEY\s*=\s*[^$\s]/,
  /QF_COORDINATION_REDIS_URL\s*=\s*redis[^$\s]/,
];
for (const pattern of secretPatterns) {
  check("Phase 10 files contain no committed secret matching " + pattern, () => {
    const text = [tf, variables, versions, runbook, mtls, firewall, originCert].join("\n");
    assert.doesNotMatch(text, pattern);
  });
}

if (process.exitCode) process.exit(process.exitCode);
console.log("QuickFurno Phase 10 edge/origin contract PASS");
