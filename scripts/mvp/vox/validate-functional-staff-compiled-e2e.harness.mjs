// ============================================================================
// VOX functional Staff QA — REAL Core Staff routes + COMPILED VOX Web screens
// against a disposable, loopback-only GoTrue + PostgREST + PostgreSQL 17 stack.
//
// Nothing here fakes authorization:
//   * Sessions are genuine GoTrue signups; AAL2 comes from a genuine GoTrue TOTP
//     enroll/challenge/verify cycle (the harness never hand-signs a claim).
//   * Core is the REAL app/api/vox/v1/{work-queue,eod-source-status,finance}
//     route handlers (real services/vox verifiers, real @supabase/supabase-js
//     calling local GoTrue/PostgREST), served over a loopback HTTP listener.
//     The Core DB role used by the routes has SELECT-only privileges, so any
//     write attempt by a route would fail loudly.
//   * Web is the real `next build` output (`next start`) driven only through its
//     own HTTP surface (/api/auth/*, /team/work-queue, /team/eod-sources,
//     /finance) with a real cookie jar. Its hard-pinned Core origin is mapped to
//     the loopback Core listener by fixtures/web-core-loopback.preload.cjs (QA
//     only; inert unless VOX_QA_CORE_LOOPBACK is a 127.0.0.1 URL).
//
// Covered: verified session, real permission denials (403), revoked Staff,
// deleted/401 navigation (sign-in link + safe return path, no login loop on
// 403), disabled/held EOD + Finance, read-only/no-money-movement.
//
// NOT covered (explicitly): managed Staging/Production, a human authenticator,
// Razorpay/provider calls, full UAT. No deploy, no feature enabling.
//
// Usage (needs Docker; Web phase needs `npm run build` in apps/vox-web):
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/mvp/vox/validate-functional-staff-compiled-e2e.harness.mjs
//   VOX_QA_REQUIRE_WEB_BUILD=1  -> fail (not skip) if the Web build is missing
// ============================================================================
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { register, createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHmac } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const WEB = path.join(ROOT, "apps", "vox-web");
const require = createRequire(path.join(ROOT, "package.json"));
const { Client } = require("pg");
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = require("ws");
const { generateTotp } = await import("./fixtures/totp.mjs");

