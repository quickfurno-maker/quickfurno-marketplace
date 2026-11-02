import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const sqlPath="scripts/mvp/vox/fixtures/rc28-review-only-provider-event-ledger.pg17.sql";
const sql=read(sqlPath);
test("RC28 review-only Finance SQL must never be discovered as managed migration",()=>{
 assert.ok(existsSync(resolve(root,sqlPath)));
 assert.equal(existsSync(resolve(root,"supabase/migrations/20261031020000_vendor_package_provider_event_ledger_v2_candidate.sql")),false);
 assert.match(sql,/REVIEW-ONLY, NON-DEPLOYABLE/);
 assert.match(sql,/SECURITY INVOKER/g);
 assert.doesNotMatch(sql,/SECURITY DEFINER/i);
});
test("Finance candidate denies public/auth and separates TEST/LIVE exact-event identities",()=>{
 assert.match(sql,/PRIMARY KEY \(provider_mode,event_id\)/);
 assert.match(sql,/FOR UPDATE/g);
 assert.match(sql,/attempt_count IS DISTINCT FROM p_attempt_count/);
 assert.match(sql,/FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON FUNCTION.*?[\s\S]*?FROM PUBLIC/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION/);
 assert.doesNotMatch(sql,/GRANT .* TO anon|GRANT .* TO authenticated/i);
});
test("provider repository wiring is dormant until independently approved financial release",()=>{
 const runtime=read("services/vendorPackagePaymentService.ts");
 const repo=read("lib/payments/vendorPackageProviderEventRepository.mjs");
 const gate=read("lib/payments/vendorPackageProviderEventProcessing.mjs");
 const ledger=read("lib/payments/vendorPackageProviderEventLedger.mjs");
 assert.match(runtime,/resolveVendorPackageEventLedgerGate/);
 assert.match(runtime,/createRc28VendorPackageEventRepository/);
 assert.match(runtime,/RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED\s*\?/);
 assert.match(repo,/RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED=false/);
 assert.match(runtime,/if \(ledgerGate\.action === "deny"\)/);
 assert.match(runtime,/if \(!processed\.ack\)/);
 assert.match(ledger,/providerMode==="live"&&ledgerMode!=="enforce"/);
 assert.match(gate,/RAZORPAY_EVENT_LEDGER_REPOSITORY_UNAVAILABLE/);
});
test("genuine Staff Core reconciliation remains unexposed and never accepts injected actor",()=>{
 const core=read("services/vox/rc28VerifiedCoreOutcomeReconciliation.ts");
 assert.match(core,/RC28_CORE_RECONCILIATION_ROUTE_INSTALLED=false/);
 assert.match(core,/verifyVoxOperationsStaffBearer\(authorization\)/);
 assert.match(core,/actorId:actor\.userId/);
 assert.match(core,/Object\.keys\(v\)\.sort\(\)/);
 assert.doesNotMatch(core,/\.send\(|fetch\(|process\.env/);
});
test("EOD still requires real distinct Owner/TL AAL2 and cannot publish",()=>{
 const eod=read("services/vox/rc28PendingSignedEodReview.ts");
 const route=read("app/api/vox/v1/official-eod-publish/route.ts");
 assert.match(eod,/RC28_SIGNED_EOD_REVIEW_ROUTE_INSTALLED=false/);
 assert.match(eod,/verifyVoxOwnerBearer/);
 assert.match(eod,/verifyVoxTeamLeaderBearer/);
 assert.match(eod,/owner===leader\.userId/);
 assert.match(route,/VERIFIED_APPROVAL_WRITER_INSTALLED=false/);
 assert.doesNotMatch(eod,/\.rpc\(|publish\(/);
});
test("VOX20 seven-migration recovery connects only to final PG17 TCP server",()=>{
 const s=read("scripts/mvp/vox/validate-vox20-isolated-recovery.ps1");
 assert.match(s,/pg_isready -q -h 127\.0\.0\.1/);
 const total=(s.match(/docker exec -i -e PGPASSWORD=synthetic_only/g)||[]).length;
 assert.ok(total>=8,"all native SQL execution paths must use loopback TCP");
 assert.match(s,/VOX20_ISOLATED_PG17_SEVEN_MIGRATION_RESTORE_PASS/);
});
