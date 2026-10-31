// RC27-E QA: concurrency races and cross-mode fail-closed gates.
// Source/pure tests always run offline. The native PG17 race harness runs only
// in a standalone network-isolated disposable PostgreSQL 17 proof file
// (no managed DB, no provider). It never touches runtime Core/Finance/EOD code.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {vendorPackageEventLedgerConfigError,vendorPackageEventLedgerMode}
 from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {assessVendorPackageRefundEvidence as assessRefund}
 from "../../../lib/payments/vendorPackageRefundEvidence.mjs";
import {reconcileRefundAgainstCreditEvidence as reconcile}
 from "../../../lib/payments/vendorPackageRefundReconciliationReview.mjs";
import {assertReadOnlyProbe,assertPlanNonExecuting,buildRc26MigrationReleasePlan}
 from "./rc26-migration-release-plan.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
let fetchCalls=0;
const realFetch=globalThis.fetch;
test.before(()=>{globalThis.fetch=async()=>{fetchCalls++;throw Error("PROVIDER_CALL_FORBIDDEN")}});
test.after(()=>{globalThis.fetch=realFetch;assert.equal(fetchCalls,0,"no provider calls")});

// In REPEATABLE READ/SERIALIZABLE the snapshot is fixed by the first
// snapshot-taking statement (any SELECT, including SELECT pg_advisory_xact_lock).
// LOCK TABLE does not take a snapshot. A lock acquired after the snapshot cannot
// make rows committed by the lock holder visible.
function serializableQueries(src){
 const begin=src.indexOf("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
 assert.ok(begin>=0,"SERIALIZABLE transaction expected");
 const out=[];const re=/\.query\(\s*(?:"([^"]*)"|([A-Za-z_]\w*))/g;re.lastIndex=begin;
 // lastIndex starts inside the BEGIN literal, so BEGIN itself is not captured.
 let m;while((m=re.exec(src))&&out.length<4){
  const sql=(m[1]??m[2]).trim();if(sql!=="ROLLBACK")out.push(sql);
 }
 return out;
}
const takesSnapshot=sql=>/^SELECT\b/i.test(sql)||/^[a-z_]\w*$/i.test(sql);

test("EOD signed-intent writer locks revocations BEFORE its SERIALIZABLE snapshot",()=>{
 const src=read("scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs");
 const [first]=serializableQueries(src);
 assert.match(first,/^LOCK TABLE\b/,"first statement must be a non-snapshot LOCK");
 assert.match(src,/signer_revocations_candidate_v1 IN SHARE MODE"\);/);
});

test("Core D2-D: session lock precedes SERIALIZABLE snapshot; writer gate stays OFF",()=>{
 const src=read("services/vox/rc8PgVendorConversationOperator.ts");
 const q=serializableQueries(src);
 // The RC27 source must hold the D2-D session key before the snapshot, even
 // though the inner SERIALIZABLE transaction also takes an xact-level lock.
 const sessionLock=src.indexOf("await db.query(destinationSessionLock,[hash])");
 const snapshot=src.indexOf('await db.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE")');
 const unlock=src.indexOf("await db.query(destinationSessionUnlock,[lockHash])");
 assert.ok(sessionLock>0&&snapshot>sessionLock&&unlock>snapshot,
  "destination lock must bracket the SERIALIZABLE snapshot, then unlock");
 assert.match(src,/RC8_CORE_WRITER_INSTALLED=false as const/);
 assert.match(src,/allConsentMutationPathsSerialized:false/);
 const lockAt=q.findIndex(s=>/pg_advisory_xact_lock|^LOCK TABLE/.test(s));
 const snapshotBeforeLock=lockAt<0||q.slice(0,lockAt).some(takesSnapshot)||
  /^SELECT pg_advisory_xact_lock/.test(q[lockAt]);
 if(snapshotBeforeLock){
  // Known RC26 blocker 1: concurrent D2-D STOP suppression can be invisible.
  assert.match(src,/RC8_CORE_WRITER_INSTALLED=false as const/);
  assert.match(src,/allConsentMutationPathsSerialized:false/);
  assert.match(read("services/vox/rc19VerifiedConversationWriter.ts"),
   /RC19_VERIFIED_CORE_WRITER_INSTALLED=false as const/);
 }
 // D2-D STOP writers must keep taking the same destination advisory key.
 const d2d=read("supabase/migrations/20260712000300_communication_consent_command_writer_rpc.sql");
 assert.match(d2d,/pg_advisory_xact_lock\(hashtextextended\('dst\|' \|\| p_destination_hash \|\| '\|' \|\| p_channel, 0\)\)/);
 assert.match(src,/hashtextextended\('dst\|' \|\| \$1::text \|\| '\|whatsapp',0\)/);
});

test("cross-mode ledger config: only exact lowercase test|live; LIVE never without enforce",()=>{
 for(const mode of ["Live","TEST"," live","test ","prod","production","sandbox",0,true,{}])
  for(const ledger of ["off","enforce"])
   assert.notEqual(vendorPackageEventLedgerConfigError(mode,ledger),null,JSON.stringify([mode,ledger]));
 for(const ledger of [vendorPackageEventLedgerMode("off"),vendorPackageEventLedgerMode(""),
   vendorPackageEventLedgerMode("on"),vendorPackageEventLedgerMode("1")])
  assert.notEqual(vendorPackageEventLedgerConfigError("live",ledger),null);
});

const ORDER_ID="00000000-0000-4000-8000-000000000101";
const VENDOR_ID="00000000-0000-4000-8000-000000000102";
const refundBase={localOrderId:ORDER_ID,paymentId:"pay_ABC12345",providerMode:"test",
 providerReconciled:true,paymentCaptured:true,paymentRefunded:false,refundPending:false,
 activationStatus:"activated",creditsGranted:10,creditsConsumed:0,creditsRemaining:10};
test("refund evidence fuzz: no mode/lifecycle combination ever authorizes money or credit revocation",()=>{
 let cases=0;
 for(const providerMode of ["test","live","TEST","LIVE","",null,"disabled"])
  for(const paymentCaptured of [true,false,"unknown",null])
   for(const providerReconciled of [true,false,null])
    for(const refundPending of [false,true,null])
     for(const activationStatus of ["activated","pending","failed"])
      for(const [creditsConsumed,creditsRemaining] of [[0,10],[3,7],[3,6],[11,-1],[null,10]]){
      const ev={...refundBase,providerMode,paymentCaptured,providerReconciled,refundPending,activationStatus,
       creditsConsumed,creditsRemaining};
      const a=assessRefund(ev);cases++;
      assert.notEqual(a.refundAllowed,true,JSON.stringify(ev));
      const r=reconcile({vendorId:VENDOR_ID,refundEvidence:ev});
      assert.notEqual(r.refundAllowed,true,JSON.stringify(ev));
      assert.notEqual(r.creditRevocationAllowed,true,JSON.stringify(ev));
      if(creditsConsumed!==0)assert.notEqual(a.ok&&r.ok,true,"consumed/unknown credits never clean");
     }
 assert.ok(cases>2000);
});

test("migration plan: more forged authority and non-SELECT probes fail closed",()=>{
 const plan=buildRc26MigrationReleasePlan();
 const allApproved=plan.steps.map(s=>({...s,approvals:Object.fromEntries(
  Object.keys(s.approvals).map(k=>[k,"approved"]))}));
 for(const forged of [
  {...plan,managedWrites:true},
  {...plan,steps:allApproved},
  {...plan,forbiddenOperations:plan.forbiddenOperations.filter(x=>!/db push/.test(x))},
  {...plan,steps:plan.steps.slice(1)},
 ])assert.throws(()=>assertPlanNonExecuting(forged),/RC26_/);
 for(const sql of [
  "copy (select 1) to program 'id'",
  "select lo_import('/etc/passwd')",
  "select dblink_exec('host=x','drop table t')",
  "select pg_terminate_backend(1)",
  "select set_config('search_path','evil',true)",
  "select 1;\nalter role postgres superuser",
 ])assert.throws(()=>assertReadOnlyProbe(sql),/RC26_PROBE_NOT_READ_ONLY/,sql);
});
