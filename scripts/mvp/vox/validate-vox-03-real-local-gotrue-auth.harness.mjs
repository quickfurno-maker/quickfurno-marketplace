// ============================================================================
// VOX P0-3 — REAL local/disposable Supabase GoTrue-backed Owner Auth harness.
//
// Unlike validate-vox-02c-owner-auth200.harness.mjs (fixture Supabase client,
// hand-crafted unsigned JWTs), this harness replaces NO part of the Supabase
// network boundary. It boots a disposable, loopback-only, synthetic-secret
// GoTrue + PostgREST + PostgreSQL stack (modeled on the proven-in-CI
// scripts/mvp/automation/certify-vl01-real-auth-http.mjs pattern) and then
// runs the REAL app/api/vox/v1/overview/route.ts GET handler and the REAL
// services/vox/verifiedStaffBearer.ts / lib/supabase.ts in-process, via the
// test-only fixtures/vox-real-source.loader.mjs loader (no mocked
// @supabase/* packages — genuine HTTP calls to the local stack).
//
// What is proven genuine here (NOT simulated):
//   - a real GoTrue signup, issuing a real signed (HS256) access_token
//   - the REAL lib/supabase.ts verifySupabaseBearerUser() calling the REAL
//     @supabase/supabase-js auth.getUser(token), which makes a real HTTP
//     call to local GoTrue's /user endpoint and verifies the signature
//   - a REAL local GoTrue TOTP MFA enrollment + challenge + verify cycle
//     (RFC 6238 code computed in fixtures/totp.mjs from the secret GoTrue
//     itself issued), producing a genuinely-aal2 session from GoTrue itself
//     — this script never promotes or hand-signs an aal2 claim
//   - a real admin user deletion, then a real denial on the now-orphaned
//     token (no fabricated "revoked" state)
//   - a real short-lived second local GoTrue instance (GOTRUE_JWT_EXP=2s)
//     used ONLY to mint a genuinely-expiring token, then a real wall-clock
//     wait past expiry before verifying denial
//
// What this harness explicitly does NOT and CANNOT prove (see docs/vox/
// VOX-P0-3-AUTH-QA-20261029.md): live Supabase Staging/Production AAL2,
// a real human Owner's enrolled authenticator app, or anything about the
// live VPS / PR #422 deploy path. Local-GoTrue MFA success here is evidence
// about this route's auth code path only, never a Staging/Production claim.
//
// Safety:
//   - hard-fails immediately if any managed SUPABASE_URL / DATABASE_URL /
//     SUPABASE_SERVICE_ROLE_KEY (or a NEXT_PUBLIC_SUPABASE_URL pointing at a
//     *.supabase.co/*.supabase.in host) is already present in the environment
//   - every container is bound to 127.0.0.1 only, on a private docker network
//   - all secrets (JWT secret, DB password) are freshly generated per run
//   - every container started is torn down in `finally`, even on failure
//   - pinned, official images only; no image is built, pushed, or published
//
// Executable with (operator-run only — see docs/vox/VOX-P0-3-AUTH-QA-20261029.md):
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/mvp/vox/validate-vox-03-real-local-gotrue-auth.harness.mjs
// Requires: a local Docker daemon, pinned images pulled or pullable, no
// ambient managed Supabase/DB secrets in the shell environment.
// ============================================================================
import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { register } from "node:module";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { Client } = require("pg");
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = require("ws");
const { generateTotp } = await import("./fixtures/totp.mjs");

