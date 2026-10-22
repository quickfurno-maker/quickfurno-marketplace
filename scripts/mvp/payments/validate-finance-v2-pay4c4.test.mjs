import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {CURRENT_MIGRATION_TREE} from "../migration/currentMigrationTruth.mjs";
import {buildPay4c4UnsignedReleaseBill,verifyPay4c4DetachedSignature}
 from "./financePay4c4ReleaseBill.mjs";
import {runPay4c4OfflineProviderSuite,validateSyntheticWebhook}
 from "../../../lib/payments/financePay4c4OfflineProviderSuite.mjs";
const PARENT="d6f30aadf88b6fa6beff0ceb7990a2ac865072fa";
test("C4-A old migration validator fails in a structured way for exactly 7 quarantined files",()=>{
 assert.equal(CURRENT_MIGRATION_TREE.ok,false);
 assert.equal(CURRENT_MIGRATION_TREE.totalCount,162);
 const missing=CURRENT_MIGRATION_TREE.checks.filter(x=>
  !x.ok&&x.name.startsWith("post-G1 source present"));
 assert.equal(missing.length,7);
 assert.ok(missing.every(x=>x.detail.startsWith("20261014")));
});
test("C4-D exact bill contains 12 SQL SHA256 and sensitive Core/VOX hashes",()=>{
 const bill=buildPay4c4UnsignedReleaseBill({commitSha:PARENT});
 const manifest=JSON.parse(bill.payload);
 assert.equal(bill.sqlCount,12);
 assert.equal(bill.fileCount,9);
 assert.equal(manifest.sqlCandidates.length,12);
 assert.equal(manifest.target,"Staging");
 assert.ok(manifest.sqlCandidates.every(x=>/^[a-f0-9]{64}$/.test(x.sha256)));
 assert.equal(bill.artifactBuilt,false);
 assert.equal(bill.deployAllowed,false);
});
test("C4-D exact bill is deterministic and fails closed for unsupported commit",()=>{
 const a=buildPay4c4UnsignedReleaseBill({commitSha:PARENT});
 const b=buildPay4c4UnsignedReleaseBill({commitSha:PARENT});
 assert.equal(a.sha256,b.sha256);
 assert.throws(()=>buildPay4c4UnsignedReleaseBill({commitSha:"unknown"}),/PAY4C4_COMMIT_REQUIRED/);
});
test("C4-D real Ed25519 detached signature verification does NOT authorize staging",()=>{
 const {privateKey,publicKey}=generateKeyPairSync("ed25519");
 const bill=buildPay4c4UnsignedReleaseBill({commitSha:PARENT});
 const signatureBase64=sign(null,Buffer.from(bill.payload),privateKey).toString("base64");
 const result=verifyPay4c4DetachedSignature({bill,signatureBase64,
  publicKeyPem:publicKey.export({format:"pem",type:"spki"}),expectedDigest:bill.sha256});
 assert.equal(result.signatureValid,true);
 assert.equal(result.trustedReleaseKeyPinned,false);
 assert.equal(result.deployAllowed,false);
 assert.equal(result.isApprovedStagingBuild,false);
});
test("C4-D signature tampering, hash mismatch, incorrect key all refuse",()=>{
 const a=generateKeyPairSync("ed25519"),b=generateKeyPairSync("ed25519");
 const bill=buildPay4c4UnsignedReleaseBill({commitSha:PARENT});
 const sig=sign(null,Buffer.from(bill.payload),a.privateKey).toString("base64");
 const key=b.publicKey.export({format:"pem",type:"spki"});
 assert.equal(verifyPay4c4DetachedSignature({bill,signatureBase64:sig,publicKeyPem:key,
  expectedDigest:bill.sha256}).signatureValid,false);
 assert.equal(verifyPay4c4DetachedSignature({bill,signatureBase64:sig,
  publicKeyPem:a.publicKey.export({format:"pem",type:"spki"}),expectedDigest:"a".repeat(64)})
  .digestMatched,false);
});
test("C4-E executable offline provider suite checks nine signed scenarios with zero money actions",()=>{
 const v=runPay4c4OfflineProviderSuite();
 assert.equal(v.passed,9);
 assert.equal(v.sandboxNetworkCalls,0);
 assert.equal(v.liveNetworkCalls,0);
 assert.equal(v.attemptedWalletCredits,0);
 assert.equal(v.refundsSubmitted,0);
 assert.ok(v.proofCases.every(x=>x.syntheticWebhookAuthenticated&&
  !x.paymentOrWalletMutation&&!x.providerNetworkCall));
 assert.equal(v.actualRazorpayTestCertified,false);
});
test("C4-E synthetic HMAC strictly rejects forged input",()=>{
 assert.equal(validateSyntheticWebhook("{}","a".repeat(64)),false);
 assert.equal(validateSyntheticWebhook("{}",null),false);
 assert.equal(validateSyntheticWebhook("{}", "ff"),false);
});