// ---- Never touch a managed project ----------------------------------------
for (const name of ["SUPABASE_URL", "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VOX_CORE_ORIGIN", "VOX_SUPABASE_URL"]) {
  if (process.env[name]) throw new Error("REFUSING_TO_RUN: " + name + " is present in this shell.");
}
if (process.env.NEXT_PUBLIC_SUPABASE_URL && /supabase\.(co|in)/i.test(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
  throw new Error("REFUSING_TO_RUN: NEXT_PUBLIC_SUPABASE_URL points at a managed host.");
}

const GOTRUE_IMAGE = "supabase/gotrue:v2.196.0";
const POSTGRES_IMAGE = "postgres:17-alpine";
const POSTGREST_IMAGE =
  "ghcr.io/supabase/postgrest:v16.1@sha256:5922bde07147b82b1c9d8f749e48c1e5b99ebb233f3888bb7ab65f07cf4ac82d";

const suffix = String(process.pid);
const net = "vox-func-net-" + suffix;
const pgname = "vox-func-pg-" + suffix;
const gtname = "vox-func-auth-" + suffix;
const restname = "vox-func-rest-" + suffix;
const DB_USER = "voxfunc", DB_NAME = "voxfunc";
const pass = randomBytes(22).toString("hex");
const jwtSecret = randomBytes(32).toString("hex");

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const jwt = (claims) => {
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url(claims);
  return head + "." + body + "." + createHmac("sha256", jwtSecret).update(head + "." + body).digest("base64url");
};
async function ready(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).status < 500) return; } catch {}
    await delay(400);
  }
  throw new Error("SERVICE_NOT_READY:" + url);
}
const hostPort = (name, port) => Number(docker("port", name, port).match(/127\.0\.0\.1:(\d+)/)?.[1]);
async function freePort() {
  const s = createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

let pg = null, proxy = null, coreServer = null, webProc = null, networkCreated = false;
const containers = [];
const results = { core: 0, web: 0, failed: 0, webSkipped: false };
const failures = [];
async function check(phase, name, fn) {
  try {
    await fn();
    results[phase]++;
    console.log("PASS [" + phase + "] " + name);
  } catch (e) {
    results.failed++;
    failures.push(phase + ": " + name);
    console.log("FAIL [" + phase + "] " + name + " :: " + String(e?.message || e).split("\n")[0]);
  }
}

// ---- Fixed, synthetic Core identifiers -------------------------------------
const CITY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROSPECT = "11111111-1111-4111-8111-111111111111";
const REQUESTER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HOUR = 3600 * 1000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

try {
  const now = Math.floor(Date.now() / 1000);
  const adminJwt = jwt({ role: "service_role", aud: "authenticated", iss: "supabase", iat: now, exp: now + 7200 });
  const anonJwt = jwt({ role: "anon", aud: "authenticated", iss: "supabase", iat: now, exp: now + 7200 });

  // ---------------------------------------------------------------- stack up
  docker("network", "create", net);
  networkCreated = true;
  docker("run", "-d", "--name", pgname, "--network", net,
    "-e", "POSTGRES_USER=" + DB_USER, "-e", "POSTGRES_PASSWORD=" + pass, "-e", "POSTGRES_DB=" + DB_NAME,
    "-p", "127.0.0.1::5432", POSTGRES_IMAGE);
  containers.push(pgname);
  for (let i = 0; i < 60 && !pg; i++) {
    try {
      const port = hostPort(pgname, "5432/tcp");
      if (!port) throw new Error("no port");
      pg = new Client({ host: "127.0.0.1", port, user: DB_USER, password: pass, database: DB_NAME, connectionTimeoutMillis: 800 });
      await pg.connect();
    } catch { try { await pg?.end(); } catch {} pg = null; await delay(400); }
  }
  if (!pg) throw new Error("PG_NOT_READY");
  const pgVersion = (await pg.query("show server_version")).rows[0].server_version;
  assert.match(pgVersion, /^17\./, "disposable PostgreSQL must be 17.x, got " + pgVersion);
  console.log("VOX_FUNCTIONAL_PG_VERSION " + pgVersion);

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
    CREATE TABLE public.cities(id uuid PRIMARY KEY, is_active boolean);
    CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY, city_id uuid, is_active boolean);
    CREATE TABLE public.vox_staff_memberships_v1(
      auth_user_id uuid PRIMARY KEY, team_id uuid, staff_role text, is_active boolean,
      expires_at timestamptz, revoked_at timestamptz);
    CREATE TABLE public.vox_staff_object_scopes_v1(
      auth_user_id uuid, scope_kind text, object_id uuid, expires_at timestamptz, revoked_at timestamptz);
    CREATE TABLE public.vox_staff_department_capabilities_v1(
      id uuid PRIMARY KEY, request_id uuid, auth_user_id uuid, team_id uuid, city_id uuid, department text,
      granted_by uuid, expires_at timestamptz, revoked_at timestamptz, revision int);
    CREATE TABLE public.vox_staff_department_requests_v1(
      id uuid PRIMARY KEY, target_staff_id uuid, team_id uuid, city_id uuid, department text,
      requested_by uuid, decided_by uuid, decision_reference text, state text, revision int, expires_at timestamptz);
    CREATE TABLE public.vox_staff_department_decisions_v1(
      request_id uuid, reviewer_id uuid, decision text, decision_reference text);
    CREATE TABLE public.vox_staff_department_activations_v1(
      request_id uuid, capability_id uuid, activated_by uuid);
    CREATE TABLE public.aarohi_prospects(id uuid PRIMARY KEY, city_id uuid);
    CREATE TABLE public.vendors(id uuid PRIMARY KEY, service_zone_id uuid);
    CREATE TABLE public.marketplace_service_zones(id uuid PRIMARY KEY, city_id uuid, is_active boolean);
    CREATE TABLE public.vendor_support_threads(id uuid PRIMARY KEY, vendor_id uuid);
    CREATE TABLE public.communication_conversations(id uuid PRIMARY KEY, subject_type text, subject_id uuid);
    CREATE TABLE public.vox_work_events_candidate_v1(id uuid PRIMARY KEY, actor_id uuid, created_at timestamptz);
    CREATE TABLE public.vox_work_items_candidate_v1(
      id uuid PRIMARY KEY, team_id uuid, city_id uuid, source_kind text, source_id uuid,
      assignee_id uuid, state text, revision int, updated_at timestamptz);
    CREATE TABLE public.vendor_package_orders(
      id uuid PRIMARY KEY, vendor_id uuid, package_price numeric, package_currency text, credits_included int,
      order_status text, payment_status text, activation_status text, created_at timestamptz);

    -- Core runs as service_role: SELECT-only. A route that tried to write
    -- (refund, wallet credit, work transition...) would fail with permission denied.
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
    ALTER ROLE ${DB_USER} SET search_path TO auth,public;

    INSERT INTO public.cities VALUES ('${CITY}', true);
    INSERT INTO public.vox_staff_teams_v1 VALUES ('${TEAM}', '${CITY}', true);
    INSERT INTO public.aarohi_prospects VALUES ('${PROSPECT}', '${CITY}');
    INSERT INTO public.vendor_package_orders VALUES
      ('d1111111-1111-4111-8111-111111111111','e1111111-1111-4111-8111-111111111111',4999,'INR',50,'completed','paid','activated', now() - interval '2 days'),
      ('d2222222-2222-4222-8222-222222222222','e2222222-2222-4222-8222-222222222222',2999,'INR',25,'created','pending','not_activated', now() - interval '1 day'),
      ('d3333333-3333-4333-8333-333333333333','e3333333-3333-4333-8333-333333333333',999,'INR',10,'created','failed','not_activated', now());
  `);

  docker("run", "-d", "--name", gtname, "--network", net, "-p", "127.0.0.1::9999",
    "-e", "GOTRUE_DB_DRIVER=postgres",
    "-e", "GOTRUE_DB_DATABASE_URL=postgres://" + DB_USER + ":" + pass + "@" + pgname + ":5432/" + DB_NAME + "?sslmode=disable",
    "-e", "GOTRUE_DB_NAMESPACE=auth", "-e", "GOTRUE_API_HOST=0.0.0.0", "-e", "GOTRUE_API_PORT=9999",
    "-e", "GOTRUE_SITE_URL=http://localhost", "-e", "API_EXTERNAL_URL=http://localhost:9999", "-e", "GOTRUE_API_EXTERNAL_URL=http://localhost:9999",
    "-e", "GOTRUE_JWT_SECRET=" + jwtSecret, "-e", "GOTRUE_JWT_AUD=authenticated", "-e", "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
    "-e", "GOTRUE_JWT_EXP=3600",
    "-e", "GOTRUE_EXTERNAL_EMAIL_ENABLED=true", "-e", "GOTRUE_MAILER_AUTOCONFIRM=true", "-e", "GOTRUE_DISABLE_SIGNUP=false",
    "-e", "GOTRUE_MFA_ENABLED=true", "-e", "GOTRUE_RATE_LIMIT_EMAIL_SENT=1000",
    GOTRUE_IMAGE);
  containers.push(gtname);
  const authPort = hostPort(gtname, "9999/tcp");
  await ready("http://127.0.0.1:" + authPort + "/health");

  docker("run", "-d", "--name", restname, "--network", net, "-p", "127.0.0.1::3000",
    "-e", "PGRST_DB_URI=postgres://authenticator:" + pass + "@" + pgname + ":5432/" + DB_NAME,
    "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_DB_ANON_ROLE=anon", "-e", "PGRST_JWT_SECRET=" + jwtSecret,
    "-e", "PGRST_SERVER_PORT=3000", POSTGREST_IMAGE);
  containers.push(restname);
  const restPort = hostPort(restname, "3000/tcp");
  await ready("http://127.0.0.1:" + restPort + "/");

  // Loopback gateway: /auth/v1/* -> GoTrue, /rest/v1/* -> PostgREST (as in VL-01/VOX P0-3).
  proxy = createServer((request, response) => {
    const dest =
      request.url.startsWith("/auth/v1/") ? "http://127.0.0.1:" + authPort + request.url.slice("/auth/v1".length) :
      request.url.startsWith("/rest/v1/") ? "http://127.0.0.1:" + restPort + request.url.slice("/rest/v1".length) : null;
    if (!dest) { response.writeHead(404); response.end(); return; }
    const headers = { ...request.headers };
    delete headers.host;
    const chunks = [];
    request.on("data", (x) => chunks.push(x));
    request.on("end", async () => {
      try {
        const upstream = await fetch(dest, { method: request.method, headers,
          body: ["GET", "HEAD"].includes(request.method) ? undefined : Buffer.concat(chunks), redirect: "manual" });
        const out = {};
        for (const [k, v] of upstream.headers) if (!["transfer-encoding", "connection", "content-encoding"].includes(k)) out[k] = v;
        response.writeHead(upstream.status, out);
        response.end(Buffer.from(await upstream.arrayBuffer()));
      } catch { response.writeHead(502); response.end(); }
    });
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const gateway = "http://127.0.0.1:" + proxy.address().port;
  console.log("VOX_FUNCTIONAL_STACK_READY gotrue+postgrest+pg17");

  // ------------------------------------------------- Core env + real routes
  process.env.NEXT_PUBLIC_SUPABASE_URL = gateway;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonJwt;
  process.env.SUPABASE_SERVICE_ROLE_KEY = adminJwt;
  const CORE_FLAGS = ["VOX_STAFF_READ_ENABLED", "VOX_STAFF_GRANTS_ENABLED", "VOX_DEPARTMENT_ENFORCEMENT_ENABLED",
    "VOX_WORK_QUEUE_READ_ENABLED", "VOX_EOD_PREVIEW_ENABLED", "VOX_EOD_SOURCE_READINESS_ENABLED", "VOX_FINANCE_READ_ENABLED"];
  const setCoreFlags = (on) => { for (const f of CORE_FLAGS) { if (on) process.env[f] = "staging"; else delete process.env[f]; } };
  setCoreFlags(true);

  register("./fixtures/vox-real-source.loader.mjs", import.meta.url);
  const ROUTES = {
    "work-queue": await import("@/app/api/vox/v1/work-queue/route.ts"),
    "eod-source-status": await import("@/app/api/vox/v1/eod-source-status/route.ts"),
    "finance": await import("@/app/api/vox/v1/finance/route.ts"),
  };
  coreServer = createServer(async (req, res) => {
    try {
      const m = new URL(req.url, "http://127.0.0.1").pathname.match(/^\/api\/vox\/v1\/([a-z-]+)$/);
      const mod = m && ROUTES[m[1]];
      if (!mod) { res.writeHead(404); res.end(); return; }
      const handler = mod[req.method];
      if (typeof handler !== "function") { res.writeHead(405); res.end(); return; }
      const headers = { ...req.headers };
      delete headers.host;
      const out = await handler(new Request("https://core.local" + req.url, { method: req.method, headers }));
      const text = await out.text();
      const h = {};
      for (const [k, v] of out.headers) h[k] = v;
      res.writeHead(out.status, h);
      res.end(text);
    } catch (e) { res.writeHead(500); res.end(String(e?.message || e)); }
  });
  coreServer.listen(0, "127.0.0.1");
  await once(coreServer, "listening");
  const coreBase = "http://127.0.0.1:" + coreServer.address().port;
  const core = async (route, token, init = {}) => {
    const r = await fetch(coreBase + "/api/vox/v1/" + route, {
      method: init.method ?? "GET",
      headers: token ? { authorization: "Bearer " + token } : {},
    });
    const text = await r.text();
    let body = null; try { body = JSON.parse(text); } catch {}
    return { status: r.status, body, text, headers: r.headers };
  };

  // ------------------------------------------------------ real GoTrue helpers
  const gt = (p, token, method = "POST", body) => fetch(gateway + "/auth/v1" + p, {
    method, headers: { "content-type": "application/json", apikey: anonJwt, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const gtAdmin = (p, method, body) => fetch(gateway + "/auth/v1/admin" + p, {
    method, headers: { "content-type": "application/json", authorization: "Bearer " + adminJwt, apikey: adminJwt },
    body: body === undefined ? undefined : JSON.stringify(body) });

  async function signup(label) {
    const email = "vf-" + label + "-" + suffix + "@example.invalid";
    const password = "A-" + randomBytes(18).toString("hex");
    const r = await gt("/signup", null, "POST", { email, password });
    const j = await r.json();
    assert.equal(r.status, 200, "signup " + label);
    return { id: j.user.id, email, password, aal1Token: j.access_token, label };
  }
  async function setMeta(u, app_metadata) {
    const r = await gtAdmin("/users/" + u.id, "PUT", { app_metadata });
    assert.ok(r.ok, "admin metadata " + u.label);
  }
  async function totpFor(secret) { return generateTotp(secret, { at: Date.now() }); }
  async function aal2Direct(u) {
    const enr = await (await gt("/factors", u.aal1Token, "POST", { friendly_name: "qa-" + u.label, factor_type: "totp" })).json();
    assert.ok(enr.id && enr.totp?.secret, "enroll " + u.label);
    for (let attempt = 0; attempt < 3; attempt++) {
      const ch = await (await gt("/factors/" + enr.id + "/challenge", u.aal1Token)).json();
      const r = await gt("/factors/" + enr.id + "/verify", u.aal1Token, "POST", { challenge_id: ch.id, code: await totpFor(enr.totp.secret) });
      const j = await r.json();
      if (r.ok && j.access_token) return j.access_token;
      await delay(1500);
    }
    throw new Error("could not reach aal2 for " + u.label);
  }
  const TL = { id: null };
  async function provisionTeamLeaderReviewer() {
    const u = await signup("tl");
    await setMeta(u, { qf_principal: "vox_staff", vox_role: "team_leader" });
    await pg.query("INSERT INTO public.profiles VALUES ($1,NULL,true)", [u.id]);
    await pg.query("INSERT INTO public.vox_staff_memberships_v1 VALUES ($1,$2,'team_leader',true,$3,NULL)", [u.id, TEAM, iso(24 * HOUR)]);
    TL.id = u.id;
    return u;
  }
  /** Neutral VOX staff principal + membership + prospect grant + approved department + one assigned work item. */
  async function provisionStaff(label, { role = "acquisition_agent", grant = true, work = true, department = true } = {}) {
    const u = await signup(label);
    await setMeta(u, { qf_principal: "vox_staff" });
    await pg.query("INSERT INTO public.profiles VALUES ($1,NULL,true)", [u.id]);
    await pg.query("INSERT INTO public.vox_staff_memberships_v1 VALUES ($1,$2,$3,true,$4,NULL)", [u.id, TEAM, role, iso(24 * HOUR)]);
    if (grant) await pg.query("INSERT INTO public.vox_staff_object_scopes_v1 VALUES ($1,'prospect',$2,$3,NULL)", [u.id, PROSPECT, iso(24 * HOUR)]);
    if (department) {
      const req = randomUUID(), cap = randomUUID(), ref = "QA-DEC-" + label;
      await pg.query("INSERT INTO public.vox_staff_department_requests_v1 VALUES ($1,$2,$3,$4,'acquisition',$5,$6,$7,'APPROVED',1,$8)",
        [req, u.id, TEAM, CITY, REQUESTER, TL.id, ref, iso(24 * HOUR)]);
      await pg.query("INSERT INTO public.vox_staff_department_capabilities_v1 VALUES ($1,$2,$3,$4,$5,'acquisition',$6,$7,NULL,2)",
        [cap, req, u.id, TEAM, CITY, REQUESTER, iso(24 * HOUR)]);
      await pg.query("INSERT INTO public.vox_staff_department_decisions_v1 VALUES ($1,$2,'APPROVED',$3)", [req, TL.id, ref]);
      await pg.query("INSERT INTO public.vox_staff_department_activations_v1 VALUES ($1,$2,$3)", [req, cap, REQUESTER]);
      u.capabilityId = cap;
    }
    if (work) {
      u.workId = randomUUID();
      await pg.query("INSERT INTO public.vox_work_items_candidate_v1 VALUES ($1,$2,$3,'prospect',$4,$5,'ASSIGNED',3,now())",
        [u.workId, TEAM, CITY, PROSPECT, u.id]);
    }
    return u;
  }
  async function provisionOwner(label) {
    const u = await signup(label);
    await setMeta(u, { admin_role: "Superadmin" });
    await pg.query("INSERT INTO public.profiles VALUES ($1,'admin',true)", [u.id]);
    return u;
  }
  const fingerprint = async () => (await pg.query(
    `SELECT (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY id),'')) FROM public.vendor_package_orders t) AS orders,
            (SELECT count(*) FROM public.vox_work_events_candidate_v1) AS events`)).rows[0];
  const before = await fingerprint();

  await provisionTeamLeaderReviewer();

  // =========================================================================
  // PHASE 1 — REAL Core Staff routes over HTTP, real GoTrue AAL2
  // =========================================================================
  const staff = await provisionStaff("staff");
  const staffTok = await aal2Direct(staff);
  const owner = await provisionOwner("owner");
  const ownerTok = await aal2Direct(owner);

  await check("core", "work-queue: anonymous is denied with no data (403)", async () => {
    const r = await core("work-queue", null);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "CURRENT_AAL2_STAFF_SCOPE_REQUIRED");
  });
  await check("core", "work-queue: forged/garbage bearer is denied by real GoTrue", async () => {
    const r = await core("work-queue", "x".repeat(120) + "." + "y".repeat(40) + "." + "z".repeat(40));
    assert.equal(r.status, 403);
  });
  await check("core", "work-queue: AAL1 Staff (correct membership/grants, no MFA) is denied", async () => {
    const r = await core("work-queue", staff.aal1Token);
    assert.equal(r.status, 403);
  });
  await check("core", "work-queue: verified AAL2 Staff gets only their granted, assigned work (read-only)", async () => {
    const r = await core("work-queue", staffTok);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.schema, "qf.vox.work.queue.preview.v1");
    assert.equal(r.body.mode, "READ_ONLY");
    assert.equal(r.body.actionsEnabled, false);
    assert.equal(r.body.items.length, 1);
    assert.equal(r.body.items[0].workItemId, staff.workId);
    assert.equal(r.body.items[0].assignedToMe, true);
    assert.equal(r.body.items[0].canClaim, false);
    assert.equal(r.body.items[0].canTransition, false);
    assert.match(r.headers.get("cache-control"), /no-store/);
  });
  await check("core", "work-queue: query string/filter is refused (400), no fabricated filtering", async () => {
    const r = await fetch(coreBase + "/api/vox/v1/work-queue?assignee=all", { headers: { authorization: "Bearer " + staffTok } });
    assert.equal(r.status, 400);
  });
  await check("core", "work-queue/eod/finance: every mutating verb is refused (405) even with a valid AAL2 session", async () => {
    for (const route of ["work-queue", "eod-source-status", "finance"]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const r = await core(route, route === "finance" ? ownerTok : staffTok, { method });
        assert.equal(r.status, 405, route + " " + method);
      }
    }
  });
  await check("core", "work-queue: Staff without department approval sees an empty queue, never other work", async () => {
    const s = await provisionStaff("nodept", { department: false, work: false });
    const r = await core("work-queue", await aal2Direct(s));
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.items, []);
  });
  await check("core", "work-queue: Owner (legacy admin profile) is not a Staff principal (403)", async () => {
    assert.equal((await core("work-queue", ownerTok)).status, 403);
  });
  await check("core", "work-queue: AAL2 user with no Staff membership is denied (403)", async () => {
    const u = await signup("nomember");
    await setMeta(u, { qf_principal: "vox_staff" });
    await pg.query("INSERT INTO public.profiles VALUES ($1,NULL,true)", [u.id]);
    assert.equal((await core("work-queue", await aal2Direct(u))).status, 403);
  });
  await check("core", "work-queue: Staff whose Auth principal is a legacy admin is denied (no privilege inheritance)", async () => {
    const u = await signup("legacyadmin");
    await setMeta(u, { qf_principal: "vox_staff", admin_role: "Superadmin" });
    await pg.query("INSERT INTO public.profiles VALUES ($1,'admin',true)", [u.id]);
    await pg.query("INSERT INTO public.vox_staff_memberships_v1 VALUES ($1,$2,'acquisition_agent',true,$3,NULL)", [u.id, TEAM, iso(HOUR)]);
    assert.equal((await core("work-queue", await aal2Direct(u))).status, 403);
  });
  await check("core", "work-queue: expired membership is denied (403)", async () => {
    const s = await provisionStaff("expired", { work: false });
    const t = await aal2Direct(s);
    await pg.query("UPDATE public.vox_staff_memberships_v1 SET expires_at = now() - interval '1 minute' WHERE auth_user_id=$1", [s.id]);
    assert.equal((await core("work-queue", t)).status, 403);
  });
  await check("core", "work-queue: Team Leader and Auditor roles never read work content (403)", async () => {
    for (const role of ["team_leader", "auditor"]) {
      const s = await provisionStaff("role-" + role, { role, work: false, department: false });
      assert.equal((await core("work-queue", await aal2Direct(s))).status, 403, role);
    }
  });
  await check("core", "work-queue: revoking Staff membership denies the SAME still-valid AAL2 token immediately", async () => {
    const s = await provisionStaff("revoke", {});
    const t = await aal2Direct(s);
    assert.equal((await core("work-queue", t)).status, 200);
    await pg.query("UPDATE public.vox_staff_memberships_v1 SET is_active=false, revoked_at=now() WHERE auth_user_id=$1", [s.id]);
    const r = await core("work-queue", t);
    assert.equal(r.status, 403);
    assert.ok(!r.text.includes(s.workId), "no work metadata leaks after revoke");
  });
  await check("core", "work-queue: revoking the object grant empties the queue; revoking the department capability narrows it", async () => {
    const s = await provisionStaff("grantrevoke", {});
    const t = await aal2Direct(s);
    assert.equal((await core("work-queue", t)).body.items.length, 1);
    await pg.query("UPDATE public.vox_staff_department_capabilities_v1 SET revoked_at=now() WHERE id=$1", [s.capabilityId]);
    const r = await core("work-queue", t);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items, []);
  });
  await check("core", "work-queue: a deleted Auth user is denied by real GoTrue even with a not-yet-expired token", async () => {
    const s = await provisionStaff("deleted", {});
    const t = await aal2Direct(s);
    assert.equal((await core("work-queue", t)).status, 200);
    assert.ok((await gtAdmin("/users/" + s.id, "DELETE")).ok);
    assert.equal((await core("work-queue", t)).status, 403);
  });
  await check("core", "work-queue: disabled city revokes Staff authority (403)", async () => {
    const s = await provisionStaff("citydown", {});
    const t = await aal2Direct(s);
    await pg.query("UPDATE public.cities SET is_active=false WHERE id=$1", [CITY]);
    const r = await core("work-queue", t);
    await pg.query("UPDATE public.cities SET is_active=true WHERE id=$1", [CITY]);
    assert.equal(r.status, 403);
  });
  await check("core", "work-queue: release flag off -> 503 hold, no data", async () => {
    delete process.env.VOX_WORK_QUEUE_READ_ENABLED;
    const r = await core("work-queue", staffTok);
    process.env.VOX_WORK_QUEUE_READ_ENABLED = "staging";
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "WORK_QUEUE_DISABLED");
    assert.ok(!r.text.includes(staff.workId));
  });

  await check("core", "eod-source-status: verified Staff gets partial source readiness; never a final/total EOD", async () => {
    const r = await core("eod-source-status", staffTok);
    assert.equal(r.status, 200, r.text);
    const b = r.body;
    assert.equal(b.schema, "qf.vox.staff.eod.source-status.v1");
    assert.equal(b.mode, "READ_ONLY");
    assert.equal(b.allSourceReady, false);
    assert.equal(b.rollup, null);
    assert.equal(b.canSubmit, false);
    assert.equal(b.canExport, false);
    assert.equal(b.actionsEnabled, false);
    assert.equal(b.providerMessagesSent, 0);
    assert.equal(b.completeness, "INCOMPLETE_NO_SIGNED_ALL_SOURCE_WATERMARKS");
    assert.equal(b.sources.length, 4);
    for (const s of b.sources.filter((x) => x.source !== "CORE_WORK_LEDGER")) assert.equal(s.eventProvenance, "NOT_PROVEN");
  });
  await check("core", "eod-source-status: anonymous, AAL1 and Owner (non-Staff) are denied (403)", async () => {
    assert.equal((await core("eod-source-status", null)).status, 403);
    assert.equal((await core("eod-source-status", staff.aal1Token)).status, 403);
    assert.equal((await core("eod-source-status", ownerTok)).status, 403);
  });
  await check("core", "eod-source-status: EOD readiness flag off -> 503 hold with no source data", async () => {
    delete process.env.VOX_EOD_SOURCE_READINESS_ENABLED;
    const r = await core("eod-source-status", staffTok);
    process.env.VOX_EOD_SOURCE_READINESS_ENABLED = "staging";
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "SOURCE_READINESS_DISABLED");
    assert.equal(r.body.sources, undefined);
  });
  await check("core", "eod-source-status: revoked Staff is denied (403) on a still-valid token", async () => {
    const s = await provisionStaff("eodrevoke", {});
    const t = await aal2Direct(s);
    assert.equal((await core("eod-source-status", t)).status, 200);
    await pg.query("UPDATE public.vox_staff_memberships_v1 SET revoked_at=now(), is_active=false WHERE auth_user_id=$1", [s.id]);
    assert.equal((await core("eod-source-status", t)).status, 403);
  });

  await check("core", "finance: verified Owner AAL2 gets a bounded READ-ONLY order preview with no money authority", async () => {
    const r = await core("finance", ownerTok);
    assert.equal(r.status, 200, r.text);
    const b = r.body;
    assert.equal(b.schema, "qf.vox.finance.order-preview.v1");
    assert.equal(b.mode, "READ_ONLY");
    assert.equal(b.canRefund, false);
    assert.equal(b.canReconcile, false);
    assert.equal(b.canActivatePayments, false);
    assert.equal(b.hasProviderConfirmation, false);
    assert.equal(b.isCompleteHistory, false);
    assert.equal(b.orders.length, 3);
    assert.doesNotMatch(r.text, /razorpay|utr|account_number|secret/i);
  });
  await check("core", "finance: Staff AAL2, Owner AAL1, anonymous are all denied (403) with no orders", async () => {
    const owner1 = await core("finance", owner.aal1Token);
    const staff2 = await core("finance", staffTok);
    const anon = await core("finance", null);
    for (const r of [owner1, staff2, anon]) { assert.equal(r.status, 403); assert.equal(r.body.error, "OWNER_AAL2_REQUIRED"); assert.equal(r.body.orders, undefined); }
  });
  await check("core", "finance: filters are refused (400) and the Finance flag off is a 503 hold", async () => {
    const f = await fetch(coreBase + "/api/vox/v1/finance?status=paid", { headers: { authorization: "Bearer " + ownerTok } });
    assert.equal(f.status, 400);
    delete process.env.VOX_FINANCE_READ_ENABLED;
    const r = await core("finance", ownerTok);
    process.env.VOX_FINANCE_READ_ENABLED = "staging";
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "FINANCE_PREVIEW_DISABLED");
    assert.equal(r.body.orders, undefined);
  });
  await check("core", "finance: Owner demoted to inactive is denied on the same token", async () => {
    const o = await provisionOwner("owner2");
    const t = await aal2Direct(o);
    assert.equal((await core("finance", t)).status, 200);
    await pg.query("UPDATE public.profiles SET is_active=false WHERE id=$1", [o.id]);
    assert.equal((await core("finance", t)).status, 403);
  });
  await check("core", "no money/work state changed by any Core route call (orders + events fingerprint)", async () => {
    assert.deepEqual(await fingerprint(), before);
  });

  // =========================================================================
  // PHASE 2 — COMPILED VOX Web (next start) driving the real Core routes
  // =========================================================================
  const requireBuild = process.env.VOX_QA_REQUIRE_WEB_BUILD === "1";
  if (!existsSync(path.join(WEB, ".next", "BUILD_ID"))) {
    if (requireBuild) throw new Error("WEB_BUILD_MISSING: run `npm run build` in apps/vox-web (VOX_QA_REQUIRE_WEB_BUILD=1)");
    results.webSkipped = true;
    console.log("SKIP [web] apps/vox-web/.next/BUILD_ID missing; compiled Web phase not run");
  } else {
    const webPort = await freePort();
    const webBase = "http://127.0.0.1:" + webPort;
    const localNext = path.join(WEB, "node_modules", "next", "dist", "bin", "next");
    const nextBin = existsSync(localNext) ? localNext : path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
    const preload = path.join(HERE, "fixtures", "web-core-loopback.preload.cjs").replaceAll("\\", "/");
    const env = { ...process.env, NODE_ENV: "production",
      NODE_OPTIONS: ((process.env.NODE_OPTIONS ?? "") + ' --require "' + preload + '"').trim(),
      VOX_QA_CORE_LOOPBACK: coreBase,
      VOX_CORE_ORIGIN: "https://staging-core.quickfurno.in",
      VOX_SUPABASE_URL: gateway, VOX_SUPABASE_PUBLISHABLE_KEY: anonJwt,
      VOX_EXPECTED_ORIGIN: webBase,
      VOX_STAFF_PORTAL_ENABLED: "staging", VOX_STAFF_VIEW_MODE: "scoped", VOX_STAFF_MFA_ENROLL_ENABLED: "staging",
      VOX_TEAM_WORKSPACE_ENABLED: "staging", VOX_WORK_QUEUE_UI_ENABLED: "staging",
      VOX_EOD_SOURCE_STATUS_UI_ENABLED: "staging", VOX_FINANCE_READ_UI_ENABLED: "staging" };
    // The Web process must see only the VOX_* Auth config, never the Core service-role/admin key.
    for (const k of ["SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) delete env[k];
    let webLog = "";
    webProc = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(webPort)], { cwd: WEB, env, stdio: ["ignore", "pipe", "pipe"] });
    webProc.stdout.on("data", (d) => { webLog += d; });
    webProc.stderr.on("data", (d) => { webLog += d; });
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      try { up = (await fetch(webBase + "/login", { signal: AbortSignal.timeout(1500) })).status === 200; } catch { await delay(500); }
    }
    if (!up) throw new Error("WEB_NOT_STARTED:\n" + webLog.slice(-1500));
    console.log("VOX_FUNCTIONAL_WEB_STARTED " + webBase);

    class Jar {
      constructor() { this.c = new Map(); }
      absorb(res) {
        for (const sc of res.headers.getSetCookie()) {
          const [pair, ...attrs] = sc.split(";");
          const i = pair.indexOf("=");
          const k = pair.slice(0, i).trim(), v = pair.slice(i + 1);
          if (v === "" || attrs.some((a) => /^\s*max-age=0/i.test(a))) this.c.delete(k); else this.c.set(k, v);
        }
      }
      header() { return [...this.c].map(([k, v]) => k + "=" + v).join("; "); }
    }
    const page = async (p, jar) => {
      const r = await fetch(webBase + p, { headers: jar ? { cookie: jar.header() } : {}, redirect: "manual", signal: AbortSignal.timeout(15000) });
      jar?.absorb(r);
      return { status: r.status, body: await r.text(), headers: r.headers };
    };
    const api = async (p, jar, body, { origin = webBase } = {}) => {
      const r = await fetch(webBase + p, { method: "POST",
        headers: { "content-type": "application/json", ...(origin ? { origin } : {}), cookie: jar.header() },
        body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(15000) });
      jar.absorb(r);
      let j = null; try { j = await r.json(); } catch {}
      return { status: r.status, body: j };
    };
    const signIn = (u, jar) => api("/api/auth/sign-in", jar, { email: u.email, password: u.password });
    async function webAal2(u, jar) {
      assert.equal((await signIn(u, jar)).status, 200, "web sign-in " + u.label);
      const enr = await api("/api/auth/mfa/enroll", jar, {});
      assert.equal(enr.status, 200, "web enroll " + u.label + " " + JSON.stringify(enr.body));
      for (let attempt = 0; attempt < 3; attempt++) {
        const c = await api("/api/auth/mfa/confirm", jar, { factorId: enr.body.factorId, code: await totpFor(enr.body.secret) });
        if (c.status === 200) return;
        await delay(1500);
      }
      throw new Error("web MFA confirm failed " + u.label);
    }
    const noLeak = (r, label) => {
      assert.doesNotMatch(r.body, /Bearer |service_role|eyJ[A-Za-z0-9_-]{10}/, label + " leaks a credential");
      assert.match(r.headers.get("cache-control") ?? "", /no-store|no-cache|max-age=0/, label + " must not be cacheable");
    };
    const loginHref = (next) => 'href="/login?next=' + encodeURIComponent(next) + '"';

    const anon = new Jar();
    await check("web", "anonymous /team/work-queue: locked page offers Staff sign-in WITH its own return path (401 navigation)", async () => {
      const r = await page("/team/work-queue", anon);
      assert.equal(r.status, 200);
      assert.match(r.body, /My Work is currently locked/);
      assert.ok(r.body.includes(loginHref("/team/work-queue")), "sign-in return link");
      assert.doesNotMatch(r.body, /Current authorized work/);
      noLeak(r, "work-queue");
    });
    await check("web", "anonymous /finance: Owner sign-in with return path, no order data", async () => {
      const r = await page("/finance", anon);
      assert.match(r.body, /Verified Owner session required/);
      assert.ok(r.body.includes(loginHref("/finance")));
      assert.doesNotMatch(r.body, /Order preview|OWNER AAL2/);
      noLeak(r, "finance");
    });
    await check("web", "anonymous /team/eod-sources: locked, source status not fabricated", async () => {
      const r = await page("/team/eod-sources", anon);
      assert.match(r.body, /Source status is locked/);
      assert.doesNotMatch(r.body, /Verified source objects/);
      noLeak(r, "eod-sources");
    });

    const wStaffU = await provisionStaff("webstaff");
    const wOwnerU = await provisionOwner("webowner");
    const wAal1U = await provisionStaff("webaal1");
    const jarStaff = new Jar(), jarOwner = new Jar(), jarAal1 = new Jar();

    await check("web", "sign-in: wrong password is rejected (401); cross-origin sign-in is rejected (403)", async () => {
      const bad = await api("/api/auth/sign-in", new Jar(), { email: wStaffU.email, password: "wrong-password-123" });
      assert.equal(bad.status, 401);
      const xo = await api("/api/auth/sign-in", new Jar(), { email: wStaffU.email, password: wStaffU.password }, { origin: "https://evil.example" });
      assert.equal(xo.status, 403);
      assert.equal(xo.body.error, "ORIGIN_DENIED");
    });
    await check("web", "password-only (AAL1) session is NOT enough: protected screens stay locked and offer MFA sign-in", async () => {
      assert.equal((await signIn(wAal1U, jarAal1)).status, 200);
      for (const [p, text] of [["/team/work-queue", /My Work is currently locked/], ["/team/eod-sources", /Source status is locked/]]) {
        const r = await page(p, jarAal1);
        assert.match(r.body, text, p);
        assert.ok(r.body.includes(loginHref(p)), p);
      }
      const bad = await api("/api/auth/mfa", jarAal1, { code: "000000" });
      assert.ok([401, 403].includes(bad.status), "MFA with no/wrong factor must fail, got " + bad.status);
    });

    await webAal2(wStaffU, jarStaff);
    await webAal2(wOwnerU, jarOwner);

    await check("web", "verified AAL2 Staff: /team/work-queue renders the REAL Core queue item (assigned, actions locked)", async () => {
      const r = await page("/team/work-queue", jarStaff);
      assert.equal(r.status, 200);
      assert.match(r.body, /Current authorized work/);
      assert.match(r.body,new RegExp("Work item (?:<!-- -->)?"+wStaffU.workId.slice(0,8)), "Core work item id prefix in React streamed HTML");
      assert.match(r.body, /Assigned to me/);
      assert.match(r.body, /Actions locked/);
      assert.doesNotMatch(r.body, /My Work is currently locked/);
      noLeak(r, "work-queue");
    });
    await check("web", "verified AAL2 Staff: /team/eod-sources shows partial source readiness with no final/total EOD", async () => {
      const r = await page("/team/eod-sources", jarStaff);
      assert.match(r.body, /Verified source objects vs\. event evidence/);
      assert.match(r.body, /core work ledger/);
      assert.match(r.body, /Final all-source total unavailable/);
      assert.doesNotMatch(r.body, /Source status is locked/);
      assert.doesNotMatch(r.body, /<form|<button/i, "no submit/export control");
      noLeak(r, "eod-sources");
    });
    await check("web", "verified AAL2 Staff on /finance: real Core 403 -> no data, and NO sign-in loop link", async () => {
      const r = await page("/finance", jarStaff);
      assert.match(r.body, /Finance preview unavailable/);
      assert.doesNotMatch(r.body, /Order preview|OWNER AAL2|Verified Owner session required/);
      assert.doesNotMatch(r.body, /href="\/login/);
      noLeak(r, "finance-staff");
    });
    await check("web", "verified AAL2 Owner: /finance shows real read-only Core orders and no payment controls", async () => {
      const r = await page("/finance", jarOwner);
      assert.match(r.body, /Order preview/);
      assert.match(r.body, /OWNER AAL2 · READ ONLY/);
      assert.match(r.body, /No money movement/);
      assert.ok(r.body.includes("/finance/d1111111-1111-4111-8111-111111111111") || r.body.includes("Order #d1111111"));
      assert.doesNotMatch(r.body, /<form|<button|razorpay/i);
      noLeak(r, "finance-owner");
    });
    await check("web", "verified AAL2 Owner (no Staff membership) on /team/work-queue: 403 message, no sign-in loop", async () => {
      const r = await page("/team/work-queue", jarOwner);
      assert.match(r.body, /Your current Core Staff permissions do not allow this view/);
      assert.doesNotMatch(r.body, /Current authorized work|Work item /);
      assert.ok(!r.body.includes(loginHref("/team/work-queue")), "403 must not offer sign-in");
    });

    await check("web", "EOD hold: Core EOD readiness flag off -> Web shows locked, never zero/fabricated totals", async () => {
      delete process.env.VOX_EOD_SOURCE_READINESS_ENABLED;
      const r = await page("/team/eod-sources", jarStaff);
      process.env.VOX_EOD_SOURCE_READINESS_ENABLED = "staging";
      assert.match(r.body, /Source status is locked/);
      assert.doesNotMatch(r.body, /Verified source objects|core work ledger/);
    });
    await check("web", "Finance hold: Core Finance flag off -> Web shows unavailable, no orders", async () => {
      delete process.env.VOX_FINANCE_READ_ENABLED;
      const r = await page("/finance", jarOwner);
      process.env.VOX_FINANCE_READ_ENABLED = "staging";
      assert.match(r.body, /Finance preview unavailable/);
      assert.doesNotMatch(r.body, /Order preview|Order #/);
    });
    await check("web", "queue hold: Core work-queue flag off -> locked 'not allow/approved' state, no work ids", async () => {
      delete process.env.VOX_WORK_QUEUE_READ_ENABLED;
      const r = await page("/team/work-queue", jarStaff);
      process.env.VOX_WORK_QUEUE_READ_ENABLED = "staging";
      assert.match(r.body, /requires protected Core authorization and an approved staging release/);
      assert.ok(!r.body.includes(wStaffU.workId.slice(0, 8)));
    });

    await check("web", "revoked Staff: the SAME Web session loses the queue + EOD sources immediately (403, no login loop)", async () => {
      await pg.query("UPDATE public.vox_staff_memberships_v1 SET is_active=false, revoked_at=now() WHERE auth_user_id=$1", [wStaffU.id]);
      const q = await page("/team/work-queue", jarStaff);
      assert.match(q.body, /Your current Core Staff permissions do not allow this view/);
      assert.ok(!q.body.includes(wStaffU.workId.slice(0, 8)), "no work metadata after revoke");
      assert.ok(!q.body.includes(loginHref("/team/work-queue")));
      const e = await page("/team/eod-sources", jarStaff);
      assert.match(e.body, /Source status is locked/);
    });
    await check("web", "deleted Auth user: Owner session becomes 401 navigation (sign-in link with /finance return path)", async () => {
      assert.ok((await gtAdmin("/users/" + wOwnerU.id, "DELETE")).ok);
      const r = await page("/finance", jarOwner);
      assert.match(r.body, /Verified Owner session required/);
      assert.ok(r.body.includes(loginHref("/finance")));
      assert.doesNotMatch(r.body, /Order preview/);
    });
    await check("web", "sign-out clears the Web session: protected screen returns to 401 sign-in navigation", async () => {
      const s = await provisionStaff("websignout");
      const jar = new Jar();
      await webAal2(s, jar);
      assert.match((await page("/team/work-queue", jar)).body, /Current authorized work/);
      assert.equal((await api("/api/auth/sign-out", jar, {})).status, 200);
      const r = await page("/team/work-queue", jar);
      assert.match(r.body, /My Work is currently locked/);
      assert.ok(r.body.includes(loginHref("/team/work-queue")));
    });
    await check("web", "Web never held the Core service-role key and the Core DB was not written by any Web-driven read", async () => {
      assert.ok(!webLog.includes(adminJwt), "service-role key never appears in Web logs");
      assert.deepEqual(await fingerprint(), before);
    });
  }

  const webPart = results.webSkipped ? "web=SKIPPED" : "web=" + results.web;
  if (results.failed) {
    console.log("VOX_FUNCTIONAL_STAFF_E2E_FAILURE core=" + results.core + " " + webPart + " failed=" + results.failed);
    for (const f of failures) console.log("  - " + f);
    process.exitCode = 1;
  } else {
    console.log("VOX_FUNCTIONAL_STAFF_E2E_PASS core=" + results.core + " " + webPart + " failed=0");
  }
} catch (e) {
  console.log("VOX_FUNCTIONAL_STAFF_E2E_FATAL", String(e?.stack || e));
  process.exitCode = 1;
} finally {
  try { webProc?.kill(); } catch {}
  for (const s of [coreServer, proxy]) { if (s) { try { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); } catch {} } }
  try { await pg?.end(); } catch {}
  for (const name of containers.reverse()) { try { docker("rm", "-f", name); } catch {} }
  if (networkCreated) { try { docker("network", "rm", net); } catch {} }
  console.log("VOX_FUNCTIONAL_FIXTURES_CLEANED");
}