// ---- Source-safety: never touch a managed project -------------------------
class Blocked extends Error {}
for (const name of ["SUPABASE_URL", "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (process.env[name]) throw new Error("REFUSING_TO_RUN: managed env var " + name + " is present in this shell.");
}
if (process.env.NEXT_PUBLIC_SUPABASE_URL && /supabase\.(co|in)/i.test(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
  throw new Error("REFUSING_TO_RUN: NEXT_PUBLIC_SUPABASE_URL already points at a managed *.supabase.co/in host.");
}

// Pinned, official images only (same pins already proven-in-CI by VL-01).
const GOTRUE_IMAGE = "supabase/gotrue:v2.196.0";
const POSTGRES_IMAGE = "postgres:16-alpine";
const POSTGREST_IMAGE =
  "ghcr.io/supabase/postgrest:v16.1@sha256:5922bde07147b82b1c9d8f749e48c1e5b99ebb233f3888bb7ab65f07cf4ac82d";

const suffix = String(process.pid);
const net = "vox03-gotrue-net-" + suffix;
const pgname = "vox03-gotrue-pg-" + suffix;
const gtname = "vox03-gotrue-auth-" + suffix;
const restname = "vox03-gotrue-rest-" + suffix;
const DB_USER = "vox03",
  DB_NAME = "vox03";
const pass = randomBytes(22).toString("hex");
const jwtSecret = randomBytes(32).toString("hex");

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const jwt = (claims, secret = jwtSecret) => {
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url(claims);
  const sig = createHmac("sha256", secret).update(head + "." + payload).digest("base64url");
  return head + "." + payload + "." + sig;
};
async function ready(url) {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await delay(350);
  }
  throw new Error("SERVICE_NOT_READY:" + url);
}
function hostPort(containerName, containerPort) {
  return Number(docker("port", containerName, containerPort).match(/127\.0\.0\.1:(\d+)/)?.[1]);
}

let pg = null,
  proxy = null,
  networkCreated = false;
const containers = [];
let passed = 0,
  blockedCount = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("PASS " + name);
}
async function optional(name, fn) {
  try {
    await fn();
    passed++;
    console.log("PASS " + name);
  } catch (e) {
    if (e instanceof Blocked) {
      blockedCount++;
      console.log("BLOCKED " + name + " :: " + e.message);
    } else {
      throw e;
    }
  }
}

