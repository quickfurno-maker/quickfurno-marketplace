/**
 * Ephemeral application ROUTE certification: real Next.js runtime, HTTPS
 * termination, real signed Ed25519 request, synthetic loopback PostgREST.
 * No Supabase account/project, real credentials, provider send or live vendor.
 */
import { randomUUID, generateKeyPairSync, sign, createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createServer as httpServer, request as httpRequest } from "node:http";
import {
  createServer as httpsServer,
  request as httpsRequest,
} from "node:https";
import { createServer as tcpServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";

const root = resolve(import.meta.dirname, "../../..");
const temp = mkdtempSync(join(tmpdir(), "anisha-next-stage-"));
const vendorId = "44444444-4444-4444-8444-444444444444";
const purgeId = "11111111-1111-4111-8111-111111111111";
const token = "55555555-5555-4555-8555-555555555555";
const keyId = "anisha-route-cert";
const signing = generateKeyPairSync("ed25519");
const pub = signing.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
let nextProcess, proxy, fakeDb;
let nextErrorLog = "";
let erased = false,
  acknowledged = false,
  mockCalls = 0;
const checked = [];
const check = (name, ok) => {
  if (!ok) throw new Error("FAIL " + name);
  checked.push(name);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() {
  const server = tcpServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function onServer(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}
async function post(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        ca: readFileSync(join(temp, "cert.pem")),
        headers: { "content-type": "application/json", ...headers },
        timeout: 20000,
      },
      async (response) => {
        let result = "";
        for await (const part of response) result += part;
        let data;
        try {
          data = JSON.parse(result);
        } catch {
          data = { raw: result.slice(0, 200) };
        }
        resolve({ status: response.statusCode, data });
      },
    );
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("HTTPS timeout")));
    request.end(JSON.stringify(body));
  });
}
function signed(domain, path, fields) {
  const requestId = randomUUID(),
    issuedAt = new Date().toISOString();
  const body = {
    protocol: "qfj.anisha.memory-purge",
    version: 1,
    action: fields.action,
    caller: "qf-jarvis",
    audience: "quickfurno-core",
    requestId,
    issuedAt,
    ...fields.extra,
  };
  const bytes = JSON.stringify(body);
  const digest = createHash("sha256")
    .update(Buffer.from(bytes))
    .digest("base64url");
  const message = [
    domain,
    "POST",
    path,
    "qf-jarvis",
    "quickfurno-core",
    requestId,
    issuedAt,
    keyId,
    digest,
  ].join("\n");
  const signature = sign(
    null,
    Buffer.from(message),
    signing.privateKey,
  ).toString("base64url");
  return {
    body,
    headers: { "x-qfj-key-id": keyId, "x-qfj-signature": signature },
  };
}
async function main() {
  const openssl =
    process.env["ANISHA_CERT_OPENSSL"] ??
    (process.platform === "win32"
      ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"
      : "openssl");
  execFileSync(
    openssl,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(temp, "key.pem"),
      "-out",
      join(temp, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  fakeDb = httpServer(async (req, res) => {
    let str = "";
    for await (const b of req) str += b;
    const path = req.url ?? "";
    mockCalls++;
    res.setHeader("content-type", "application/json");
    if (req.method !== "POST" || !path.startsWith("/rest/v1/rpc/")) {
      res.writeHead(404).end("{}");
      return;
    }
    if (path.includes("qf_claim_vendor_anisha_memory_purges_v1")) {
      res.writeHead(200).end(
        JSON.stringify(
          acknowledged
            ? []
            : [
                {
                  purge_id: purgeId,
                  vendor_id: vendorId,
                  lease_token: token,
                },
              ],
        ),
      );
      return;
    }
    if (path.includes("qf_ack_vendor_anisha_memory_purge_v1")) {
      const b = JSON.parse(str);
      const match =
        b.p_purge_id === purgeId &&
        b.p_vendor_id === vendorId &&
        b.p_lease_token === token;
      const accepted = match && erased && !acknowledged;
      if (accepted) acknowledged = true;
      res.writeHead(200).end(JSON.stringify(accepted));
      return;
    }
    res.writeHead(404).end("{}");
  });
  const dbPort = await onServer(fakeDb);
  const appPort = await freePort();
  proxy = httpsServer(
    {
      key: readFileSync(join(temp, "key.pem")),
      cert: readFileSync(join(temp, "cert.pem")),
    },
    (incoming, outgoing) => {
      const upstream = httpRequest(
        {
          hostname: "127.0.0.1",
          port: appPort,
          path: incoming.url,
          method: incoming.method,
          headers: { ...incoming.headers, host: "127.0.0.1:" + appPort },
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on("error", () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.pipe(upstream);
    },
  );
  const tlsPort = await onServer(proxy);
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    SystemRoot: process.env.SystemRoot,
    NODE_ENV: "development",
    CI: "true",
    QF_DEPLOYMENT_ENV: "staging",
    QF_ANISHA_MEMORY_CONSENT_MODE: "STAGING_ONLY",
    QF_JARVIS_CORE_VERIFICATION_KEYS_JSON: JSON.stringify([
      { keyId, publicKeyPem: pub },
    ]),
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:" + dbPort,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "CERT_NO_REAL_KEY",
    SUPABASE_SERVICE_ROLE_KEY: "CERT_NO_REAL_KEY",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(appPort),
  };
  nextProcess = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--turbopack",
      "--hostname",
      "127.0.0.1",
      "-p",
      String(appPort),
    ],
    {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  for (const stream of [nextProcess.stdout, nextProcess.stderr])
    stream.on("data", (d) => {
      nextErrorLog = (nextErrorLog + d.toString()).slice(-5000);
    });
  // Probe the Next app via encrypted HTTPS; compilation occurs on first route.
  let ready = false;
  for (let i = 0; i < 75; i++) {
    if (nextProcess.exitCode !== null)
      throw Error("Next staging app exited before readiness");
    try {
      const r = await post(
        tlsPort,
        "/api/internal/jarvis/anisha-memory-purge-claim",
        {},
      );
      if (r.status !== 502 && r.status !== 503) {
        ready = true;
        break;
      }
    } catch {}
    await pause(1000);
  }
  check("real Next app served behind ephemeral HTTPS TLS", ready);
  const claimPath = "/api/internal/jarvis/anisha-memory-purge-claim";
  const ackPath = "/api/internal/jarvis/anisha-memory-purge-ack";
  const claim = signed("qfj.anisha.memory-purge.claim.http.sig.v1", claimPath, {
    action: "CLAIM",
    extra: { maxItems: 5 },
  });
  const bad = await post(tlsPort, claimPath, claim.body, {
    ...claim.headers,
    "x-qfj-signature": "tampered",
  });
  check(
    "real Next route rejects bad signature before database call",
    bad.status === 401,
  );
  const wrong = await post(tlsPort, claimPath, claim.body, {});
  check("real Next route rejects unsigned request", wrong.status === 401);
  const before = mockCalls;
  const valid = await post(tlsPort, claimPath, claim.body, claim.headers);
  check(
    "real Core Next route accepts signed claim via HTTPS",
    valid.status === 200 &&
      valid.data?.tasks?.length === 1 &&
      valid.data.tasks[0].vendorId === vendorId &&
      mockCalls === before + 1,
  );
  const ackFields = {
    action: "ACK",
    extra: { purgeId, vendorId, leaseToken: token },
  };
  const premature = signed(
    "qfj.anisha.memory-purge.ack.http.sig.v1",
    ackPath,
    ackFields,
  );
  const early = await post(tlsPort, ackPath, premature.body, premature.headers);
  check(
    "Core refuses ACK before physical erasure",
    early.status === 409 && early.data?.acknowledged === false,
  );
  erased = true;
  const accepted = signed(
    "qfj.anisha.memory-purge.ack.http.sig.v1",
    ackPath,
    ackFields,
  );
  const yes = await post(tlsPort, ackPath, accepted.body, accepted.headers);
  check(
    "real signed Next Core ACK accepts committed synthetic erase",
    yes.status === 200 && yes.data?.acknowledged === true,
  );
  const replay = signed(
    "qfj.anisha.memory-purge.ack.http.sig.v1",
    ackPath,
    ackFields,
  );
  const duplicate = await post(tlsPort, ackPath, replay.body, replay.headers);
  check("duplicate ACK is denied", duplicate.status === 409);
  const consentPath = "/api/internal/jarvis/anisha-memory-consent";
  const consentId = randomUUID(),
    consentTime = new Date().toISOString();
  const consentBody = {
    protocol: "qfj.anisha.memory-consent",
    version: 1,
    caller: "qf-jarvis",
    audience: "quickfurno-core",
    requestId: consentId,
    issuedAt: consentTime,
    tenantId: "quickfurno",
    vendorId,
    conversationId: "22222222-2222-4222-8222-222222222222",
    expectedRevision: 9,
  };
  const consentInput = [
    "qfj.anisha.memory-consent.http.sig.v1",
    "POST",
    consentPath,
    "qf-jarvis",
    "quickfurno-core",
    consentId,
    consentTime,
    keyId,
    createHash("sha256")
      .update(JSON.stringify(consentBody))
      .digest("base64url"),
  ].join("\n");
  const consentHeaders = {
    "x-qfj-key-id": keyId,
    "x-qfj-signature": sign(
      null,
      Buffer.from(consentInput),
      signing.privateKey,
    ).toString("base64url"),
  };
  const denied = await post(tlsPort, consentPath, consentBody, {
    ...consentHeaders,
    "x-qfj-signature": "tampered",
  });
  check(
    "actual Next consent route rejects tampered signature",
    denied.status === 401,
  );
  const noAuthority = await post(
    tlsPort,
    consentPath,
    consentBody,
    consentHeaders,
  );
  check(
    "actual Next consent route fails closed without Core vendor authority",
    noAuthority.status === 503 && noAuthority.data?.error === "unavailable",
  );
  // A2h cross-repository application test: use the actual Jarvis production
  // signed transport and purge worker from an esbuild-bundled source artifact.
  // The bundle is injected read-only into the container; its source is tracked
  // separately in the Jarvis repo. A2g remains runnable without it.
  if (process.env.ANISHA_CERT_JARVIS_BUNDLE) {
    const jarvis = await import(process.env.ANISHA_CERT_JARVIS_BUNDLE);
    const jarvisHttpPost = (url, init) =>
      new Promise((resolve, reject) => {
        const endpoint = new URL(url);
        const request = httpsRequest(
          {
            hostname: endpoint.hostname,
            port: Number(endpoint.port),
            path: endpoint.pathname,
            method: init.method,
            headers: init.headers,
            ca: readFileSync(join(temp, "cert.pem")),
            timeout: 20000,
          },
          async (response) => {
            let output = "";
            for await (const part of response) output += part;
            resolve({
              status: response.statusCode,
              text: async () => output,
            });
          },
        );
        request.on("error", reject);
        request.on("timeout", () =>
          request.destroy(new Error("jarvis-https-timeout")),
        );
        request.end(init.body);
      });
    const jarvisConfig = {
      baseUrl: "https://127.0.0.1:" + tlsPort + "/",
      keyId,
      privateKeyPem: signing.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      requestId: randomUUID,
      clock: () => new Date().toISOString(),
      httpPost: jarvisHttpPost,
      timeoutMs: 5000,
    };
    acknowledged = false;
    erased = false;
    const actualCore =
      jarvis.createQuickFurnoAnishaMemoryPurgeCore(jarvisConfig);
    const claimed = await actualCore.claim(5);
    check(
      "actual Jarvis signed client claims from real Next HTTPS",
      claimed.length === 1 &&
        claimed[0].vendorId === vendorId &&
        claimed[0].leaseToken === token,
    );
    const actualWorker = jarvis.createAnishaMemoryPurgeWorker({
      core: actualCore,
      erase: async (task) => {
        if (task.vendorId !== vendorId)
          throw new Error("unexpected-test-vendor");
        // The Core A2g test intentionally has a synthetic DB stub.
        erased = true;
        return { deletedCount: 1 };
      },
    });
    const cycle = await actualWorker.runCycle();
    check(
      "actual Jarvis worker erases then Core Next HTTPS accepts ACK",
      cycle.claimed === 1 &&
        cycle.deleted === 1 &&
        cycle.acknowledged === 1 &&
        cycle.failed === 0 &&
        acknowledged === true,
    );
    const realConsent =
      jarvis.createQuickFurnoAnishaMemoryConsentReader(jarvisConfig);
    let consentDenied = false;
    try {
      await realConsent.read({
        tenantId: "quickfurno",
        vendorId,
        conversationId: "22222222-2222-4222-8222-222222222222",
        expectedRevision: 9,
      });
    } catch (error) {
      consentDenied =
        error?.code === "request-failed" || error?.code === "response-invalid";
    }
    check(
      "actual Jarvis consent reader fails closed without Core authority",
      consentDenied,
    );
  }
  console.log(
    "ANISHA_REAL_NEXT_HTTPS_STAGE_CERT_PASS " +
      checked.length +
      "/" +
      checked.length,
  );
  for (const name of checked) console.log("PASS " + name);
}
try {
  await main();
} catch (e) {
  console.error("ANISHA_REAL_NEXT_HTTPS_STAGE_CERT_FAIL", e?.message);
  console.error(
    "NEXT_ERROR_CLASS",
    /Module not found|TurbopackInternalError|Symlink|EADDRINUSE|failed to compile/i.test(
      nextErrorLog,
    )
      ? "next-build-or-bind-error"
      : "unexpected-runtime-error",
  );
  process.exitCode = 1;
} finally {
  if (nextProcess) {
    nextProcess.kill("SIGTERM");
    await pause(500);
  }
  for (const s of [proxy, fakeDb])
    if (s) await new Promise((resolve) => s.close(() => resolve()));
  rmSync(temp, { recursive: true, force: true });
}
