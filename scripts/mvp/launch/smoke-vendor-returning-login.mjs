/**
 * Loopback-only production build smoke. No remote providers, Auth, SQL or sends.
 * All activation switches are removed from the child env. Fails closed.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const HOST = "127.0.0.1";
const RESERVED = [
  "QF_VENDOR_OTP_REQUEST_MODE", "QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED",
  "QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED", "QF_VENDOR_ATOMIC_SIGNUP_MODE",
  "QF_VENDOR_OTP_VERIFY_MODE", "QF_VENDOR_OTP_EVIDENCE_READ_ENABLED",
  "QF_VENDOR_PRIVATE_EVIDENCE_MODE", "QF_VENDOR_PRIVATE_BUCKET_CERTIFIED",
  "QF_VENDOR_LEGACY_REGISTRATION_MODE", "QF_RUNTIME_ENV",
  "VOX_OWNER_VENDOR_CASE_REVIEW_ENABLED", "VOX_OWNER_VENDOR_QUEUE_ENABLED",
  "VOX_OWNER_VENDOR_SIGNUP_STATUS_READ_ENABLED", "VOX_OWNER_WORKSPACES_ENABLED",
  "VOX_OWNER_WORKSPACES_STAGE", "QF_VENDOR_RETURNING_LOGIN_MODE",
];
const env = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" };
// Even if the developer shell has provider credentials, the disposable child
// cannot read or contact a managed database, SMS sender or cloud endpoint.
for (const name of Object.keys(env)) {
  if (/SUPABASE|GOOGLE|META_|WHATSAPP|RAZORPAY|STRIPE|TWILIO|CLOUDFLARE|RESEND|SENDGRID/i.test(name))
    delete env[name];
}
for (const name of RESERVED) delete env[name];
env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "qf-local-smoke-nonfunctional-public-key";
// No service role or private database key exists in this process.
const port = await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once("error", reject);
  s.listen(0, HOST, () => {
    const address = s.address();
    s.close(() => resolve(address.port));
  });
});
const base = `http://${HOST}:${port}`;
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", HOST, "-p", String(port)], {
  cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let output = "";
next.stdout.on("data", (buf) => { output = (output + buf.toString()).slice(-4096); });
next.stderr.on("data", (buf) => { output = (output + buf.toString()).slice(-4096); });
const failures = [];
async function run(name, url, init, expectedStatus, expectedText) {
  const resp = await fetch(base + url, { ...init, redirect: "manual",
    signal: AbortSignal.timeout(6500) });
  const text = await resp.text();
  assert.equal(resp.status, expectedStatus, `${name}: unexpected HTTP status ${resp.status}`);
  const observed = resp.status >= 300 && resp.status < 400
    ? resp.headers.get("location") ?? "" : text;
  assert.match(observed, expectedText, `${name}: expected safe outcome absent`);
  console.log("PASS " + name + " [" + resp.status + "]");
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (next.exitCode !== null) break;
    try {
      const resp = await fetch(base + "/vendor?mode=signup", {
        signal: AbortSignal.timeout(1500),
      });
      if (resp.status === 200) { ready = true; break; }
    } catch {}
    await delay(350);
  }
  assert.ok(ready, "Local vendor frontend did not start. " + output.slice(-1000));
  await run("new vendor signup is accessible", "/vendor?mode=signup", {}, 200,
    /Verify mobile \/ apply/);
  await run("vendor WhatsApp OTP login renders", "/vendor?mode=login", {}, 200,
    /Sign in with WhatsApp/);
  await run("existing vendor legacy password option remains available", "/vendor?mode=login", {}, 200,
    /Existing vendor with email\/password/);
  await run("returning-login request stays closed", "/api/vendor/auth/login/request-otp", {
    method:"POST",headers:{"content-type":"application/json",origin:base},
    body:JSON.stringify({mobile:"9876543210"})},503,/VENDOR_WHATSAPP_LOGIN_NOT_AVAILABLE/);
  await run("returning-login verify stays closed", "/api/vendor/auth/login/verify-otp", {
    method:"POST",headers:{"content-type":"application/json",origin:base},
    body:JSON.stringify({mobile:"9876543210",token:"123456"})},503,/VENDOR_WHATSAPP_LOGIN_NOT_AVAILABLE/);
  await run("legacy vendor registration redirects", "/vendors/register", {}, 307,
    /\/vendor\?mode=signup/);
  await run("OTP provider disabled yields no initiation", "/api/vendor/onboarding/request-otp", {
    method: "POST", headers: { "content-type": "application/json",
      origin: base }, body: JSON.stringify({mobile: "9876543210"})}, 503,
    /WHATSAPP_OTP_NOT_YET_AVAILABLE/);
  await run("signup cannot create pending account before provider", "/api/vendor/onboarding/complete", {
    method: "POST", headers: { "content-type": "application/json",
      origin: base }, body: JSON.stringify({mobile: "9876543210", token: "123456", registration: {}})}, 503,
    /VENDOR_SIGNUP_NOT_YET_AVAILABLE/);
  await run("private evidence intake stays closed", "/api/vendor/private-evidence", {
    method: "POST", headers: { origin: base }, body: "not-uploaded"}, 503,
    /PRIVATE_EVIDENCE_NOT_YET_AVAILABLE/);
  await run("Owner queue stays closed", "/api/vox/v1/owner-vendor-verification-queue", {}, 503,
    /VENDOR_REVIEW_QUEUE_DISABLED/);
  await run("Owner decision stays closed", "/api/vox/v1/owner-vendor-verification-case?"+
    "vendorId=00000000-0000-4000-8000-000000000001", {}, 503,
    /OWNER_REVIEW_DISABLED/);
  console.log("VENDOR_F5_LOOPBACK_SMOKE_PASS checks=11 release=HOLD provider_sends=0");
} catch (e) {
  failures.push(String(e));
  console.error("VENDOR_F5_LOOPBACK_SMOKE_FAIL", String(e));
  process.exitCode = 1;
} finally {
  next.kill();
  // Child startup only, no registry, managed network or external provider calls.
}