try {
  const now = Math.floor(Date.now() / 1000);
  const adminJwt = jwt({ role: "service_role", aud: "authenticated", iss: "supabase", iat: now, exp: now + 3600 });
  const anonJwt = jwt({ role: "anon", aud: "authenticated", iss: "supabase", iat: now, exp: now + 3600 });

  docker("network", "create", net);
  networkCreated = true;

  docker(
    "run", "-d", "--name", pgname, "--network", net,
    "-e", "POSTGRES_USER=" + DB_USER, "-e", "POSTGRES_PASSWORD=" + pass, "-e", "POSTGRES_DB=" + DB_NAME,
    "-p", "127.0.0.1::5432", POSTGRES_IMAGE,
  );
  containers.push(pgname);
  let pgPort;
  for (let i = 0; i < 40; i++) {
    try {
      pgPort = hostPort(pgname, "5432/tcp");
      if (!pgPort) throw new Error("no port yet");
      pg = new Client({ host: "127.0.0.1", port: pgPort, user: DB_USER, password: pass, database: DB_NAME, connectionTimeoutMillis: 800 });
      await pg.connect();
      break;
    } catch {
      try { await pg?.end(); } catch {}
      pg = null;
      await delay(350);
    }
  }
  if (!pg) throw new Error("PG_NOT_READY");

  await pg.query(`
    CREATE SCHEMA auth;
    CREATE ROLE postgres SUPERUSER LOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE authenticator LOGIN PASSWORD '${pass}' NOINHERIT;
    GRANT anon,authenticated,service_role TO authenticator;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;

    CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text, is_active boolean);
    CREATE TABLE public.aarohi_prospects(
      id uuid PRIMARY KEY, business_name text, prospect_stage text, priority_band text,
      last_activity_at timestamptz, city_id uuid, created_at timestamptz, updated_at timestamptz);
    CREATE TABLE public.vendor_crm_profiles(
      vendor_id uuid PRIMARY KEY, onboarding_stage text, relationship_status text,
      next_follow_up_at timestamptz, updated_at timestamptz, created_at timestamptz);
    CREATE TABLE public.vendor_support_threads(
      id uuid PRIMARY KEY, vendor_id uuid, subject text, status text, priority text,
      created_by_vendor boolean, created_at timestamptz, updated_at timestamptz);
    CREATE TABLE public.communication_conversations(
      id uuid PRIMARY KEY, subject_type text, subject_id uuid, state text,
      human_takeover boolean, revision int, channel text, updated_at timestamptz, created_at timestamptz);

    GRANT SELECT ON public.profiles, public.aarohi_prospects, public.vendor_crm_profiles,
      public.vendor_support_threads, public.communication_conversations TO service_role;
    ALTER ROLE ${DB_USER} SET search_path TO auth,public;

    INSERT INTO public.aarohi_prospects VALUES
      ('11111111-1111-4111-8111-111111111111','Synthetic Fabrics Co','prospecting','high','2026-10-20T10:00:00Z',NULL,now(),now());
    INSERT INTO public.vendor_crm_profiles VALUES
      ('22222222-2222-4222-8222-222222222222','onboarding','active','2026-11-01T10:00:00Z',now(),now());
    INSERT INTO public.vendor_support_threads VALUES
      ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','synthetic ticket','open','normal',true,now(),now());
    INSERT INTO public.communication_conversations VALUES
      ('44444444-4444-4444-8444-444444444444','vendor','22222222-2222-4222-8222-222222222222','HUMAN',true,1,'whatsapp',now(),now());
  `);

  docker(
    "run", "-d", "--name", gtname, "--network", net, "-p", "127.0.0.1::9999",
    "-e", "GOTRUE_DB_DRIVER=postgres",
    "-e", "GOTRUE_DB_DATABASE_URL=postgres://" + DB_USER + ":" + pass + "@" + pgname + ":5432/" + DB_NAME + "?sslmode=disable",
    "-e", "GOTRUE_DB_NAMESPACE=auth", "-e", "GOTRUE_API_HOST=0.0.0.0", "-e", "GOTRUE_API_PORT=9999",
    "-e", "GOTRUE_SITE_URL=http://localhost", "-e", "API_EXTERNAL_URL=http://localhost:9999", "-e", "GOTRUE_API_EXTERNAL_URL=http://localhost:9999",
    "-e", "GOTRUE_JWT_SECRET=" + jwtSecret, "-e", "GOTRUE_JWT_AUD=authenticated", "-e", "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
    "-e", "GOTRUE_JWT_EXP=3600",
    "-e", "GOTRUE_EXTERNAL_EMAIL_ENABLED=true", "-e", "GOTRUE_MAILER_AUTOCONFIRM=true", "-e", "GOTRUE_DISABLE_SIGNUP=false",
    "-e", "GOTRUE_MFA_ENABLED=true",
    GOTRUE_IMAGE,
  );
  containers.push(gtname);
  const authPort = hostPort(gtname, "9999/tcp");
  await ready("http://127.0.0.1:" + authPort + "/health");

  docker(
    "run", "-d", "--name", restname, "--network", net, "-p", "127.0.0.1::3000",
    "-e", "PGRST_DB_URI=postgres://authenticator:" + pass + "@" + pgname + ":5432/" + DB_NAME,
    "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_DB_ANON_ROLE=anon", "-e", "PGRST_JWT_SECRET=" + jwtSecret,
    "-e", "PGRST_SERVER_PORT=3000", POSTGREST_IMAGE,
  );
  containers.push(restname);
  const restPort = hostPort(restname, "3000/tcp");
  await ready("http://127.0.0.1:" + restPort + "/");

  // Minimal loopback-only reverse proxy: /auth/v1/* -> GoTrue, /rest/v1/* -> PostgREST.
  // Identical approach to the proven scripts/mvp/automation/certify-vl01-real-auth-http.mjs.
  const server = createServer((request, response) => {
    const dest =
      request.url.startsWith("/auth/v1/") ? "http://127.0.0.1:" + authPort + request.url.slice("/auth/v1".length) :
      request.url.startsWith("/rest/v1/") ? "http://127.0.0.1:" + restPort + request.url.slice("/rest/v1".length) :
      null;
    if (!dest) { response.writeHead(404); response.end(); return; }
    const headers = { ...request.headers };
    delete headers.host;
    const chunks = [];
    request.on("data", (x) => chunks.push(x));
    request.on("end", async () => {
      try {
        const upstream = await fetch(dest, {
          method: request.method, headers,
          body: ["GET", "HEAD"].includes(request.method) ? undefined : Buffer.concat(chunks),
          redirect: "manual",
        });
        const out = {};
        for (const [k, v] of upstream.headers) if (!["transfer-encoding", "connection", "content-encoding"].includes(k)) out[k] = v;
        response.writeHead(upstream.status, out);
        response.end(Buffer.from(await upstream.arrayBuffer()));
      } catch {
        response.writeHead(502);
        response.end();
      }
    });
  });
  proxy = server;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const gateway = "http://127.0.0.1:" + server.address().port;
  console.log("VOX_P0_3_GOTRUE_POSTGREST_PG_READY");

  process.env.NEXT_PUBLIC_SUPABASE_URL = gateway;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonJwt;
  process.env.SUPABASE_SERVICE_ROLE_KEY = adminJwt;

  register("./fixtures/vox-real-source.loader.mjs", import.meta.url);
  const route = await import("@/app/api/vox/v1/overview/route.ts");

  const url = "https://core.local/api/vox/v1/overview";
  const req = (headers) => new Request(url, { headers });
  const authHeaders = (token) => ({ "content-type": "application/json", authorization: "Bearer " + token, apikey: anonJwt });

  // ---- Mandatory negatives: anonymous / malformed -------------------------
  await test("real route: anonymous (no Authorization) returns 401", async () => {
    const res = await route.GET(req({}));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "UNAUTHORIZED");
  });

  await test("real route: shape-invalid bearer returns 401 (no network call made)", async () => {
    const res = await route.GET(req({ authorization: "Bearer invalid.invalid.invalid" }));
    assert.equal(res.status, 401);
  });

  await test("real route: correctly-shaped but wrong-signature token rejected by REAL local GoTrue", async () => {
    const forged = jwt({ sub: "99999999-9999-4999-8999-999999999999", aal: "aal2", aud: "authenticated", iss: "supabase", iat: now - 1, exp: now + 3600, is_anonymous: false }, randomBytes(32).toString("hex"));
    const res = await route.GET(req({ authorization: "Bearer " + forged }));
    assert.equal(res.status, 401, "a token signed with the wrong secret must be denied by real GoTrue signature verification");
  });

  // ---- Real GoTrue signup + Owner profile wiring --------------------------
  const email = "vox03-owner-" + suffix + "@example.invalid";
  const password = "A-" + randomBytes(18).toString("hex");
  const signupRes = await fetch(gateway + "/auth/v1/signup", { method: "POST", headers: { "content-type": "application/json", apikey: anonJwt }, body: JSON.stringify({ email, password }) });
  const signup = await signupRes.json();
  assert.equal(signupRes.status, 200, "real GoTrue signup must succeed");
  assert.ok(signup.user?.id && signup.access_token, "real GoTrue signup must return a real signed access_token");
  const ownerId = signup.user.id;
  const aal1Token = signup.access_token;

  await pg.query("INSERT INTO public.profiles (id,role,is_active) VALUES ($1,'admin',true)", [ownerId]);
  const metaRes = await fetch(gateway + "/auth/v1/admin/users/" + ownerId, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: "Bearer " + adminJwt, apikey: adminJwt },
    body: JSON.stringify({ app_metadata: { admin_role: "Superadmin" } }),
  });
  assert.ok(metaRes.ok, "real GoTrue admin app_metadata update must succeed");

  await test("real route: genuine GoTrue signup token at AAL1 (Owner profile correct, MFA not completed) still returns 401", async () => {
    const res = await route.GET(req({ authorization: "Bearer " + aal1Token }));
    assert.equal(res.status, 401, "AAL1 must be denied even with a correct Owner profile and Superadmin app_metadata");
  });

  // ---- Optional: real local GoTrue TOTP MFA -> genuine AAL2 positive -----
  let bestOwnerToken = aal1Token;
  await optional("real route: genuine local-GoTrue TOTP MFA enroll+challenge+verify yields AAL2, returns 200 qf.vox.overview.v1", async () => {
    const enrollRes = await fetch(gateway + "/auth/v1/factors", { method: "POST", headers: authHeaders(aal1Token), body: JSON.stringify({ friendly_name: "owner-totp-" + suffix, factor_type: "totp" }) });
    if (!enrollRes.ok) throw new Blocked("local GoTrue factor-enroll endpoint unavailable: HTTP " + enrollRes.status);
    const enroll = await enrollRes.json().catch(() => ({}));
    const factorId = enroll?.id;
    const secret = enroll?.totp?.secret;
    if (!factorId || !secret) throw new Blocked("factor-enroll response missing id/totp.secret: " + JSON.stringify(enroll).slice(0, 300));

    const challengeRes = await fetch(gateway + "/auth/v1/factors/" + factorId + "/challenge", { method: "POST", headers: authHeaders(aal1Token) });
    if (!challengeRes.ok) throw new Blocked("local GoTrue factor-challenge endpoint unavailable: HTTP " + challengeRes.status);
    const challenge = await challengeRes.json().catch(() => ({}));
    const challengeId = challenge?.id;
    if (!challengeId) throw new Blocked("factor-challenge response missing id: " + JSON.stringify(challenge).slice(0, 300));

    const code = generateTotp(secret, { at: Date.now() });
    const verifyRes = await fetch(gateway + "/auth/v1/factors/" + factorId + "/verify", { method: "POST", headers: authHeaders(aal1Token), body: JSON.stringify({ challenge_id: challengeId, code }) });
    const verify = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok || !verify?.access_token) throw new Blocked("factor-verify failed (real local GoTrue rejected the computed TOTP code): HTTP " + verifyRes.status + " " + JSON.stringify(verify).slice(0, 300));

    bestOwnerToken = verify.access_token;
    const res = await route.GET(req({ authorization: "Bearer " + bestOwnerToken }));
    assert.equal(res.status, 200, "genuinely AAL2 Owner session must be accepted");
    assert.equal(res.headers.get("cache-control")?.includes("no-store"), true);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.view.schema, "qf.vox.overview.v1");
    assert.equal(body.view.actionsEnabled, false);
    assert.deepEqual(body.view.permissions, ["OWNER_READ_ONLY"]);
    for (const k of ["prospectPreview", "vendorCrmPreview", "supportPreview", "humanDeskPreview"]) {
      assert.ok(Array.isArray(body.view[k]) && body.view[k].length <= 8, k + " must be a bounded array");
    }
    const support = body.view.supportPreview[0];
    assert.ok(support && "priority" in support && !("topic" in support), "support preview must carry priority, never topic");
  });

  // ---- Optional: real wall-clock expiry on a second disposable instance ---
  await optional("real route: token from a genuinely-expired real local GoTrue session is denied (real wall-clock wait)", async () => {
    const shortName = "vox03-gotrue-short-" + suffix;
    try {
      docker(
        "run", "-d", "--name", shortName, "--network", net, "-p", "127.0.0.1::9999",
        "-e", "GOTRUE_DB_DRIVER=postgres",
        "-e", "GOTRUE_DB_DATABASE_URL=postgres://" + DB_USER + ":" + pass + "@" + pgname + ":5432/" + DB_NAME + "?sslmode=disable",
        "-e", "GOTRUE_DB_NAMESPACE=auth", "-e", "GOTRUE_API_HOST=0.0.0.0", "-e", "GOTRUE_API_PORT=9999",
        "-e", "GOTRUE_SITE_URL=http://localhost", "-e", "API_EXTERNAL_URL=http://localhost:9999", "-e", "GOTRUE_API_EXTERNAL_URL=http://localhost:9999",
        "-e", "GOTRUE_JWT_SECRET=" + jwtSecret, "-e", "GOTRUE_JWT_AUD=authenticated", "-e", "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
        "-e", "GOTRUE_JWT_EXP=2",
        "-e", "GOTRUE_EXTERNAL_EMAIL_ENABLED=true", "-e", "GOTRUE_MAILER_AUTOCONFIRM=true", "-e", "GOTRUE_DISABLE_SIGNUP=false",
        GOTRUE_IMAGE,
      );
      containers.push(shortName);
    } catch (e) {
      throw new Blocked("could not start short-lived expiry GoTrue instance: " + String(e.message || e));
    }
    let shortPort;
    try {
      shortPort = hostPort(shortName, "9999/tcp");
      if (!shortPort) throw new Error("no port");
      await ready("http://127.0.0.1:" + shortPort + "/health");
    } catch (e) {
      throw new Blocked("short-lived expiry GoTrue instance did not become ready: " + String(e.message || e));
    }
    const shortEmail = "vox03-exp-" + suffix + "@example.invalid";
    const shortPassword = "A-" + randomBytes(18).toString("hex");
    const shortRes = await fetch("http://127.0.0.1:" + shortPort + "/signup", { method: "POST", headers: { "content-type": "application/json", apikey: anonJwt }, body: JSON.stringify({ email: shortEmail, password: shortPassword }) });
    const shortBody = await shortRes.json().catch(() => ({}));
    if (!shortRes.ok || !shortBody.access_token) throw new Blocked("short-lived instance signup failed: HTTP " + shortRes.status);
    await delay(3000); // real wall-clock wait past the real GOTRUE_JWT_EXP=2 window
    const res = await route.GET(req({ authorization: "Bearer " + shortBody.access_token }));
    assert.equal(res.status, 401, "a genuinely wall-clock-expired real GoTrue token must be denied");
  });

  // ---- Optional: real admin deletion -> real denial -----------------------
  await optional("real route: token for an admin-deleted user is denied by REAL local GoTrue getUser", async () => {
    const delRes = await fetch(gateway + "/auth/v1/admin/users/" + ownerId, { method: "DELETE", headers: { authorization: "Bearer " + adminJwt, apikey: adminJwt } });
    if (!delRes.ok) throw new Blocked("admin delete-user endpoint unavailable: HTTP " + delRes.status);
    const res = await route.GET(req({ authorization: "Bearer " + bestOwnerToken }));
    assert.equal(res.status, 401, "a token for a now-deleted user must be denied");
  });

  await test("real route: POST/PUT/DELETE return 405 READ_ONLY", async () => {
    for (const verb of ["POST", "PUT", "DELETE"]) {
      const res = route[verb]();
      assert.equal(res.status, 405);
      assert.equal((await res.json()).error, "READ_ONLY");
    }
  });

  console.log("VOX_03_REAL_LOCAL_GOTRUE_OWNER_AUTH_PASS " + passed + " passed, " + blockedCount + " blocked (not faked), 0 failed");
} catch (e) {
  console.log("VOX_03_REAL_LOCAL_GOTRUE_OWNER_AUTH_FAILURE", String(e?.message || e));
  process.exitCode = 1;
} finally {
  if (proxy) { try { await new Promise((r) => proxy.close(r)); } catch {} }
  try { await pg?.end(); } catch {}
  for (const name of containers.reverse()) { try { docker("rm", "-f", name); } catch {} }
  if (networkCreated) { try { docker("network", "rm", net); } catch {} }
  console.log("VOX_03_REAL_LOCAL_GOTRUE_FIXTURES_CLEANED");
}
